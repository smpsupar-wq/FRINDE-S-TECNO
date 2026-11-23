import React, { useMemo, useState } from 'react';
import { Eye, EyeOff, Search } from 'lucide-react';
import type { CamSourceFormat, DisplayOptions, ProgramStats, ToolpathPass } from '../types/toolpath';

interface LeftPassPanelProps {
  sourceFormat: CamSourceFormat;
  units: 'mm' | 'inch';
  stats: ProgramStats | null;
  passes: ToolpathPass[];
  zLevels: number[];
  display: DisplayOptions;
  onDisplayChange: (next: DisplayOptions) => void;
  selectedPassId: number | null;
  onSelectPass: (pass: ToolpathPass) => void;
  onTogglePassVisibility: (passId: number) => void;
  onToggleZLevelVisibility: (zLevel: number) => void;
  onShowAllPasses: () => void;
}

export const LeftPassPanel: React.FC<LeftPassPanelProps> = ({
  sourceFormat,
  units,
  stats,
  passes,
  zLevels,
  display,
  onDisplayChange,
  selectedPassId,
  onSelectPass,
  onTogglePassVisibility,
  onToggleZLevelVisibility,
  onShowAllPasses,
}) => {
  const [filterText, setFilterText] = useState('');
  const [typeFilter, setTypeFilter] = useState<'ALL' | 'CUT' | 'RAPID'>('ALL');
  const [activeZFilter, setActiveZFilter] = useState<number | null>(null);

  const filteredPasses = useMemo(() => {
    const q = filterText.trim().toLowerCase();
    return passes.filter((p) => {
      if (typeFilter !== 'ALL' && p.passType !== typeFilter) return false;
      if (activeZFilter !== null && p.zLevel !== activeZFilter) return false;
      if (q) {
        return (
          `pass ${p.passId}`.includes(q) ||
          p.operation.toLowerCase().includes(q) ||
          p.tool.toLowerCase().includes(q) ||
          String(p.zLevel).includes(q)
        );
      }
      return true;
    });
  }, [passes, typeFilter, activeZFilter, filterText]);

  const formatDuration = (sec: number) => {
    const mins = Math.floor(sec / 60);
    const rem = Math.round(sec % 60);
    return `${mins}m ${String(rem).padStart(2, '0')}s`;
  };

  return (
    <aside className="w-72 xl:w-80 bg-[#111827] border-r border-slate-800 flex flex-col min-h-0 shrink-0">
      {/* Program Telemetry Summary */}
      <div className="p-3.5 border-b border-slate-800">
        <div className="flex items-center justify-between mb-2.5">
          <h2 className="text-xs font-semibold text-slate-200 tracking-wide">Program Metrics</h2>
          <span className="text-xs font-mono text-cyan-400">{sourceFormat}</span>
        </div>

        {stats ? (
          <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
            <div>
              <div className="text-slate-400">Passes</div>
              <div className="font-mono text-slate-100 font-medium">
                {stats.totalPasses}{' '}
                <span className="text-slate-400">({stats.cuttingPasses}C / {stats.rapidPasses}R)</span>
              </div>
            </div>
            <div>
              <div className="text-slate-400">Est. Cycle Time</div>
              <div className="font-mono text-slate-100 font-medium">{formatDuration(stats.estCycleTimeSec)}</div>
            </div>
            <div>
              <div className="text-slate-400">Cutting Dist</div>
              <div className="font-mono text-cyan-300 font-medium">
                {stats.cuttingDistance.toFixed(1)} <span className="text-slate-400">{units}</span>
              </div>
            </div>
            <div>
              <div className="text-slate-400">Rapid Dist</div>
              <div className="font-mono text-amber-300 font-medium">
                {stats.rapidDistance.toFixed(1)} <span className="text-slate-400">{units}</span>
              </div>
            </div>
            <div>
              <div className="text-slate-400">Z-Levels · Lines</div>
              <div className="font-mono text-slate-100">
                {stats.zLevelsCount} · {stats.lineCount.toLocaleString()}
              </div>
            </div>
            <div>
              <div className="text-slate-400">LOD Segments</div>
              <div className="font-mono text-slate-100">
                {stats.renderedSegments.toLocaleString()}{' '}
                <span className="text-slate-400">({Math.round(stats.decimationRatio * 100)}%)</span>
              </div>
            </div>
            <div className="col-span-2 pt-1 border-t border-slate-800/80 text-[11px] font-mono text-slate-400 space-y-0.5">
              <div>X [{stats.xMin.toFixed(2)}, {stats.xMax.toFixed(2)}]</div>
              <div>Y [{stats.yMin.toFixed(2)}, {stats.yMax.toFixed(2)}] · Z [{stats.zMin.toFixed(2)}, {stats.zMax.toFixed(2)}]</div>
            </div>
          </div>
        ) : (
          <div className="text-xs text-slate-500">No toolpath loaded.</div>
        )}
      </div>

      {/* Layer Visibility Switches */}
      <div className="px-3.5 py-2.5 border-b border-slate-800 grid grid-cols-2 gap-y-1.5 gap-x-2 text-xs text-slate-300">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={display.showCutting}
            onChange={(e) => onDisplayChange({ ...display, showCutting: e.target.checked })}
            className="accent-cyan-500 rounded"
          />
          <span>Cutting Passes</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={display.showRapids}
            onChange={(e) => onDisplayChange({ ...display, showRapids: e.target.checked })}
            className="accent-amber-500 rounded"
          />
          <span>Rapid Moves</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={display.showArrows}
            onChange={(e) => onDisplayChange({ ...display, showArrows: e.target.checked })}
            className="accent-cyan-500 rounded"
          />
          <span>Direction Ticks</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={display.showMarkers}
            onChange={(e) => onDisplayChange({ ...display, showMarkers: e.target.checked })}
            className="accent-cyan-500 rounded"
          />
          <span>Start / End</span>
        </label>
        <label className="col-span-2 flex items-center gap-2 cursor-pointer pt-0.5">
          <input
            type="checkbox"
            checked={display.colorByZ}
            onChange={(e) => onDisplayChange({ ...display, colorByZ: e.target.checked })}
            className="accent-cyan-500 rounded"
          />
          <span>Color Cutting Passes by Z-Level</span>
        </label>
      </div>

      {/* Z-Level Quick Filter Strip */}
      {zLevels.length > 0 && (
        <div className="px-3.5 py-2 border-b border-slate-800">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-medium text-slate-400">Z-Levels</span>
            <button
              type="button"
              onClick={() => {
                setActiveZFilter(null);
                onShowAllPasses();
              }}
              className="text-[11px] text-cyan-400 hover:text-cyan-300"
            >
              Show All
            </button>
          </div>
          <div className="flex flex-wrap gap-1 max-h-20 overflow-y-auto">
            {zLevels.map((z) => {
              const allVisible = passes.filter((p) => p.zLevel === z).every((p) => p.visible);
              const isSelected = activeZFilter === z;
              return (
                <div
                  key={z}
                  className={`inline-flex items-center rounded border text-[11px] font-mono ${
                    isSelected
                      ? 'bg-cyan-950/70 border-cyan-500 text-cyan-200'
                      : 'bg-[#0B0F17] border-slate-800 text-slate-300'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setActiveZFilter(isSelected ? null : z)}
                    className="px-1.5 py-0.5 hover:text-white"
                  >
                    Z{z.toFixed(1)}
                  </button>
                  <button
                    type="button"
                    onClick={() => onToggleZLevelVisibility(z)}
                    title={`Toggle visibility for Z=${z.toFixed(2)}`}
                    className="px-1 py-0.5 border-l border-slate-800 text-slate-400 hover:text-white"
                  >
                    {allVisible ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3 text-slate-600" />}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Pass Tree Filter & List */}
      <div className="p-2.5 border-b border-slate-800 flex flex-col gap-2">
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            placeholder="Filter pass, tool, operation..."
            className="w-full bg-[#0B0F17] border border-slate-800 rounded pl-8 pr-2.5 py-1 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-cyan-500"
          />
        </div>
        <div className="flex items-center gap-1 p-0.5 bg-[#0B0F17] border border-slate-800 rounded">
          {(['ALL', 'CUT', 'RAPID'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTypeFilter(t)}
              className={`flex-1 py-1 text-[11px] font-medium rounded transition-colors ${
                typeFilter === t ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {t === 'ALL' ? 'All Moves' : t === 'CUT' ? 'Cutting' : 'Rapids'}
            </button>
          ))}
        </div>
      </div>

      {/* Scrollable Pass List */}
      <div className="flex-1 overflow-y-auto divide-y divide-slate-800/70">
        {filteredPasses.length === 0 ? (
          <div className="p-4 text-xs text-slate-500 text-center">No passes match current filter.</div>
        ) : (
          filteredPasses.map((p) => {
            const isSel = selectedPassId === p.passId;
            return (
              <div
                key={p.passId}
                className={`flex items-center justify-between px-3 py-2 text-xs transition-colors cursor-pointer ${
                  isSel ? 'bg-cyan-950/60 text-white' : 'hover:bg-slate-800/40 text-slate-300'
                } ${!p.visible ? 'opacity-45' : ''}`}
                onClick={() => onSelectPass(p)}
              >
                <div className="min-w-0 pr-2">
                  <div className="flex items-center gap-2 font-mono">
                    <span className="font-semibold text-slate-100">Pass {p.passId}</span>
                    <span className={p.passType === 'RAPID' ? 'text-amber-400' : 'text-cyan-400'}>
                      {p.passType}
                    </span>
                    <span className="text-slate-400">Z{p.zLevel.toFixed(2)}</span>
                  </div>
                  <div className="text-[11px] text-slate-400 truncate mt-0.5">
                    {p.tool} · {p.distance.toFixed(1)} {units} · {p.operation}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onTogglePassVisibility(p.passId);
                  }}
                  title={p.visible ? 'Hide pass' : 'Show pass'}
                  className="p-1 text-slate-400 hover:text-white shrink-0"
                >
                  {p.visible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5 text-slate-600" />}
                </button>
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
};
