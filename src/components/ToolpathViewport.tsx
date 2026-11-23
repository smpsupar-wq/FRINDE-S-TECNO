import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FolderOpen, Maximize2, Pause, Play, RotateCcw, SkipBack, SkipForward } from 'lucide-react';
import type { DisplayOptions, ProgramStats, ToolpathPass, ViewMode } from '../types/toolpath';

interface ToolpathViewportProps {
  passes: ToolpathPass[];
  stats: ProgramStats | null;
  units: 'mm' | 'inch';
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  display: DisplayOptions;
  selectedPassId: number | null;
  selectedLineNum: number | null;
  onSelectSegment: (passId: number, lineNum: number) => void;
  onClearSelection: () => void;
  onImportFile: () => void;
  playStep: number | null;
  isPlaying: boolean;
  playSpeed: number;
  onTogglePlay: () => void;
  onResetPlay: () => void;
  onStepPass: (delta: number) => void;
  onPlayStepChange: (step: number) => void;
  onPlaySpeedChange: (speed: number) => void;
}

const Z_PALETTE = ['#06B6D4', '#10B981', '#3B82F6', '#6366F1', '#14B8A6', '#0EA5E9', '#22C55E'];

interface PickSegment {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  passId: number;
  lineNum: number;
}

export const ToolpathViewport: React.FC<ToolpathViewportProps> = ({
  passes,
  stats,
  units,
  viewMode,
  onViewModeChange,
  display,
  selectedPassId,
  selectedLineNum,
  onSelectSegment,
  onClearSelection,
  onImportFile,
  playStep,
  isPlaying,
  playSpeed,
  onTogglePlay,
  onResetPlay,
  onStepPass,
  onPlayStepChange,
  onPlaySpeedChange,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const transformRef = useRef({
    scale: 3,
    panX: 300,
    panY: 220,
    yaw: -0.62,
    pitch: 0.72,
    cx: 0,
    cy: 0,
    cz: 0,
  });

  const dragRef = useRef<{
    active: boolean;
    mode: 'pan' | 'orbit';
    lastX: number;
    lastY: number;
    moved: boolean;
  }>({ active: false, mode: 'pan', lastX: 0, lastY: 0, moved: false });

  const pickCacheRef = useRef<PickSegment[]>([]);
  const [cursorCoords, setCursorCoords] = useState<{ u: number; v: number } | null>(null);
  const [renderTrigger, setRenderTrigger] = useState(0);

  const zColorMap = React.useMemo(() => {
    const map = new Map<number, string>();
    const zs = Array.from(new Set(passes.map((p) => p.zLevel))).sort((a, b) => b - a);
    zs.forEach((z, idx) => map.set(z, Z_PALETTE[idx % Z_PALETTE.length]));
    return map;
  }, [passes]);

  const fitView = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const w = Math.max(container.clientWidth, 400);
    const h = Math.max(container.clientHeight, 300);
    const tr = transformRef.current;

    if (!stats || stats.totalSegments === 0) {
      tr.cx = 0;
      tr.cy = 0;
      tr.cz = 0;
      tr.scale = 3;
      tr.panX = w * 0.5;
      tr.panY = h * 0.5;
      setRenderTrigger((v) => v + 1);
      return;
    }

    tr.cx = (stats.xMin + stats.xMax) * 0.5;
    tr.cy = (stats.yMin + stats.yMax) * 0.5;
    tr.cz = (stats.zMin + stats.zMax) * 0.5;

    const dx = Math.max(10, stats.xMax - stats.xMin);
    const dy = Math.max(10, stats.yMax - stats.yMin);
    const dz = Math.max(10, stats.zMax - stats.zMin);

    let spanU = dx;
    let spanV = dy;
    if (viewMode === 'XZ') {
      spanU = dx;
      spanV = dz;
    } else if (viewMode === 'YZ') {
      spanU = dy;
      spanV = dz;
    } else if (viewMode === '3D') {
      const diag = Math.sqrt(dx * dx + dy * dy + dz * dz);
      spanU = Math.max(10, diag * 0.85);
      spanV = spanU;
    }

    tr.scale = Math.min((w * 0.78) / spanU, (h * 0.78) / spanV);
    tr.panX = w * 0.5;
    tr.panY = h * 0.5;
    setRenderTrigger((v) => v + 1);
  }, [stats, viewMode]);

  useEffect(() => {
    fitView();
  }, [fitView]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(() => {
      setRenderTrigger((v) => v + 1);
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  const projectPoint = useCallback(
    (x: number, y: number, z: number): [number, number] => {
      const tr = transformRef.current;
      const rx = x - tr.cx;
      const ry = y - tr.cy;
      const rz = z - tr.cz;
      let u = 0;
      let v = 0;

      if (viewMode === 'XY') {
        u = rx;
        v = -ry;
      } else if (viewMode === 'XZ') {
        u = rx;
        v = -rz;
      } else if (viewMode === 'YZ') {
        u = ry;
        v = -rz;
      } else {
        const cyaw = Math.cos(tr.yaw);
        const syaw = Math.sin(tr.yaw);
        const cpit = Math.cos(tr.pitch);
        const spit = Math.sin(tr.pitch);
        const x1 = rx * cyaw - ry * syaw;
        const y1 = rx * syaw + ry * cyaw;
        const y2 = y1 * cpit - rz * spit;
        u = x1;
        v = -y2;
      }
      return [tr.panX + u * tr.scale, tr.panY + v * tr.scale];
    },
    [viewMode]
  );

  // Main Canvas Draw Loop
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const w = container.clientWidth;
    const h = container.clientHeight;
    if (w <= 0 || h <= 0) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#080C13';
    ctx.fillRect(0, 0, w, h);

    const tr = transformRef.current;

    // 1. Adaptive Grid
    let stepWorld = 10;
    let pxStep = stepWorld * tr.scale;
    while (pxStep < 32) {
      stepWorld *= 2;
      pxStep = stepWorld * tr.scale;
    }
    while (pxStep > 140 && stepWorld > 1) {
      stepWorld *= 0.5;
      pxStep = stepWorld * tr.scale;
    }

    const [ox, oy] = projectPoint(0, 0, 0);
    ctx.strokeStyle = '#131B29';
    ctx.lineWidth = 1;
    ctx.beginPath();
    const startX = ((ox % pxStep) + pxStep) % pxStep;
    for (let x = startX; x < w; x += pxStep) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
    }
    const startY = ((oy % pxStep) + pxStep) % pxStep;
    for (let y = startY; y < h; y += pxStep) {
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
    }
    ctx.stroke();

    // Origin Axis Triad
    const axLen = 24 / Math.max(0.01, tr.scale);
    const p0 = projectPoint(0, 0, 0);
    const px = projectPoint(axLen, 0, 0);
    const py = projectPoint(0, axLen, 0);
    const pz = projectPoint(0, 0, axLen);

    const drawAxis = (end: [number, number], color: string, label: string) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(p0[0], p0[1]);
      ctx.lineTo(end[0], end[1]);
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.font = '600 10px "JetBrains Mono", monospace';
      ctx.fillText(label, end[0] + 4, end[1] + 3);
    };
    drawAxis(px, '#EF4444', 'X');
    drawAxis(py, '#22C55E', 'Y');
    drawAxis(pz, '#3B82F6', 'Z');

    // 2. Render Toolpath Passes
    const pickCache: PickSegment[] = [];
    let segCounter = 0;
    const limit = playStep;
    let activeTip: [number, number] | null = null;
    let activeMeta: { x: number; y: number; z: number; passId: number; lineNum: number } | null = null;

    for (let pi = 0; pi < passes.length; pi++) {
      const p = passes[pi];
      if (!p.visible) continue;
      if (p.passType === 'RAPID' && !display.showRapids) {
        segCounter += p.segments.length;
        continue;
      }
      if (p.passType !== 'RAPID' && !display.showCutting) {
        segCounter += p.segments.length;
        continue;
      }

      const isPassSelected = selectedPassId === p.passId;
      let baseColor = '#06B6D4';
      if (p.passType === 'RAPID') {
        baseColor = isPassSelected ? '#FB923C' : '#D97706';
      } else if (isPassSelected) {
        baseColor = '#FFFFFF';
      } else if (display.colorByZ) {
        baseColor = zColorMap.get(p.zLevel) ?? '#06B6D4';
      }

      const lineW = isPassSelected ? 2.4 : p.passType === 'RAPID' ? 1.0 : 1.5;
      let passFirstPt: [number, number] | null = null;
      let passLastPt: [number, number] | null = null;

      ctx.strokeStyle = baseColor;
      ctx.lineWidth = lineW;
      ctx.setLineDash(p.passType === 'RAPID' ? [5, 4] : []);
      ctx.beginPath();

      const highlightedSegs: Array<[number, number, number, number]> = [];
      const arrowDirs: Array<[number, number, number, number]> = [];

      for (let si = 0; si < p.segments.length; si++) {
        if (limit !== null && segCounter >= limit) break;
        segCounter++;

        const s = p.segments[si];
        const [sx0, sy0] = projectPoint(s.x0, s.y0, s.z0);
        const [sx1, sy1] = projectPoint(s.x1, s.y1, s.z1);
        activeTip = [sx1, sy1];
        activeMeta = { x: s.x1, y: s.y1, z: s.z1, passId: p.passId, lineNum: s.lineNum };

        if (passFirstPt === null) passFirstPt = [sx0, sy0];
        passLastPt = [sx1, sy1];

        // Frustum cull off-screen segments
        if (
          Math.max(sx0, sx1) < -24 ||
          Math.min(sx0, sx1) > w + 24 ||
          Math.max(sy0, sy1) < -24 ||
          Math.min(sy0, sy1) > h + 24
        ) {
          continue;
        }

        pickCache.push({ x0: sx0, y0: sy0, x1: sx1, y1: sy1, passId: p.passId, lineNum: s.lineNum });

        if (selectedLineNum === s.lineNum) {
          highlightedSegs.push([sx0, sy0, sx1, sy1]);
        } else {
          ctx.moveTo(sx0, sy0);
          ctx.lineTo(sx1, sy1);
        }

        if (display.showArrows && p.passType !== 'RAPID' && si % 3 === 0) {
          const dx = sx1 - sx0;
          const dy = sy1 - sy0;
          const plen = Math.hypot(dx, dy);
          if (plen >= 22) {
            arrowDirs.push([sx0, sy0, sx1, sy1]);
          }
        }
      }
      ctx.stroke();

      // Highlighted single NC line segment
      if (highlightedSegs.length > 0) {
        ctx.save();
        ctx.setLineDash([]);
        ctx.strokeStyle = '#FACC15';
        ctx.lineWidth = 3.2;
        ctx.beginPath();
        for (const [hx0, hy0, hx1, hy1] of highlightedSegs) {
          ctx.moveTo(hx0, hy0);
          ctx.lineTo(hx1, hy1);
        }
        ctx.stroke();
        ctx.restore();
      }

      // Direction ticks
      if (arrowDirs.length > 0) {
        ctx.setLineDash([]);
        ctx.strokeStyle = baseColor;
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        for (const [ax0, ay0, ax1, ay1] of arrowDirs) {
          const dx = ax1 - ax0;
          const dy = ay1 - ay0;
          const plen = Math.hypot(dx, dy);
          const mx = (ax0 + ax1) * 0.5;
          const my = (ay0 + ay1) * 0.5;
          const ux = dx / plen;
          const uy = dy / plen;
          const sz = 4.5;
          ctx.moveTo(mx - ux * sz - uy * sz * 0.65, my - uy * sz + ux * sz * 0.65);
          ctx.lineTo(mx + ux * 1.5, my + uy * 1.5);
          ctx.lineTo(mx - ux * sz + uy * sz * 0.65, my - uy * sz - ux * sz * 0.65);
        }
        ctx.stroke();
      }

      // Start (Emerald circle) / End (Crimson square) markers
      if (display.showMarkers && p.passType !== 'RAPID' && passFirstPt && passLastPt) {
        ctx.setLineDash([]);
        ctx.fillStyle = '#10B981';
        ctx.beginPath();
        ctx.arc(passFirstPt[0], passFirstPt[1], 3, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#EF4444';
        ctx.fillRect(passLastPt[0] - 2.5, passLastPt[1] - 2.5, 5, 5);
      }

      if (limit !== null && segCounter >= limit) break;
    }

    ctx.setLineDash([]);

    // Active simulation tool tip reticle
    if (limit !== null && activeTip && activeMeta) {
      const [tx, ty] = activeTip;
      ctx.strokeStyle = '#FACC15';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(tx, ty, 6.5, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = '#FACC15';
      ctx.beginPath();
      ctx.arc(tx, ty, 2, 0, Math.PI * 2);
      ctx.fill();
    }

    pickCacheRef.current = pickCache;
  }, [passes, display, viewMode, selectedPassId, selectedLineNum, playStep, projectPoint, zColorMap, renderTrigger]);

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const isRightOrMiddle = e.button === 1 || e.button === 2;
    dragRef.current = {
      active: true,
      mode: !isRightOrMiddle && viewMode === '3D' ? 'orbit' : 'pan',
      lastX: mx,
      lastY: my,
      moved: false,
    };
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const tr = transformRef.current;

    if (viewMode !== '3D') {
      const u = (mx - tr.panX) / tr.scale + (viewMode === 'YZ' ? tr.cy : tr.cx);
      const v = -(my - tr.panY) / tr.scale + (viewMode === 'XY' ? tr.cy : tr.cz);
      setCursorCoords({ u, v });
    } else {
      setCursorCoords(null);
    }

    if (!dragRef.current.active) return;
    const dx = mx - dragRef.current.lastX;
    const dy = my - dragRef.current.lastY;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
      dragRef.current.moved = true;
    }

    if (dragRef.current.mode === 'orbit') {
      tr.yaw += dx * 0.008;
      tr.pitch = Math.max(-1.55, Math.min(1.55, tr.pitch + dy * 0.008));
    } else {
      tr.panX += dx;
      tr.panY += dy;
    }

    dragRef.current.lastX = mx;
    dragRef.current.lastY = my;
    setRenderTrigger((v) => v + 1);
  };

  const handleMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (dragRef.current.active && !dragRef.current.moved && e.button === 0) {
      const rect = e.currentTarget.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      let bestDist2 = 100;
      let bestPick: { passId: number; lineNum: number } | null = null;
      const cache = pickCacheRef.current;
      for (let i = 0; i < cache.length; i++) {
        const seg = cache[i];
        const vx = seg.x1 - seg.x0;
        const vy = seg.y1 - seg.y0;
        const len2 = vx * vx + vy * vy;
        const t = len2 < 1e-6 ? 0 : Math.max(0, Math.min(1, ((mx - seg.x0) * vx + (my - seg.y0) * vy) / len2));
        const px = seg.x0 + t * vx;
        const py = seg.y0 + t * vy;
        const d2 = (mx - px) ** 2 + (my - py) ** 2;
        if (d2 < bestDist2) {
          bestDist2 = d2;
          bestPick = { passId: seg.passId, lineNum: seg.lineNum };
        }
      }
      if (bestPick) {
        onSelectSegment(bestPick.passId, bestPick.lineNum);
      } else {
        onClearSelection();
      }
    }
    dragRef.current.active = false;
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.15 : 0.87;
    const tr = transformRef.current;
    const nextScale = Math.max(0.05, Math.min(140, tr.scale * factor));
    const ratio = nextScale / tr.scale;
    tr.panX = mx - (mx - tr.panX) * ratio;
    tr.panY = my - (my - tr.panY) * ratio;
    tr.scale = nextScale;
    setRenderTrigger((v) => v + 1);
  };

  const totalRender = Math.max(1, stats?.renderedSegments ?? 1);
  const currentStepVal = playStep === null ? totalRender : playStep;
  const hasSelection = selectedPassId !== null || selectedLineNum !== null;
  const axisLabels = viewMode === 'XY' ? ['X', 'Y'] : viewMode === 'XZ' ? ['X', 'Z'] : ['Y', 'Z'];

  return (
    <div className="flex flex-col flex-1 min-w-0 bg-[#080C13]">
      {/* Canvas Stage */}
      <div ref={containerRef} className="relative flex-1 min-h-0 overflow-hidden">
        <canvas
          ref={canvasRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={() => {
            dragRef.current.active = false;
            setCursorCoords(null);
          }}
          onContextMenu={(e) => e.preventDefault()}
          onWheel={handleWheel}
          className="block w-full h-full cursor-crosshair"
        />

        {/* Empty State Overlay when no NC file is loaded */}
        {passes.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none p-6">
            <div className="pointer-events-auto max-w-md bg-[#111827]/95 border border-slate-800 rounded-lg p-6 text-center space-y-3">
              <h2 className="text-base font-semibold text-white">No Toolpath Loaded</h2>
              <p className="text-xs text-slate-300 leading-relaxed">
                Import a CNC / CAM file exported from Siemens NX or Delcam (`.nc`, `.tap`, `.ptp`, `.cnc`, `.mpf`, `.txt`, `.cls`) or drag and drop it onto this window.
              </p>
              <button
                type="button"
                onClick={onImportFile}
                className="px-4 py-2 text-xs font-semibold bg-cyan-600 hover:bg-cyan-500 text-white rounded-md inline-flex items-center gap-2 transition-colors"
              >
                <FolderOpen className="w-3.5 h-3.5" />
                <span>Import NC File</span>
              </button>
            </div>
          </div>
        )}

        {/* Top-Left View Orientation Switcher */}
        <div className="absolute top-3 left-3 flex items-center gap-1 p-1 bg-[#111827]/95 border border-slate-800 rounded-md">
          {(
            [
              ['XY', '2D Top (XY)'],
              ['XZ', '2D Front (XZ)'],
              ['YZ', '2D Side (YZ)'],
              ['3D', '3D Wireframe'],
            ] as Array<[ViewMode, string]>
          ).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              onClick={() => onViewModeChange(mode)}
              className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                viewMode === mode
                  ? 'bg-cyan-600 text-white'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800'
              }`}
            >
              {label}
            </button>
          ))}
          <button
            type="button"
            onClick={fitView}
            title="Fit toolpath to viewport"
            className="ml-1 px-2 py-1 text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-800 rounded flex items-center gap-1 whitespace-nowrap shrink-0"
          >
            <Maximize2 className="w-3.5 h-3.5" />
            <span>Fit</span>
          </button>
        </div>

        {/* Top-Right Legend (Clean unboxed text) */}
        <div className="absolute top-3 right-3 px-3 py-1.5 bg-[#111827]/90 border border-slate-800 rounded-md text-xs font-mono text-slate-300 flex items-center gap-4 pointer-events-none">
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3.5 h-0.5 bg-cyan-400" />
            <span>Cut Pass</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3.5 h-0.5 border-t border-dashed border-amber-400" />
            <span>Rapid</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-500" />
            <span>Start</span>
          </span>
        </div>

        {/* Bottom-Left Live Crosshair Coordinates */}
        <div className="absolute bottom-3 left-3 px-3 py-1.5 bg-[#111827]/90 border border-slate-800 rounded-md text-xs font-mono text-slate-300 pointer-events-none">
          {viewMode === '3D' ? (
            <span>
              Drag: Orbit · Right-Drag: Pan · Wheel: Zoom · Click: Inspect{hasSelection ? ' · Esc: Deselect' : ''}
            </span>
          ) : cursorCoords ? (
            <span>
              {axisLabels[0]} {cursorCoords.u.toFixed(2)} {units} · {axisLabels[1]} {cursorCoords.v.toFixed(2)} {units}
              {hasSelection ? ' · Esc: Deselect' : ''}
            </span>
          ) : (
            <span>
              Drag: Pan · Wheel: Zoom · Click segment to inspect{hasSelection ? ' · Esc: Deselect' : ''}
            </span>
          )}
        </div>
      </div>

      {/* Simulation & Step-by-Step Playback Bar */}
      <div className="h-12 px-4 bg-[#111827] border-t border-slate-800 flex items-center gap-3 shrink-0">
        <button
          type="button"
          onClick={onTogglePlay}
          disabled={passes.length === 0}
          className="px-3 py-1.5 text-xs font-semibold rounded bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-white flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
        >
          {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
          <span>{isPlaying ? 'Pause' : 'Simulate'}</span>
        </button>

        <button
          type="button"
          onClick={onResetPlay}
          disabled={passes.length === 0}
          title="Reset simulation to start"
          className="p-1.5 text-slate-300 hover:text-white hover:bg-slate-800 disabled:opacity-40 rounded transition-colors shrink-0"
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </button>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => onStepPass(-1)}
            disabled={passes.length === 0}
            className="px-2 py-1 text-xs text-slate-300 hover:text-white hover:bg-slate-800 disabled:opacity-40 rounded flex items-center gap-1 whitespace-nowrap shrink-0"
          >
            <SkipBack className="w-3.5 h-3.5" />
            <span>Prev Pass</span>
          </button>
          <button
            type="button"
            onClick={() => onStepPass(1)}
            disabled={passes.length === 0}
            className="px-2 py-1 text-xs text-slate-300 hover:text-white hover:bg-slate-800 disabled:opacity-40 rounded flex items-center gap-1 whitespace-nowrap shrink-0"
          >
            <span>Next Pass</span>
            <SkipForward className="w-3.5 h-3.5" />
          </button>
        </div>

        <input
          type="range"
          min={0}
          max={totalRender}
          value={currentStepVal}
          disabled={passes.length === 0}
          onChange={(e) => onPlayStepChange(parseInt(e.target.value, 10))}
          aria-label="Simulation segment progress"
          className="flex-1 h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-500 disabled:opacity-40"
        />

        <span className="text-xs font-mono text-slate-400 whitespace-nowrap shrink-0 w-28 text-right">
          {passes.length === 0 ? '0 / 0' : `${currentStepVal.toLocaleString()} / ${totalRender.toLocaleString()}`}
        </span>

        <select
          value={playSpeed}
          onChange={(e) => onPlaySpeedChange(Number(e.target.value))}
          aria-label="Simulation speed"
          className="bg-[#0B0F17] border border-slate-700 text-xs font-mono text-slate-200 rounded px-2 py-1 shrink-0"
        >
          <option value={1}>1x</option>
          <option value={4}>4x</option>
          <option value={12}>12x</option>
          <option value={35}>35x</option>
        </select>
      </div>
    </div>
  );
};
