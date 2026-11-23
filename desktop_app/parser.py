"""
parser.py — Streaming, low-memory CNC / G-code / CL-data parser for Siemens NX & Delcam.

Designed for low-end Windows PCs:
- Reads files in line chunks (generator / callback) so multi-megabyte NC programs
  never spike RAM or block the Tkinter event loop.
- Auto-detects Siemens NX, Delcam PowerMill / FeatureCAM, and APT CL-data formats.
- Linearizes G02/G03 circular arcs (G17 XY, G18 XZ, G19 YZ planes, I/J/K or R).
- Gracefully skips unknown machine M-codes, cycles, and vendor headers without crashing.
"""

from __future__ import annotations

import math
import os
import re
from dataclasses import dataclass
from typing import Callable, Dict, Iterator, List, Optional, Tuple


# Pre-compiled regexes for speed on older CPUs
_PAREN_COMMENT_RE = re.compile(r"\([^)]*\)")
_SEMI_COMMENT_RE = re.compile(r";.*$")
_WORD_RE = re.compile(r"([A-Z])\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))")
_CR_RE = re.compile(r"CR\s*=\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))", re.IGNORECASE)
_CL_GOTO_RE = re.compile(
    r"^\s*GOTO\s*/\s*([+-]?\d+(?:\.\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?)",
    re.IGNORECASE,
)
_CL_FEDRAT_RE = re.compile(r"^\s*FEDRAT\s*/\s*(?:[^,]*,\s*)?([+-]?\d+(?:\.\d+)?)", re.IGNORECASE)
_CL_LOADTL_RE = re.compile(r"^\s*(?:LOADTL|TOOLNO)\s*/\s*(\d+)", re.IGNORECASE)


@dataclass(slots=True)
class MoveSegment:
    """Compact representation of a single linearized toolpath segment."""
    line_num: int
    x0: float
    y0: float
    z0: float
    x1: float
    y1: float
    z1: float
    move_type: str       # "RAPID" | "CUT" | "ARC"
    feed: float          # mm/min (or current modal feed)
    spindle: float       # RPM
    tool: str            # e.g. "T01"
    operation: str       # Operation / Toolpath name from NX/Delcam comments
    raw_line: str        # Original source text (trimmed)


@dataclass(slots=True)
class ParseResult:
    segments: List[MoveSegment]
    raw_lines: List[str]
    source_format: str   # "Siemens NX" | "Delcam / PowerMill" | "NX CL-Data" | "Generic ISO G-Code"
    total_lines: int
    warnings: List[str]
    units: str           # "mm" | "inch"


def detect_cam_format(sample_lines: List[str], filename: str = "") -> str:
    """Inspect initial header lines and extension to identify NX, Delcam, or CL-data."""
    ext = os.path.splitext(filename)[1].lower()
    joined = "\n".join(sample_lines[:80]).upper()

    if "GOTO/" in joined or "GOTO /" in joined or "FEDRAT/" in joined:
        return "NX CL-Data"
    if "DELCAM" in joined or "POWERMILL" in joined or "FEATURECAM" in joined or ext == ".ptp":
        return "Delcam / PowerMill"
    if "SIEMENS" in joined or "UGII" in joined or "NX" in joined or ext == ".mpf" or "OPERATION:" in joined:
        return "Siemens NX"
    if ext == ".tap":
        return "Delcam / PowerMill"
    return "Generic ISO G-Code"


