"""
exporter.py — Export processed pass lines, re-indexed G-code (.nc), summary (.txt), and CSV (.csv).
"""

from __future__ import annotations

import csv
from typing import List

from pass_generator import ProgramStats, ToolpathPass


def export_reindexed_nc(filepath: str, passes: List[ToolpathPass], program_name: str = "PAAS_WIVER_EXPORT") -> None:
    """Write a cleaned, re-indexed ISO G-code program with NX-style pass comments."""
    with open(filepath, "w", encoding="utf-8") as f:
        f.write("%\n")
        f.write(f"({program_name} — Re-indexed Pass Export)\n")
        f.write("G90 G17 G21\n")
        seq = 10
        last_op = ""
        last_tool = ""
        for p in passes:
            if not p.visible:
                continue
            if p.operation != last_op:
                f.write(f"(Operation: {p.operation})\n")
                last_op = p.operation
            if p.tool != last_tool:
                f.write(f"N{seq:04d} {p.tool} M06\n")
                seq += 10
                last_tool = p.tool
            f.write(f"(Pass #{p.pass_id} | {p.pass_type} | Z={p.z_level:.3f})\n")
            for idx, s in enumerate(p.segments):
                if idx == 0:
                    gcode = "G00" if p.pass_type == "RAPID" else "G01"
                    f.write(f"N{seq:04d} {gcode} X{s.x0:.3f} Y{s.y0:.3f} Z{s.z0:.3f}\n")
                    seq += 10
                gcode = "G00" if s.move_type == "RAPID" else "G01"
                feed_part = f" F{s.feed:.1f}" if s.move_type != "RAPID" else ""
                f.write(f"N{seq:04d} {gcode} X{s.x1:.3f} Y{s.y1:.3f} Z{s.z1:.3f}{feed_part}\n")
                seq += 10
        f.write(f"N{seq:04d} M30\n%\n")


def export_pass_summary_txt(filepath: str, passes: List[ToolpathPass], stats: ProgramStats, source_format: str) -> None:
    """Write a human-readable shop-floor pass summary report."""
    with open(filepath, "w", encoding="utf-8") as f:
        f.write("PAAS WIVER — Toolpath Pass Summary\n")
        f.write("=" * 52 + "\n")
        f.write(f"Detected Format : {source_format}\n")
        f.write(f"Total Lines     : {stats.line_count}\n")
        f.write(f"Total Passes    : {stats.total_passes} (Cut: {stats.cutting_passes}, Rapid: {stats.rapid_passes})\n")
        f.write(f"Z-Levels        : {stats.z_levels_count}\n")
        f.write(f"Cutting Dist    : {stats.cutting_distance:.2f} mm\n")
        f.write(f"Rapid Dist      : {stats.rapid_distance:.2f} mm\n")
        f.write(f"Est. Cycle Time : {stats.est_cycle_time_sec / 60.0:.2f} min ({stats.est_cycle_time_sec:.1f} s)\n")
        f.write(f"X Bounds        : [{stats.x_min:.3f}, {stats.x_max:.3f}]\n")
        f.write(f"Y Bounds        : [{stats.y_min:.3f}, {stats.y_max:.3f}]\n")
        f.write(f"Z Bounds        : [{stats.z_min:.3f}, {stats.z_max:.3f}]\n\n")
        f.write(f"{'Pass':>5} {'Type':<6} {'Z-Level':>9} {'Lines':>13} {'Dist(mm)':>10} {'Time(s)':>9}  Operation\n")
        f.write("-" * 78 + "\n")
        for p in passes:
            lines_rng = f"{p.start_line}-{p.end_line}"
            f.write(
                f"{p.pass_id:>5} {p.pass_type:<6} {p.z_level:>9.3f} {lines_rng:>13} "
                f"{p.distance:>10.2f} {p.duration_sec:>9.2f}  {p.operation}\n"
            )


def export_passes_csv(filepath: str, passes: List[ToolpathPass]) -> None:
    """Export pass-by-pass coordinates and metrics to CSV."""
    with open(filepath, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow([
            "pass_id", "pass_type", "operation", "tool", "z_level",
            "line_num", "move_type", "x0", "y0", "z0", "x1", "y1", "z1", "feed", "spindle"
        ])
        for p in passes:
            if not p.visible:
                continue
            for s in p.segments:
                writer.writerow([
                    p.pass_id, p.pass_type, p.operation, p.tool, f"{p.z_level:.3f}",
                    s.line_num, s.move_type,
                    f"{s.x0:.4f}", f"{s.y0:.4f}", f"{s.z0:.4f}",
                    f"{s.x1:.4f}", f"{s.y1:.4f}", f"{s.z1:.4f}",
                    f"{s.feed:.1f}", f"{s.spindle:.0f}",
                ])
