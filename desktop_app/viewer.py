"""
viewer.py — Lightweight Tkinter Canvas 2D/3D Wireframe Toolpath Renderer.

Optimized for low-end Windows PCs (integrated Intel graphics, low RAM):
- Pure Tkinter Canvas GDI vector drawing (zero OpenGL / WebGL / matplotlib overhead).
- Supports 2D Top (XY), 2D Front (XZ), 2D Side (YZ), and 3D Wireframe Orbit.
- Interactive pan, cursor-centered zoom, fit-to-view, and click-to-pick segment/pass.
- Draws NX-style dashed rapid moves, solid cutting passes, start/end markers, and direction ticks.
"""

from __future__ import annotations

import math
import tkinter as tk
from typing import Callable, Dict, List, Optional, Tuple

from parser import MoveSegment
from pass_generator import ProgramStats, ToolpathPass


# Calibrated Z-level ramp (cyan -> emerald -> blue -> violet)
_Z_PALETTE = [
    "#06B6D4", "#10B981", "#3B82F6", "#6366F1", "#14B8A6", "#0EA5E9", "#22C55E"
]


class ToolpathCanvas(tk.Canvas):
    """High-performance 2D/3D wireframe viewport for CNC pass lines."""

    def __init__(self, master: tk.Misc, on_select_segment: Optional[Callable[[int, int], None]] = None, **kwargs) -> None:
        super().__init__(master, bg="#0B0F17", highlightthickness=0, **kwargs)
        self.on_select_segment = on_select_segment

        self.passes: List[ToolpathPass] = []
        self.stats: Optional[ProgramStats] = None
        self.view_mode = "XY"  # "XY" | "XZ" | "YZ" | "3D"

        # Display flags
        self.show_cutting = True
        self.show_rapids = True
        self.show_arrows = True
        self.show_markers = True
        self.color_by_z = False

        # Playback limit (None = show all visible passes)
        self.max_segment_index: Optional[int] = None
        self.selected_pass_id: Optional[int] = None
        self.selected_line_num: Optional[int] = None

        # Viewport transform state
        self.scale = 3.0
        self.pan_x = 0.0
        self.pan_y = 0.0
        self.yaw = -0.65
        self.pitch = 0.72
        self.center = [0.0, 0.0, 0.0]

        # Interaction state
        self._drag_mode: Optional[str] = None
        self._last_mx = 0
        self._last_my = 0
        self._drag_moved = False

        # Screen-space cache for fast click picking: list of (x0, y0, x1, y1, pass_id, line_num)
        self._pick_cache: List[Tuple[float, float, float, float, int, int]] = []
        self._z_color_map: Dict[float, str] = {}

        # Mouse & keyboard bindings
        self.bind("<Configure>", lambda _e: self.redraw())
        self.bind("<ButtonPress-1>", self._on_left_down)
        self.bind("<B1-Motion>", self._on_left_drag)
        self.bind("<ButtonRelease-1>", self._on_left_up)
        self.bind("<ButtonPress-3>", self._on_right_down)
        self.bind("<B3-Motion>", self._on_right_drag)
        self.bind("<MouseWheel>", self._on_wheel)
        self.bind("<Button-4>", lambda e: self._zoom_at(e.x, e.y, 1.15))
        self.bind("<Button-5>", lambda e: self._zoom_at(e.x, e.y, 0.87))

    def set_data(self, passes: List[ToolpathPass], stats: ProgramStats) -> None:
        self.passes = passes
        self.stats = stats
        self.max_segment_index = None
        self.selected_pass_id = None
        self.selected_line_num = None

        z_levels = sorted({p.z_level for p in passes}, reverse=True)
        self._z_color_map = {z: _Z_PALETTE[i % len(_Z_PALETTE)] for i, z in enumerate(z_levels)}

        if stats.total_segments > 0:
            self.center = [
                (stats.x_min + stats.x_max) * 0.5,
                (stats.y_min + stats.y_max) * 0.5,
                (stats.z_min + stats.z_max) * 0.5,
            ]
        self.fit_view()

    def set_view_mode(self, mode: str) -> None:
        self.view_mode = mode
        self.fit_view()

    def fit_view(self) -> None:
        w = max(self.winfo_width(), 600)
        h = max(self.winfo_height(), 400)
        if not self.stats or self.stats.total_segments == 0:
            self.scale = 3.0
            self.pan_x = w * 0.5
            self.pan_y = h * 0.5
            self.redraw()
            return

        dx = max(10.0, self.stats.x_max - self.stats.x_min)
        dy = max(10.0, self.stats.y_max - self.stats.y_min)
        dz = max(10.0, self.stats.z_max - self.stats.z_min)

        if self.view_mode == "XY":
            span_u, span_v = dx, dy
        elif self.view_mode == "XZ":
            span_u, span_v = dx, dz
        elif self.view_mode == "YZ":
            span_u, span_v = dy, dz
        else:
            diag = math.sqrt(dx * dx + dy * dy + dz * dz)
            span_u = span_v = max(10.0, diag * 0.85)

        margin = 0.78
        self.scale = min((w * margin) / span_u, (h * margin) / span_v)
        self.pan_x = w * 0.5
        self.pan_y = h * 0.5
        self.redraw()

    def _project(self, x: float, y: float, z: float) -> Tuple[float, float]:
        cx, cy, cz = self.center
        rx, ry, rz = x - cx, y - cy, z - cz

        if self.view_mode == "XY":
            u, v = rx, -ry
        elif self.view_mode == "XZ":
            u, v = rx, -rz
        elif self.view_mode == "YZ":
            u, v = ry, -rz
        else:
            # Lightweight 3D rotation (yaw around Z, pitch around X)
            cyaw, syaw = math.cos(self.yaw), math.sin(self.yaw)
            cpit, spit = math.cos(self.pitch), math.sin(self.pitch)
            x1 = rx * cyaw - ry * syaw
            y1 = rx * syaw + ry * cyaw
            y2 = y1 * cpit - rz * spit
            u = x1
            v = -y2

        return self.pan_x + u * self.scale, self.pan_y + v * self.scale

    def _draw_grid(self, w: int, h: int) -> None:
        step_world = 10.0
        px_step = step_world * self.scale
        while px_step < 32.0:
            step_world *= 2.0
            px_step = step_world * self.scale
        while px_step > 140.0 and step_world > 1.0:
            step_world *= 0.5
            px_step = step_world * self.scale

        ox, oy = self._project(0.0, 0.0, 0.0)
        start_x = ox % px_step
        x = start_x
        while x < w:
            self.create_line(x, 0, x, h, fill="#141B28")
            x += px_step

        start_y = oy % px_step
        y = start_y
        while y < h:
            self.create_line(0, y, w, y, fill="#141B28")
            y += px_step

        # Origin triad
        ax_len = 22.0 / max(0.01, self.scale)
        p0 = self._project(0.0, 0.0, 0.0)
        px = self._project(ax_len, 0.0, 0.0)
        py = self._project(0.0, ax_len, 0.0)
        pz = self._project(0.0, 0.0, ax_len)
        self.create_line(p0[0], p0[1], px[0], px[1], fill="#EF4444", width=1.5)
        self.create_line(p0[0], p0[1], py[0], py[1], fill="#22C55E", width=1.5)
        self.create_line(p0[0], p0[1], pz[0], pz[1], fill="#3B82F6", width=1.5)

    def redraw(self) -> None:
        self.delete("all")
        self._pick_cache.clear()
        w = max(self.winfo_width(), 2)
        h = max(self.winfo_height(), 2)

        self._draw_grid(w, h)

        if not self.passes:
            self.create_text(
                w * 0.5, h * 0.5,
                text="Click 'Open NC / CL File...' to inspect NX / Delcam pass lines",
                fill="#64748B",
                font=("Segoe UI", 11),
            )
            return

        seg_counter = 0
        limit = self.max_segment_index
        active_tip: Optional[Tuple[float, float]] = None

        for p in self.passes:
            if not p.visible:
                continue
            if p.pass_type == "RAPID" and not self.show_rapids:
                seg_counter += len(p.segments)
                continue
            if p.pass_type != "RAPID" and not self.show_cutting:
                seg_counter += len(p.segments)
                continue

            is_pass_selected = (self.selected_pass_id == p.pass_id)
            if p.pass_type == "RAPID":
                base_color = "#F97316" if is_pass_selected else "#B45309"
                dash_pat: Optional[Tuple[int, int]] = (4, 4)
                line_w = 2.0 if is_pass_selected else 1.0
            else:
                if is_pass_selected:
                    base_color = "#FFFFFF"
                elif self.color_by_z:
                    base_color = self._z_color_map.get(p.z_level, "#06B6D4")
                else:
                    base_color = "#06B6D4"
                dash_pat = None
                line_w = 2.4 if is_pass_selected else 1.5

            pass_first_pt: Optional[Tuple[float, float]] = None
            pass_last_pt: Optional[Tuple[float, float]] = None

            for idx, s in enumerate(p.segments):
                if limit is not None and seg_counter >= limit:
                    break
                seg_counter += 1

                sx0, sy0 = self._project(s.x0, s.y0, s.z0)
                sx1, sy1 = self._project(s.x1, s.y1, s.z1)
                active_tip = (sx1, sy1)

                if pass_first_pt is None:
                    pass_first_pt = (sx0, sy0)
                pass_last_pt = (sx1, sy1)

                # Frustum cull off-screen segments for huge speed boost on low-end PCs
                if max(sx0, sx1) < -20 or min(sx0, sx1) > w + 20 or max(sy0, sy1) < -20 or min(sy0, sy1) > h + 20:
                    continue

                seg_color = "#FACC15" if self.selected_line_num == s.line_num else base_color
                seg_width = 3.0 if self.selected_line_num == s.line_num else line_w

                if dash_pat:
                    self.create_line(sx0, sy0, sx1, sy1, fill=seg_color, width=seg_width, dash=dash_pat)
                else:
                    self.create_line(sx0, sy0, sx1, sy1, fill=seg_color, width=seg_width)

                self._pick_cache.append((sx0, sy0, sx1, sy1, p.pass_id, s.line_num))

                # Direction tick on longer cutting segments
                if self.show_arrows and p.pass_type != "RAPID" and (idx % 3 == 0):
                    dx = sx1 - sx0
                    dy = sy1 - sy0
                    plen = math.hypot(dx, dy)
                    if plen >= 20.0:
                        mx, my = (sx0 + sx1) * 0.5, (sy0 + sy1) * 0.5
                        ux, uy = dx / plen, dy / plen
                        sz = 4.5
                        self.create_line(
                            mx - ux * sz - uy * sz * 0.65,
                            my - uy * sz + ux * sz * 0.65,
                            mx + ux * 1.5,
                            my + uy * 1.5,
                            mx - ux * sz + uy * sz * 0.65,
                            my - uy * sz - ux * sz * 0.65,
                            fill=seg_color,
                            width=1.3,
                        )

            if self.show_markers and p.pass_type != "RAPID" and pass_first_pt and pass_last_pt:
                fx, fy = pass_first_pt
                lx, ly = pass_last_pt
                self.create_oval(fx - 3, fy - 3, fx + 3, fy + 3, fill="#10B981", outline="")
                self.create_rectangle(lx - 2.5, ly - 2.5, lx + 2.5, ly + 2.5, fill="#EF4444", outline="")

            if limit is not None and seg_counter >= limit:
                break

        # Active simulation tool tip reticle
        if limit is not None and active_tip is not None:
            tx, ty = active_tip
            self.create_oval(tx - 6, ty - 6, tx + 6, ty + 6, outline="#FACC15", width=2)

    def _on_left_down(self, event: tk.Event) -> None:
        self._last_mx, self._last_my = event.x, event.y
        self._drag_moved = False
        self._drag_mode = "orbit" if self.view_mode == "3D" else "pan"

    def _on_left_drag(self, event: tk.Event) -> None:
        dx = event.x - self._last_mx
        dy = event.y - self._last_my
        if abs(dx) > 2 or abs(dy) > 2:
            self._drag_moved = True
        if self._drag_mode == "orbit":
            self.yaw += dx * 0.008
            self.pitch = max(-1.55, min(1.55, self.pitch + dy * 0.008))
        else:
            self.pan_x += dx
            self.pan_y += dy
        self._last_mx, self._last_my = event.x, event.y
        self.redraw()

    def _on_left_up(self, event: tk.Event) -> None:
        if not self._drag_moved:
            self._pick_nearest(event.x, event.y)
        self._drag_mode = None

    def _on_right_down(self, event: tk.Event) -> None:
        self._last_mx, self._last_my = event.x, event.y

    def _on_right_drag(self, event: tk.Event) -> None:
        self.pan_x += event.x - self._last_mx
        self.pan_y += event.y - self._last_my
        self._last_mx, self._last_my = event.x, event.y
        self.redraw()

    def _on_wheel(self, event: tk.Event) -> None:
        factor = 1.15 if event.delta > 0 else 0.87
        self._zoom_at(event.x, event.y, factor)

    def _zoom_at(self, mx: float, my: float, factor: float) -> None:
        new_scale = max(0.05, min(120.0, self.scale * factor))
        ratio = new_scale / self.scale
        self.pan_x = mx - (mx - self.pan_x) * ratio
        self.pan_y = my - (my - self.pan_y) * ratio
        self.scale = new_scale
        self.redraw()

    def _pick_nearest(self, mx: float, my: float) -> None:
        best_dist2 = 100.0  # 10 px threshold
        best_pick: Optional[Tuple[int, int]] = None
        for x0, y0, x1, y1, pid, lnum in self._pick_cache:
            vx, vy = x1 - x0, y1 - y0
            len2 = vx * vx + vy * vy
            if len2 < 1e-6:
                t = 0.0
            else:
                t = max(0.0, min(1.0, ((mx - x0) * vx + (my - y0) * vy) / len2))
            px = x0 + t * vx
            py = y0 + t * vy
            d2 = (mx - px) ** 2 + (my - py) ** 2
            if d2 < best_dist2:
                best_dist2 = d2
                best_pick = (pid, lnum)

        if best_pick:
            self.selected_pass_id, self.selected_line_num = best_pick
            self.redraw()
            if self.on_select_segment:
                self.on_select_segment(best_pick[0], best_pick[1])
        else:
            self.selected_pass_id = None
            self.selected_line_num = None
            self.redraw()
            if self.on_select_segment:
                self.on_select_segment(0, 0)
