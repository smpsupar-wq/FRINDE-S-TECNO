"""
pass_generator.py — Groups parsed NC segments into NX-style Passes, Z-Levels, and Operations,
computes program statistics, and applies lightweight LOD point decimation for low-end PCs.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Dict, List, Tuple

from parser import MoveSegment, ParseResult


@dataclass(slots=True)
class ToolpathPass:
    pass_id: int
    pass_type: str       # "CUT" | "RAPID"
    z_level: float       # Dominant Z level (mm)
    operation: str
    tool: str
    start_line: int
    end_line: int
    segments: List[MoveSegment] = field(default_factory=list)
    distance: float = 0.0
    duration_sec: float = 0.0
    visible: bool = True


@dataclass(slots=True)
class ProgramStats:
    total_passes: int
    cutting_passes: int
    rapid_passes: int
    z_levels_count: int
    operations_count: int
    total_segments: int
    rendered_segments: int
    decimation_ratio: float
    cutting_distance: float
    rapid_distance: float
    total_distance: float
    est_cycle_time_sec: float
    x_min: float
    x_max: float
    y_min: float
    y_max: float
    z_min: float
    z_max: float
    line_count: int


def _seg_length(s: MoveSegment) -> float:
    return math.sqrt(
        (s.x1 - s.x0) ** 2 + (s.y1 - s.y0) ** 2 + (s.z1 - s.z0) ** 2
    )


def decimate_segments(segments: List[MoveSegment], tolerance: float = 0.03) -> List[MoveSegment]:
    """
    Fast perpendicular-distance / collinear thinning (O(n), single pass)
    that preserves corners and endpoints while dramatically reducing vertices
    on dense 3D finishing toolpaths for low-end integrated GPUs.
    """
    n = len(segments)
    if n <= 3 or tolerance <= 0.0:
        return segments

    kept: List[MoveSegment] = []
    acc_start = segments[0]
    for i in range(1, n):
        curr = segments[i]
        # Never merge across different move types or line breaks > 1 if critical
        if curr.move_type != acc_start.move_type:
            kept.append(acc_start)
            acc_start = curr
            continue

        # Check collinearity deviation of acc_start's endpoint vs chord (acc_start.p0 -> curr.p1)
        vx = curr.x1 - acc_start.x0
        vy = curr.y1 - acc_start.y0
        vz = curr.z1 - acc_start.z0
        v_len = math.sqrt(vx * vx + vy * vy + vz * vz)
        if v_len < 1e-9:
            continue

        px = acc_start.x1 - acc_start.x0
        py = acc_start.y1 - acc_start.y0
        pz = acc_start.z1 - acc_start.z0
        # Cross product magnitude / v_len = perpendicular distance
        cx = py * vz - pz * vy
        cy = pz * vx - px * vz
        cz = px * vy - py * vx
        perp_dist = math.sqrt(cx * cx + cy * cy + cz * cz) / v_len

        if perp_dist <= tolerance:
            # Merge curr into acc_start
            acc_start = MoveSegment(
                line_num=curr.line_num,
                x0=acc_start.x0, y0=acc_start.y0, z0=acc_start.z0,
                x1=curr.x1, y1=curr.y1, z1=curr.z1,
                move_type=acc_start.move_type,
                feed=curr.feed,
                spindle=curr.spindle,
                tool=curr.tool,
                operation=curr.operation,
                raw_line=curr.raw_line,
            )
        else:
            kept.append(acc_start)
            acc_start = curr

    kept.append(acc_start)
    return kept


def generate_passes(
    parsed: ParseResult,
    rapid_rate_mm_min: float = 10000.0,
    z_snap_tolerance: float = 0.02,
    auto_lod_threshold: int = 20000,
    lod_mode: str = "auto",  # "auto" | "full" | "fast"
) -> Tuple[List[ToolpathPass], ProgramStats, Dict[float, List[int]]]:
    """
    Group raw segments into NX-style cutting & rapid passes, organized by Z-level and Operation.
    Returns (passes, stats, z_level_to_pass_ids).
    """
    segs = parsed.segments
    if not segs:
        empty_stats = ProgramStats(
            total_passes=0, cutting_passes=0, rapid_passes=0,
            z_levels_count=0, operations_count=0,
            total_segments=0, rendered_segments=0, decimation_ratio=1.0,
            cutting_distance=0.0, rapid_distance=0.0, total_distance=0.0,
            est_cycle_time_sec=0.0,
            x_min=0.0, x_max=0.0, y_min=0.0, y_max=0.0, z_min=0.0, z_max=0.0,
            line_count=parsed.total_lines,
        )
        return [], empty_stats, {}

    # Compute exact stats before optional LOD decimation
    x_min = y_min = z_min = float("inf")
    x_max = y_max = z_max = float("-inf")
    cut_dist = 0.0
    rapid_dist = 0.0
    cut_time_sec = 0.0
    rapid_time_sec = 0.0

    for s in segs:
        x_min = min(x_min, s.x0, s.x1)
        x_max = max(x_max, s.x0, s.x1)
        y_min = min(y_min, s.y0, s.y1)
        y_max = max(y_max, s.y0, s.y1)
        z_min = min(z_min, s.z0, s.z1)
        z_max = max(z_max, s.z0, s.z1)
        d = _seg_length(s)
        if s.move_type == "RAPID":
            rapid_dist += d
            rapid_time_sec += (d / max(1.0, rapid_rate_mm_min)) * 60.0
        else:
            cut_dist += d
            cut_time_sec += (d / max(1.0, s.feed)) * 60.0

    # Group into logical passes: split whenever transition RAPID <-> CUT, operation/tool changes,
    # or major horizontal Z-level shifts occur during cutting.
    passes: List[ToolpathPass] = []
    cur_segs: List[MoveSegment] = []
    cur_type = "RAPID" if segs[0].move_type == "RAPID" else "CUT"
    cur_op = segs[0].operation
    cur_tool = segs[0].tool

    def _flush_pass(seg_list: List[MoveSegment], ptype: str, op: str, tool: str) -> None:
        if not seg_list:
            return
        # Representative Z level (median/min Z of cutting moves)
        z_vals = [s.z1 for s in seg_list]
        rep_z = round(min(z_vals) / z_snap_tolerance) * z_snap_tolerance if z_snap_tolerance > 0 else min(z_vals)
        rep_z = round(rep_z, 3)

        p_dist = sum(_seg_length(s) for s in seg_list)
        if ptype == "RAPID":
            p_dur = (p_dist / max(1.0, rapid_rate_mm_min)) * 60.0
        else:
            p_dur = sum((_seg_length(s) / max(1.0, s.feed)) * 60.0 for s in seg_list)

        passes.append(
            ToolpathPass(
                pass_id=len(passes) + 1,
                pass_type=ptype,
                z_level=rep_z,
                operation=op,
                tool=tool,
                start_line=seg_list[0].line_num,
                end_line=seg_list[-1].line_num,
                segments=seg_list,
                distance=p_dist,
                duration_sec=p_dur,
                visible=True,
            )
        )

    for s in segs:
        s_type = "RAPID" if s.move_type == "RAPID" else "CUT"
        if (
            s_type != cur_type
            or s.operation != cur_op
            or s.tool != cur_tool
        ):
            _flush_pass(cur_segs, cur_type, cur_op, cur_tool)
            cur_segs = [s]
            cur_type = s_type
            cur_op = s.operation
            cur_tool = s.tool
        else:
            cur_segs.append(s)

    _flush_pass(cur_segs, cur_type, cur_op, cur_tool)

    # Apply LOD decimation if requested or triggered by segment volume
    apply_tol = 0.0
    if lod_mode == "fast":
        apply_tol = 0.08
    elif lod_mode == "auto" and len(segs) > auto_lod_threshold:
        apply_tol = 0.04

    rendered_segments = 0
    if apply_tol > 0.0:
        for p in passes:
            if p.pass_type == "CUT" and len(p.segments) > 12:
                p.segments = decimate_segments(p.segments, tolerance=apply_tol)
            rendered_segments += len(p.segments)
    else:
        rendered_segments = len(segs)

    # Index passes by Z-level
    z_index: Dict[float, List[int]] = {}
    ops_set = set()
    cut_passes_cnt = 0
    rapid_passes_cnt = 0
    for p in passes:
        ops_set.add(p.operation)
        if p.pass_type == "CUT":
            cut_passes_cnt += 1
        else:
            rapid_passes_cnt += 1
        z_index.setdefault(p.z_level, []).append(p.pass_id)

    stats = ProgramStats(
        total_passes=len(passes),
        cutting_passes=cut_passes_cnt,
        rapid_passes=rapid_passes_cnt,
        z_levels_count=len(z_index),
        operations_count=len(ops_set),
        total_segments=len(segs),
        rendered_segments=rendered_segments,
        decimation_ratio=(rendered_segments / max(1, len(segs))),
        cutting_distance=cut_dist,
        rapid_distance=rapid_dist,
        total_distance=cut_dist + rapid_dist,
        est_cycle_time_sec=cut_time_sec + rapid_time_sec,
        x_min=x_min, x_max=x_max,
        y_min=y_min, y_max=y_max,
        z_min=z_min, z_max=z_max,
        line_count=parsed.total_lines,
    )
    return passes, stats, z_index