class StreamingNCParser:
    """Stateful modal G-code & CL-data parser with minimal memory overhead."""

    def __init__(self, arc_tolerance_mm: float = 0.05) -> None:
        self.arc_tolerance = max(0.005, arc_tolerance_mm)
        self.reset_state()

    def reset_state(self) -> None:
        self.x = 0.0
        self.y = 0.0
        self.z = 0.0
        self.motion_mode = 0        # 0=G00, 1=G01, 2=G02, 3=G03
        self.absolute = True        # True=G90, False=G91
        self.plane = 17             # 17=XY, 18=XZ, 19=YZ
        self.feed = 600.0
        self.spindle = 0.0
        self.tool = "T01"
        self.operation = "Default Operation"
        self.units = "mm"
        self.cl_rapid_next = False

    def _extract_operation_hint(self, comment_text: str) -> Optional[str]:
        clean = comment_text.strip("() ;%\t\r\n")
        if not clean:
            return None
        upper = clean.upper()
        for key in ("OPERATION:", "OPERATION", "TOOLPATH:", "TOOLPATH", "MSG(", "PATH:", "NAME:"):
            if key in upper:
                idx = upper.find(key)
                after = clean[idx + len(key):].strip(" :-\"')")
                if after:
                    return after[:60]
        return None

    def _linearize_arc(
        self,
        line_num: int,
        x1: float,
        y1: float,
        z1: float,
        i_val: Optional[float],
        j_val: Optional[float],
        k_val: Optional[float],
        r_val: Optional[float],
        cw: bool,
        raw_line: str,
    ) -> List[MoveSegment]:
        """Convert G02/G03 arc in active plane into short linear segments."""
        x0, y0, z0 = self.x, self.y, self.z

        # Map active plane axes to (u, v, w) where (u, v) is arc plane and w is helical axis
        if self.plane == 17:  # XY
            u0, v0, w0 = x0, y0, z0
            u1, v1, w1 = x1, y1, z1
            du_c, dv_c = i_val, j_val
        elif self.plane == 18:  # XZ
            u0, v0, w0 = z0, x0, y0
            u1, v1, w1 = z1, x1, y1
            du_c, dv_c = k_val, i_val
        else:  # G19 YZ
            u0, v0, w0 = y0, z0, x0
            u1, v1, w1 = y1, z1, x1
            du_c, dv_c = j_val, k_val

        # Determine center (cu, cv)
        if du_c is not None or dv_c is not None:
            cu = u0 + (du_c or 0.0)
            cv = v0 + (dv_c or 0.0)
            radius = math.hypot(u0 - cu, v0 - cv)
        elif r_val is not None and abs(r_val) > 1e-9:
            chord_u = u1 - u0
            chord_v = v1 - v0
            chord_len = math.hypot(chord_u, chord_v)
            if chord_len < 1e-9:
                return []
            radius = abs(r_val)
            half_chord = min(radius, chord_len * 0.5)
            h = math.sqrt(max(0.0, radius * radius - half_chord * half_chord))
            mid_u = (u0 + u1) * 0.5
            mid_v = (v0 + v1) * 0.5
            nx = -chord_v / chord_len
            ny = chord_u / chord_len
            # Choose side based on CW/CCW and sign of R
            sign = -1.0 if cw else 1.0
            if r_val < 0:
                sign *= -1.0
            cu = mid_u + sign * h * nx
            cv = mid_v + sign * h * ny
        else:
            # Degenerate arc -> fallback to straight line
            return [
                MoveSegment(
                    line_num=line_num,
                    x0=x0, y0=y0, z0=z0,
                    x1=x1, y1=y1, z1=z1,
                    move_type="ARC",
                    feed=self.feed,
                    spindle=self.spindle,
                    tool=self.tool,
                    operation=self.operation,
                    raw_line=raw_line,
                )
            ]

        if radius < 1e-7:
            return []

        a0 = math.atan2(v0 - cv, u0 - cu)
        a1 = math.atan2(v1 - cv, u1 - cu)
        if cw:
            sweep = a0 - a1
            if sweep <= 1e-6:
                sweep += 2.0 * math.pi
            step_sign = -1.0
        else:
            sweep = a1 - a0
            if sweep <= 1e-6:
                sweep += 2.0 * math.pi
            step_sign = 1.0

        # Chordal error formula -> step count capped for low-end PCs
        cos_val = max(-1.0, min(1.0, 1.0 - self.arc_tolerance / max(radius, self.arc_tolerance)))
        max_step = max(0.04, 2.0 * math.acos(cos_val))
        steps = max(4, min(72, int(math.ceil(sweep / max_step))))

        out: List[MoveSegment] = []
        pu, pv, pw = u0, v0, w0
        for s in range(1, steps + 1):
            t = s / steps
            ang = a0 + step_sign * sweep * t
            if s == steps:
                nu, nv, nw = u1, v1, w1
            else:
                nu = cu + radius * math.cos(ang)
                nv = cv + radius * math.sin(ang)
                nw = w0 + (w1 - w0) * t

            if self.plane == 17:
                sx0, sy0, sz0 = pu, pv, pw
                sx1, sy1, sz1 = nu, nv, nw
            elif self.plane == 18:
                sx0, sy0, sz0 = pv, pw, pu
                sx1, sy1, sz1 = nv, nw, nu
            else:
                sx0, sy0, sz0 = pw, pu, pv
                sx1, sy1, sz1 = nw, nu, nv

            out.append(
                MoveSegment(
                    line_num=line_num,
                    x0=sx0, y0=sy0, z0=sz0,
                    x1=sx1, y1=sy1, z1=sz1,
                    move_type="ARC",
                    feed=self.feed,
                    spindle=self.spindle,
                    tool=self.tool,
                    operation=self.operation,
                    raw_line=raw_line,
                )
            )
            pu, pv, pw = nu, nv, nw
        return out

    def parse_line(self, line_num: int, raw: str) -> List[MoveSegment]:
        stripped = raw.strip()
        if not stripped or stripped == "%":
            return []

        # Extract comments for NX / Delcam operation hints
        for m in _PAREN_COMMENT_RE.finditer(stripped):
            hint = self._extract_operation_hint(m.group(0))
            if hint:
                self.operation = hint
        semi_match = _SEMI_COMMENT_RE.search(stripped)
        if semi_match:
            hint = self._extract_operation_hint(semi_match.group(0))
            if hint:
                self.operation = hint

        upper = stripped.upper()

        # Check CL-Data statements (Siemens NX / Delcam APT CL)
        if upper.startswith("PPRINT"):
            hint = self._extract_operation_hint(stripped[6:])
            if hint:
                self.operation = hint
            return []
        if upper.startswith("RAPID"):
            self.cl_rapid_next = True
            return []
        cl_tl = _CL_LOADTL_RE.match(stripped)
        if cl_tl:
            self.tool = f"T{int(cl_tl.group(1)):02d}"
            return []
        cl_f = _CL_FEDRAT_RE.match(stripped)
        if cl_f:
            self.feed = max(1.0, float(cl_f.group(1)))
            return []
        cl_goto = _CL_GOTO_RE.match(stripped)
        if cl_goto:
            nx, ny, nz = float(cl_goto.group(1)), float(cl_goto.group(2)), float(cl_goto.group(3))
            mtype = "RAPID" if self.cl_rapid_next else "CUT"
            self.cl_rapid_next = False
            seg = MoveSegment(
                line_num=line_num,
                x0=self.x, y0=self.y, z0=self.z,
                x1=nx, y1=ny, z1=nz,
                move_type=mtype,
                feed=self.feed,
                spindle=self.spindle,
                tool=self.tool,
                operation=self.operation,
                raw_line=stripped,
            )
            self.x, self.y, self.z = nx, ny, nz
            return [seg]

        # Standard G-code path: strip comments
        code = _PAREN_COMMENT_RE.sub(" ", stripped)
        code = _SEMI_COMMENT_RE.sub("", code).strip().upper()
        if not code:
            return []

        # Check Siemens NX CR= arc radius syntax before word tokenization
        cr_val: Optional[float] = None
        cr_match = _CR_RE.search(code)
        if cr_match:
            cr_val = float(cr_match.group(1))
            code = _CR_RE.sub(" ", code)

        # Parse G-code words
        tokens = _WORD_RE.findall(code)
        if not tokens:
            return []

        words: Dict[str, float] = {}
        g_codes: List[int] = []
        for letter, val_str in tokens:
            val = float(val_str)
            if letter == "G":
                g_codes.append(int(round(val)))
            elif letter == "N":
                continue
            else:
                words[letter] = val

        for g in g_codes:
            if g in (0, 1, 2, 3):
                self.motion_mode = g
            elif g == 90:
                self.absolute = True
            elif g == 91:
                self.absolute = False
            elif g == 17:
                self.plane = 17
            elif g == 18:
                self.plane = 18
            elif g == 19:
                self.plane = 19
            elif g == 20:
                self.units = "inch"
            elif g == 21:
                self.units = "mm"

        if "F" in words and words["F"] > 0:
            self.feed = words["F"]
        if "S" in words and words["S"] >= 0:
            self.spindle = words["S"]
        if "T" in words:
            self.tool = f"T{int(round(words['T'])):02d}"

        has_axis = ("X" in words) or ("Y" in words) or ("Z" in words)
        if not has_axis:
            return []

        if self.absolute:
            nx = words.get("X", self.x)
            ny = words.get("Y", self.y)
            nz = words.get("Z", self.z)
        else:
            nx = self.x + words.get("X", 0.0)
            ny = self.y + words.get("Y", 0.0)
            nz = self.z + words.get("Z", 0.0)

        if abs(nx - self.x) < 1e-9 and abs(ny - self.y) < 1e-9 and abs(nz - self.z) < 1e-9:
            return []

        if self.motion_mode in (2, 3):
            r_param = cr_val if cr_val is not None else words.get("R")
            segs = self._linearize_arc(
                line_num=line_num,
                x1=nx, y1=ny, z1=nz,
                i_val=words.get("I"),
                j_val=words.get("J"),
                k_val=words.get("K"),
                r_val=r_param,
                cw=(self.motion_mode == 2),
                raw_line=stripped,
            )
            self.x, self.y, self.z = nx, ny, nz
            return segs

        mtype = "RAPID" if self.motion_mode == 0 else "CUT"
        seg = MoveSegment(
            line_num=line_num,
            x0=self.x, y0=self.y, z0=self.z,
            x1=nx, y1=ny, z1=nz,
            move_type=mtype,
            feed=self.feed,
            spindle=self.spindle,
            tool=self.tool,
            operation=self.operation,
            raw_line=stripped,
        )
        self.x, self.y, self.z = nx, ny, nz
        return [seg]


