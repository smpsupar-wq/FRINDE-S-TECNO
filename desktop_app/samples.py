"""
samples.py — Built-in Siemens NX, Delcam PowerMill, and NX CL-Data sample toolpaths.
"""

from __future__ import annotations

import math


def get_nx_cavity_sample() -> str:
    """Multi-Z-level pocket & contour cavity program exported in Siemens NX (.mpf/.nc) style."""
    lines = [
        "%",
        "; SIEMENS NX CAM POSTPROCESSOR OUTPUT",
        "; PART: HOUSING_BRACKET_REV_C",
        "; OPERATION: CAVITY_MILL_ROUGH",
        "N0010 G90 G17 G21 G40 G80",
        "N0020 T01 M06",
        "N0030 S4800 M03",
        "N0040 G00 X0.000 Y0.000 Z50.000",
    ]
    seq = 50
    z_levels = [-4.0, -8.0, -12.0, -16.0]
    for idx, z in enumerate(z_levels):
        lines.append(f"; Z-LEVEL {idx + 1} (STEPDOWN Z={z:.1f})")
        lines.append(f"N{seq:04d} G00 X12.000 Y12.000 Z{z + 6.0:.3f}")
        seq += 10
        lines.append(f"N{seq:04d} G01 Z{z:.3f} F320.0")
        seq += 10
        # Outer spiral pocket rectangles with corner G02/G03 arcs
        for offset in (12.0, 22.0, 32.0):
            x_min, x_max = offset, 120.0 - offset
            y_min, y_max = offset, 85.0 - offset
            r = 5.0
            lines.append(f"N{seq:04d} G01 X{x_min:.3f} Y{y_min + r:.3f} F1100.0")
            seq += 10
            lines.append(f"N{seq:04d} G01 X{x_min:.3f} Y{y_max - r:.3f}")
            seq += 10
            lines.append(f"N{seq:04d} G02 X{x_min + r:.3f} Y{y_max:.3f} I{r:.3f} J0.000")
            seq += 10
            lines.append(f"N{seq:04d} G01 X{x_max - r:.3f} Y{y_max:.3f}")
            seq += 10
            lines.append(f"N{seq:04d} G02 X{x_max:.3f} Y{y_max - r:.3f} I0.000 J-{r:.3f}")
            seq += 10
            lines.append(f"N{seq:04d} G01 X{x_max:.3f} Y{y_min + r:.3f}")
            seq += 10
            lines.append(f"N{seq:04d} G02 X{x_max - r:.3f} Y{y_min:.3f} I-{r:.3f} J0.000")
            seq += 10
            lines.append(f"N{seq:04d} G01 X{x_min + r:.3f} Y{y_min:.3f}")
            seq += 10
            lines.append(f"N{seq:04d} G02 X{x_min:.3f} Y{y_min + r:.3f} I0.000 J{r:.3f}")
            seq += 10
        lines.append(f"N{seq:04d} G00 Z25.000")
        seq += 10

    # Finishing contour pass with T02
    lines.extend([
        "; OPERATION: ZLEVEL_PROFILE_FINISH",
        f"N{seq:04d} T02 M06",
        f"N{seq + 10:04d} S7200 M03",
        f"N{seq + 20:04d} G00 X6.000 Y6.000 Z25.000",
    ])
    seq += 30
    for z in (-8.0, -16.0):
        lines.append(f"N{seq:04d} G00 Z{z + 3.0:.3f}")
        seq += 10
        lines.append(f"N{seq:04d} G01 Z{z:.3f} F400.0")
        seq += 10
        lines.append(f"N{seq:04d} G01 X114.000 Y6.000 F1450.0")
        seq += 10
        lines.append(f"N{seq:04d} G01 X114.000 Y79.000")
        seq += 10
        lines.append(f"N{seq:04d} G01 X6.000 Y79.000")
        seq += 10
        lines.append(f"N{seq:04d} G01 X6.000 Y6.000")
        seq += 10
        lines.append(f"N{seq:04d} G00 Z30.000")
        seq += 10

    lines.append(f"N{seq:04d} M30")
    lines.append("%")
    return "\n".join(lines)


def get_delcam_raster_sample() -> str:
    """Delcam PowerMill / FeatureCAM 3D Raster Surface Finishing sample (.tap)."""
    lines = [
        "%",
        "(DELCAM POWERMILL 3D RASTER FINISH)",
        "(TOOLPATH: DOME_SURFACE_RASTER)",
        "G90 G17 G21",
        "T04 M06",
        "S9500 M03",
        "G00 X0.000 Y0.000 Z35.000",
    ]
    rows = 16
    cols = 28
    for r in range(rows):
        y = r * 5.0
        xs = [c * 4.0 for c in range(cols)]
        if r % 2 == 1:
            xs.reverse()
        # Rapid approach to row start
        z_start = -10.0 + 7.5 * math.sin(xs[0] / 34.0) * math.cos((y - 37.5) / 28.0)
        lines.append(f"G00 X{xs[0]:.3f} Y{y:.3f} Z18.000")
        lines.append(f"G01 Z{z_start:.3f} F650.0")
        for x in xs[1:]:
            z = -10.0 + 7.5 * math.sin(x / 34.0) * math.cos((y - 37.5) / 28.0)
            lines.append(f"G01 X{x:.3f} Y{y:.3f} Z{z:.3f} F1800.0")
        lines.append("G00 Z18.000")

    lines.extend([
        "G00 Z45.000",
        "M30",
        "%",
    ])
    return "\n".join(lines)


def get_nx_cldata_sample() -> str:
    """Siemens NX CLSF / APT CL-Data text file sample."""
    lines = [
        "PPRINT/ OPERATION: PLANAR_FACE_MILL",
        "LOADTL/ 03",
        "RAPID",
        "GOTO/ -10.000, 10.000, 30.000",
        "FEDRAT/ MMPM, 1200.0",
        "GOTO/ -10.000, 10.000, -2.000",
        "GOTO/ 110.000, 10.000, -2.000",
        "RAPID",
        "GOTO/ 110.000, 10.000, 15.000",
        "GOTO/ 110.000, 30.000, 15.000",
        "FEDRAT/ MMPM, 1200.0",
        "GOTO/ 110.000, 30.000, -2.000",
        "GOTO/ -10.000, 30.000, -2.000",
        "RAPID",
        "GOTO/ -10.000, 30.000, 15.000",
        "GOTO/ -10.000, 50.000, 15.000",
        "FEDRAT/ MMPM, 1200.0",
        "GOTO/ -10.000, 50.000, -2.000",
        "GOTO/ 110.000, 50.000, -2.000",
        "RAPID",
        "GOTO/ 110.000, 50.000, 40.000",
    ]
    return "\n".join(lines)
