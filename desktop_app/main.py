"""
main.py — PAAS WIVER Desktop Application (Low-End Windows PC Edition)

Lightweight shop-floor CAD/CAM toolpath pass inspector built on Python's
standard Tkinter library (~25 MB RAM, instant startup, zero GPU bloat).

Run:
    python main.py
"""

from __future__ import annotations

import os
import threading
import tkinter as tk
from tkinter import filedialog, messagebox, ttk
from typing import Dict, List, Optional

from exporter import export_pass_summary_txt, export_passes_csv, export_reindexed_nc
from parser import ParseResult, parse_file_streaming
from pass_generator import ProgramStats, ToolpathPass, generate_passes
from viewer import ToolpathCanvas


class PaasWiverApp:
    def __init__(self, root: tk.Tk) -> None:
        self.root = root
        self.root.title("PAAS WIVER — Low-Spec CNC / NX / Delcam Pass Inspector")
        self.root.geometry("1360x820")
        self.root.minsize(1024, 660)
        self.root.configure(bg="#0B0F17")

        self.parse_result: Optional[ParseResult] = None
        self.passes: List[ToolpathPass] = []
        self.stats: Optional[ProgramStats] = None
        self.z_index: Dict[float, List[int]] = {}
        self.current_filename = ""

        # Playback state
        self.is_playing = False
        self._play_after_id: Optional[str] = None
        self.play_step = 0
        self.play_speed_var = tk.IntVar(value=6)

        # Filter & display state
        self.lod_var = tk.StringVar(value="auto")
        self.show_cut_var = tk.BooleanVar(value=True)
        self.show_rapid_var = tk.BooleanVar(value=True)
        self.show_arrows_var = tk.BooleanVar(value=True)
        self.show_markers_var = tk.BooleanVar(value=True)
        self.color_z_var = tk.BooleanVar(value=False)

        self._configure_styles()
        self._build_ui()

        # Press Esc anywhere to deselect highlighted NC line and pass
        self.root.bind_all("<Escape>", lambda _e: self.clear_selection())

    def _configure_styles(self) -> None:
        style = ttk.Style()
        try:
            style.theme_use("clam")
        except tk.TclError:
            pass
        style.configure("Dark.TFrame", background="#111827")
        style.configure("Panel.TFrame", background="#111827")
        style.configure("Dark.TLabel", background="#111827", foreground="#E2E8F0", font=("Segoe UI", 9))
        style.configure("Muted.TLabel", background="#111827", foreground="#94A3B8", font=("Segoe UI", 9))
        style.configure("Title.TLabel", background="#111827", foreground="#F8FAFC", font=("Segoe UI", 10, "bold"))
        style.configure("Dark.TCheckbutton", background="#111827", foreground="#CBD5E1", font=("Segoe UI", 9))
        style.configure(
            "Treeview",
            background="#0F172A",
            foreground="#E2E8F0",
            fieldbackground="#0F172A",
            borderwidth=0,
            rowheight=24,
            font=("Consolas", 9),
        )
        style.configure("Treeview.Heading", background="#1E293B", foreground="#94A3B8", font=("Segoe UI", 9, "bold"))
        style.map("Treeview", background=[("selected", "#0E7490")], foreground=[("selected", "#FFFFFF")])

    def _build_ui(self) -> None:
        # ── Top Toolbar ────────────────────────────────────────────────────────
        toolbar = tk.Frame(self.root, bg="#111827", height=44, highlightbackground="#1E293B", highlightthickness=1)
        toolbar.pack(side=tk.TOP, fill=tk.X)

        def btn(parent: tk.Misc, text: str, cmd, accent: bool = False) -> tk.Button:
            return tk.Button(
                parent,
                text=text,
                command=cmd,
                bg="#0891B2" if accent else "#1E293B",
                fg="#FFFFFF" if accent else "#E2E8F0",
                activebackground="#06B6D4" if accent else "#334155",
                activeforeground="#FFFFFF",
                relief=tk.FLAT,
                padx=10,
                pady=4,
                font=("Segoe UI", 9, "bold" if accent else "normal"),
                cursor="hand2",
            )

        btn(toolbar, "Open NC / CL File...", self.open_file_dialog, accent=True).pack(side=tk.LEFT, padx=(10, 4), pady=6)

        tk.Frame(toolbar, bg="#334155", width=1).pack(side=tk.LEFT, fill=tk.Y, padx=8, pady=8)

        for mode, label in (("XY", "2D Top (XY)"), ("XZ", "2D Front (XZ)"), ("YZ", "2D Side (YZ)"), ("3D", "3D Wireframe")):
            btn(toolbar, label, lambda m=mode: self.canvas.set_view_mode(m)).pack(side=tk.LEFT, padx=2, pady=6)

        btn(toolbar, "Fit View", lambda: self.canvas.fit_view()).pack(side=tk.LEFT, padx=(6, 4), pady=6)

        tk.Frame(toolbar, bg="#334155", width=1).pack(side=tk.LEFT, fill=tk.Y, padx=8, pady=8)

        tk.Label(toolbar, text="LOD:", bg="#111827", fg="#94A3B8", font=("Segoe UI", 9)).pack(side=tk.LEFT, padx=(2, 2))
        lod_menu = ttk.Combobox(
            toolbar,
            textvariable=self.lod_var,
            values=["auto", "full", "fast"],
            width=6,
            state="readonly",
        )
        lod_menu.pack(side=tk.LEFT, padx=2, pady=6)
        lod_menu.bind("<<ComboboxSelected>>", lambda _e: self.rebuild_passes())

        btn(toolbar, "Export...", self.export_dialog).pack(side=tk.RIGHT, padx=10, pady=6)

        self.status_label = tk.Label(toolbar, text="Ready", bg="#111827", fg="#94A3B8", font=("Consolas", 9))
        self.status_label.pack(side=tk.RIGHT, padx=8)

        # ── Main 3-Pane Split ──────────────────────────────────────────────────
        main_pane = tk.PanedWindow(self.root, orient=tk.HORIZONTAL, bg="#1E293B", sashwidth=4, sashrelief=tk.FLAT)
        main_pane.pack(side=tk.TOP, fill=tk.BOTH, expand=True)

        # Left Panel: Stats & Pass/Z-Level Tree
        left_panel = ttk.Frame(main_pane, style="Panel.TFrame", width=290)
        main_pane.add(left_panel, minsize=250)

        ttk.Label(left_panel, text="Program Statistics", style="Title.TLabel").pack(anchor="w", padx=10, pady=(10, 4))
        self.stats_text = tk.Text(
            left_panel,
            height=11,
            bg="#0B0F17",
            fg="#CBD5E1",
            font=("Consolas", 9),
            relief=tk.FLAT,
            padx=8,
            pady=6,
            state=tk.DISABLED,
        )
        self.stats_text.pack(fill=tk.X, padx=10, pady=(0, 8))

        # Visibility Toggles
        toggles = ttk.Frame(left_panel, style="Panel.TFrame")
        toggles.pack(fill=tk.X, padx=10, pady=(0, 8))
        ttk.Checkbutton(toggles, text="Cutting Passes", variable=self.show_cut_var, command=self._apply_display_flags, style="Dark.TCheckbutton").grid(row=0, column=0, sticky="w", padx=2)
        ttk.Checkbutton(toggles, text="Rapid Moves", variable=self.show_rapid_var, command=self._apply_display_flags, style="Dark.TCheckbutton").grid(row=0, column=1, sticky="w", padx=2)
        ttk.Checkbutton(toggles, text="Direction Ticks", variable=self.show_arrows_var, command=self._apply_display_flags, style="Dark.TCheckbutton").grid(row=1, column=0, sticky="w", padx=2)
        ttk.Checkbutton(toggles, text="Start / End", variable=self.show_markers_var, command=self._apply_display_flags, style="Dark.TCheckbutton").grid(row=1, column=1, sticky="w", padx=2)
        ttk.Checkbutton(toggles, text="Color by Z-Level", variable=self.color_z_var, command=self._apply_display_flags, style="Dark.TCheckbutton").grid(row=2, column=0, columnspan=2, sticky="w", padx=2)

        ttk.Label(left_panel, text="Passes & Z-Levels (Double-click to toggle)", style="Title.TLabel").pack(anchor="w", padx=10, pady=(4, 4))
        tree_wrap = tk.Frame(left_panel, bg="#0F172A")
        tree_wrap.pack(fill=tk.BOTH, expand=True, padx=10, pady=(0, 10))
        self.pass_tree = ttk.Treeview(tree_wrap, columns=("type", "z", "dist"), show="tree headings", selectmode="browse")
        self.pass_tree.heading("#0", text="Pass / Z")
        self.pass_tree.heading("type", text="Type")
        self.pass_tree.heading("z", text="Z (mm)")
        self.pass_tree.heading("dist", text="Dist")
        self.pass_tree.column("#0", width=95)
        self.pass_tree.column("type", width=52, anchor="center")
        self.pass_tree.column("z", width=62, anchor="e")
        self.pass_tree.column("dist", width=62, anchor="e")
        ysb = ttk.Scrollbar(tree_wrap, orient=tk.VERTICAL, command=self.pass_tree.yview)
        self.pass_tree.configure(yscrollcommand=ysb.set)
        self.pass_tree.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        ysb.pack(side=tk.RIGHT, fill=tk.Y)
        self.pass_tree.bind("<<TreeviewSelect>>", self._on_tree_select)
        self.pass_tree.bind("<Double-1>", self._on_tree_double_click)

        # Center Panel: Canvas + Playback Simulation Bar
        center_panel = tk.Frame(main_pane, bg="#0B0F17")
        main_pane.add(center_panel, minsize=520)

        self.canvas = ToolpathCanvas(center_panel, on_select_segment=self._on_canvas_pick)
        self.canvas.pack(side=tk.TOP, fill=tk.BOTH, expand=True)

        # Playback Bar
        play_bar = tk.Frame(center_panel, bg="#111827", height=44, highlightbackground="#1E293B", highlightthickness=1)
        play_bar.pack(side=tk.BOTTOM, fill=tk.X)

        self.play_btn = btn(play_bar, "Play", self.toggle_play, accent=True)
        self.play_btn.pack(side=tk.LEFT, padx=(10, 4), pady=6)
        btn(play_bar, "Reset", self.reset_playback).pack(side=tk.LEFT, padx=2, pady=6)
        btn(play_bar, "Prev Pass", lambda: self.step_pass(-1)).pack(side=tk.LEFT, padx=2, pady=6)
        btn(play_bar, "Next Pass", lambda: self.step_pass(1)).pack(side=tk.LEFT, padx=2, pady=6)

        self.progress_var = tk.IntVar(value=0)
        self.progress_scale = tk.Scale(
            play_bar,
            from_=0,
            to=100,
            orient=tk.HORIZONTAL,
            variable=self.progress_var,
            command=self._on_slider_move,
            bg="#111827",
            fg="#94A3B8",
            troughcolor="#1E293B",
            highlightthickness=0,
            showvalue=False,
        )
        self.progress_scale.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=10)

        tk.Label(play_bar, text="Speed:", bg="#111827", fg="#94A3B8", font=("Segoe UI", 9)).pack(side=tk.LEFT)
        ttk.Combobox(play_bar, textvariable=self.play_speed_var, values=[1, 3, 6, 15, 40], width=4, state="readonly").pack(side=tk.LEFT, padx=(4, 10))

        # Right Panel: Raw NC Line Inspector
        right_panel = ttk.Frame(main_pane, style="Panel.TFrame", width=330)
        main_pane.add(right_panel, minsize=250)

        right_hdr = ttk.Frame(right_panel, style="Panel.TFrame")
        right_hdr.pack(fill=tk.X, padx=10, pady=(10, 4))
        ttk.Label(right_hdr, text="Raw NC / CL Line Inspector", style="Title.TLabel").pack(side=tk.LEFT)
        btn(right_hdr, "Deselect (Esc)", self.clear_selection).pack(side=tk.RIGHT)

        self.nc_list = tk.Listbox(
            right_panel,
            bg="#0B0F17",
            fg="#CBD5E1",
            selectbackground="#0E7490",
            selectforeground="#FFFFFF",
            font=("Consolas", 9),
            relief=tk.FLAT,
            activestyle="none",
        )
        nc_scroll = ttk.Scrollbar(right_panel, orient=tk.VERTICAL, command=self.nc_list.yview)
        self.nc_list.configure(yscrollcommand=nc_scroll.set)
        self.nc_list.pack(side=tk.LEFT, fill=tk.BOTH, expand=True, padx=(10, 0), pady=(0, 10))
        nc_scroll.pack(side=tk.RIGHT, fill=tk.Y, padx=(0, 10), pady=(0, 10))
        self.nc_list.bind("<<ListboxSelect>>", self._on_nc_line_click)

    def _apply_display_flags(self) -> None:
        self.canvas.show_cutting = self.show_cut_var.get()
        self.canvas.show_rapids = self.show_rapid_var.get()
        self.canvas.show_arrows = self.show_arrows_var.get()
        self.canvas.show_markers = self.show_markers_var.get()
        self.canvas.color_by_z = self.color_z_var.get()
        self.canvas.redraw()

    def clear_selection(self) -> None:
        self.canvas.selected_pass_id = None
        self.canvas.selected_line_num = None
        self.canvas.redraw()
        self.pass_tree.selection_remove(self.pass_tree.selection())
        self.nc_list.selection_clear(0, tk.END)

    def open_file_dialog(self) -> None:
        path = filedialog.askopenfilename(
            title="Open CNC / NX / Delcam Toolpath File",
            filetypes=[
                ("CNC & Toolpath Files", "*.nc *.tap *.ptp *.cnc *.mpf *.txt *.cls *.gcode"),
                ("All Files", "*.*"),
            ],
        )
        if not path:
            return
        self.stop_play()
        self.current_filename = os.path.basename(path)
        self.status_label.config(text=f"Streaming {self.current_filename}...")

        def worker() -> None:
            try:
                res = parse_file_streaming(
                    path,
                    progress_cb=lambda ln: self.root.after(0, lambda n=ln: self.status_label.config(text=f"Parsed {n:,} lines...")),
                )
                self.root.after(0, lambda: self._apply_parse_result(res))
            except Exception as exc:
                self.root.after(0, lambda: messagebox.showerror("Import Error", str(exc)))

        threading.Thread(target=worker, daemon=True).start()

    def _apply_parse_result(self, res: ParseResult) -> None:
        self.parse_result = res
        self.rebuild_passes()
        self._populate_nc_inspector()

    def rebuild_passes(self) -> None:
        if not self.parse_result:
            return
        passes, stats, z_idx = generate_passes(self.parse_result, lod_mode=self.lod_var.get())
        self.passes = passes
        self.stats = stats
        self.z_index = z_idx
        self.canvas.set_data(passes, stats)

        # Configure playback slider
        total_render = max(1, stats.rendered_segments)
        self.progress_scale.configure(to=total_render)
        self.play_step = total_render
        self.progress_var.set(total_render)
        self.canvas.max_segment_index = None

        self._update_stats_panel()
        self._populate_pass_tree()
        lod_pct = int(round(stats.decimation_ratio * 100))
        self.status_label.config(text=f"{self.current_filename} | {self.parse_result.source_format} | LOD {lod_pct}%")

    def _update_stats_panel(self) -> None:
        if not self.stats or not self.parse_result:
            return
        s = self.stats
        lines = [
            f"Format     : {self.parse_result.source_format}",
            f"Lines      : {s.line_count:,}",
            f"Passes     : {s.total_passes} ({s.cutting_passes} cut / {s.rapid_passes} rapid)",
            f"Z-Levels   : {s.z_levels_count}   Ops: {s.operations_count}",
            f"Segments   : {s.rendered_segments:,} / {s.total_segments:,}",
            f"Cut Dist   : {s.cutting_distance:,.1f} {self.parse_result.units}",
            f"Rapid Dist : {s.rapid_distance:,.1f} {self.parse_result.units}",
            f"Cycle Est. : {s.est_cycle_time_sec / 60.0:.2f} min",
            f"X Bounds   : {s.x_min:.2f} .. {s.x_max:.2f}",
            f"Y Bounds   : {s.y_min:.2f} .. {s.y_max:.2f}",
            f"Z Bounds   : {s.z_min:.2f} .. {s.z_max:.2f}",
        ]
        self.stats_text.configure(state=tk.NORMAL)
        self.stats_text.delete("1.0", tk.END)
        self.stats_text.insert("1.0", "\n".join(lines))
        self.stats_text.configure(state=tk.DISABLED)

    def _populate_pass_tree(self) -> None:
        self.pass_tree.delete(*self.pass_tree.get_children())
        for p in self.passes:
            vis = "●" if p.visible else "○"
            self.pass_tree.insert(
                "",
                tk.END,
                iid=str(p.pass_id),
                text=f"{vis} Pass {p.pass_id}",
                values=(p.pass_type, f"{p.z_level:.2f}", f"{p.distance:.1f}"),
            )

    def _populate_nc_inspector(self) -> None:
        self.nc_list.delete(0, tk.END)
        if not self.parse_result:
            return
        # Cap initial listbox insertion cleanly if enormous while keeping fast response
        max_show = min(len(self.parse_result.raw_lines), 50000)
        for idx in range(max_show):
            self.nc_list.insert(tk.END, f"{idx + 1:>5}: {self.parse_result.raw_lines[idx]}")

    def _on_tree_select(self, _e: tk.Event) -> None:
        sel = self.pass_tree.selection()
        if not sel:
            return
        pid = int(sel[0])
        self.canvas.selected_pass_id = pid
        self.canvas.selected_line_num = None
        self.canvas.redraw()
        for p in self.passes:
            if p.pass_id == pid:
                idx = max(0, p.start_line - 1)
                if idx < self.nc_list.size():
                    self.nc_list.selection_clear(0, tk.END)
                    self.nc_list.selection_set(idx)
                    self.nc_list.see(idx)
                break

    def _on_tree_double_click(self, _e: tk.Event) -> None:
        sel = self.pass_tree.selection()
        if not sel:
            return
        pid = int(sel[0])
        for p in self.passes:
            if p.pass_id == pid:
                p.visible = not p.visible
                vis = "●" if p.visible else "○"
                self.pass_tree.item(str(pid), text=f"{vis} Pass {p.pass_id}")
                self.canvas.redraw()
                break

    def _on_canvas_pick(self, pass_id: int, line_num: int) -> None:
        if pass_id == 0 and line_num == 0:
            self.clear_selection()
            return
        if self.pass_tree.exists(str(pass_id)):
            self.pass_tree.selection_set(str(pass_id))
            self.pass_tree.see(str(pass_id))
        idx = max(0, line_num - 1)
        if idx < self.nc_list.size():
            self.nc_list.selection_clear(0, tk.END)
            self.nc_list.selection_set(idx)
            self.nc_list.see(idx)

    def _on_nc_line_click(self, _e: tk.Event) -> None:
        sel = self.nc_list.curselection()
        if not sel:
            return
        line_num = sel[0] + 1
        if self.canvas.selected_line_num == line_num:
            self.clear_selection()
            return
        self.canvas.selected_line_num = line_num
        self.canvas.redraw()

    def toggle_play(self) -> None:
        if self.is_playing:
            self.stop_play()
            return
        if not self.stats or self.stats.rendered_segments == 0:
            return
        if self.play_step >= self.stats.rendered_segments:
            self.play_step = 0
        self.is_playing = True
        self.play_btn.config(text="Pause")
        self._tick_play()

    def stop_play(self) -> None:
        self.is_playing = False
        self.play_btn.config(text="Play")
        if self._play_after_id:
            self.root.after_cancel(self._play_after_id)
            self._play_after_id = None

    def reset_playback(self) -> None:
        self.stop_play()
        self.play_step = 0
        self.progress_var.set(0)
        self.canvas.max_segment_index = 0
        self.canvas.redraw()

    def step_pass(self, delta: int) -> None:
        self.stop_play()
        if not self.passes:
            return
        cum = 0
        boundaries = [0]
        for p in self.passes:
            cum += len(p.segments)
            boundaries.append(cum)
        if delta > 0:
            nxt = next((b for b in boundaries if b > self.play_step), boundaries[-1])
        else:
            prevs = [b for b in boundaries if b < self.play_step]
            nxt = prevs[-1] if prevs else 0
        self.play_step = nxt
        self.progress_var.set(nxt)
        self.canvas.max_segment_index = None if nxt >= boundaries[-1] else nxt
        self.canvas.redraw()

    def _on_slider_move(self, val_str: str) -> None:
        if not self.stats:
            return
        val = int(float(val_str))
        self.play_step = val
        self.canvas.max_segment_index = None if val >= self.stats.rendered_segments else val
        self.canvas.redraw()

    def _tick_play(self) -> None:
        if not self.is_playing or not self.stats:
            return
        step = max(1, int(self.play_speed_var.get()))
        self.play_step = min(self.stats.rendered_segments, self.play_step + step)
        self.progress_var.set(self.play_step)
        self.canvas.max_segment_index = self.play_step
        self.canvas.redraw()
        if self.play_step >= self.stats.rendered_segments:
            self.canvas.max_segment_index = None
            self.stop_play()
            return
        self._play_after_id = self.root.after(28, self._tick_play)

    def export_dialog(self) -> None:
        if not self.passes or not self.stats or not self.parse_result:
            messagebox.showinfo("Nothing to Export", "Load an NC file or sample first.")
            return
        path = filedialog.asksaveasfilename(
            title="Export Processed Pass File",
            defaultextension=".nc",
            filetypes=[
                ("Re-indexed G-Code (.nc)", "*.nc"),
                ("Pass Summary (.txt)", "*.txt"),
                ("Pass Coordinates (.csv)", "*.csv"),
            ],
        )
        if not path:
            return
        ext = os.path.splitext(path)[1].lower()
        if ext == ".csv":
            export_passes_csv(path, self.passes)
        elif ext == ".txt":
            export_pass_summary_txt(path, self.passes, self.stats, self.parse_result.source_format)
        else:
            export_reindexed_nc(path, self.passes)
        messagebox.showinfo("Export Complete", f"Saved processed toolpath to:\n{path}")


def main() -> None:
    root = tk.Tk()
    PaasWiverApp(root)
    root.mainloop()


if __name__ == "__main__":
    main()