def parse_text_stream(
    lines_iter: Iterator[str],
    filename: str = "",
    arc_tolerance_mm: float = 0.05,
    chunk_size: int = 4000,
    progress_cb: Optional[Callable[[int], None]] = None,
) -> ParseResult:
    """Stream-parse an iterator of NC lines in chunks to keep RAM flat."""
    parser = StreamingNCParser(arc_tolerance_mm=arc_tolerance_mm)
    segments: List[MoveSegment] = []
    raw_lines: List[str] = []
    header_sample: List[str] = []
    warnings: List[str] = []
    line_num = 0

    for raw in lines_iter:
        line_num += 1
        trimmed = raw.rstrip("\r\n")
        raw_lines.append(trimmed)
        if len(header_sample) < 80:
            header_sample.append(trimmed)
        try:
            segs = parser.parse_line(line_num, trimmed)
            if segs:
                segments.extend(segs)
        except Exception as exc:
            if len(warnings) < 25:
                warnings.append(f"Line {line_num}: {exc}")
        if progress_cb and (line_num % chunk_size == 0):
            progress_cb(line_num)

    if progress_cb:
        progress_cb(line_num)

    fmt = detect_cam_format(header_sample, filename)
    return ParseResult(
        segments=segments,
        raw_lines=raw_lines,
        source_format=fmt,
        total_lines=line_num,
        warnings=warnings,
        units=parser.units,
    )


def parse_file_streaming(
    filepath: str,
    arc_tolerance_mm: float = 0.05,
    chunk_size: int = 4000,
    progress_cb: Optional[Callable[[int], None]] = None,
) -> ParseResult:
    """Open any .nc/.tap/.ptp/.cnc/.mpf/.txt file and stream-parse it safely."""
    with open(filepath, "r", encoding="utf-8", errors="replace", buffering=1024 * 256) as f:
        return parse_text_stream(
            f,
            filename=filepath,
            arc_tolerance_mm=arc_tolerance_mm,
            chunk_size=chunk_size,
            progress_cb=progress_cb,
        )
