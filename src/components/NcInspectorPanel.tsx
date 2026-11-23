import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import type { ToolpathPass } from '../types/toolpath';

interface NcInspectorPanelProps {
  rawLines: string[];
  selectedPass: ToolpathPass | null;
  selectedLineNum: number | null;
  onSelectLine: (lineNum: number) => void;
  onClearSelection: () => void;
}

export const NcInspectorPanel: React.FC<NcInspectorPanelProps> = ({
  rawLines,
  selectedPass,
  selectedLineNum,
  onSelectLine,
  onClearSelection,
}) => {
  const [search, setSearch] = useState('');
  const [windowStart, setWindowStart] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const WINDOW_SIZE = 500;

  // Keep selected line in view by shifting window when needed
  useEffect(() => {
    if (!selectedLineNum) return;
    const idx = selectedLineNum - 1;
    if (idx < windowStart || idx >= windowStart + WINDOW_SIZE) {
      setWindowStart(Math.max(0, idx - 80));
    }
    requestAnimationFrame(() => {
      const el = listRef.current?.querySelector(`[data-line="${selectedLineNum}"]`);
      if (el) el.scrollIntoView({ block: 'nearest' });
    });
  }, [selectedLineNum, windowStart]);

  const filteredLines = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (q) {
      const matches: Array<{ lineNum: number; text: string }> = [];
      for (let i = 0; i < rawLines.length; i++) {
        if (rawLines[i].toLowerCase().includes(q)) {
          matches.push({ lineNum: i + 1, text: rawLines[i] });
          if (matches.length >= 600) break;
        }
      }
      return matches;
    }
    const end = Math.min(rawLines.length, windowStart + WINDOW_SIZE);
    const slice: Array<{ lineNum: number; text: string }> = [];
    for (let i = windowStart; i < end; i++) {
      slice.push({ lineNum: i + 1, text: rawLines[i] });
    }
    return slice;
  }, [rawLines, search, windowStart]);

  const hasSelection = selectedPass !== null || selectedLineNum !== null;

  return (
    <aside className="w-80 xl:w-96 bg-[#111827] border-l border-slate-800 flex flex-col min-h-0 shrink-0">
      {/* Selected Pass Header */}
      <div className="p-3.5 border-b border-slate-800">
        <div className="flex items-center justify-between gap-2 mb-2">
          <h2 className="text-xs font-semibold text-slate-200 tracking-wide">
            Raw NC / CL Line Inspector
          </h2>
          {hasSelection && (
            <button
              type="button"
              onClick={onClearSelection}
              title="Clear line and pass selection (Esc)"
              className="px-2 py-0.5 text-[11px] font-mono bg-[#0B0F17] border border-slate-700 hover:border-cyan-500 text-slate-300 hover:text-white rounded transition-colors whitespace-nowrap shrink-0"
            >
              Deselect (Esc)
            </button>
          )}
        </div>

        {selectedPass ? (
          <div className="p-2.5 bg-[#0B0F17] border border-slate-800 rounded text-xs space-y-1">
            <div className="flex items-center justify-between font-mono">
              <span className="text-white font-semibold">Pass #{selectedPass.passId}</span>
              <span className={selectedPass.passType === 'RAPID' ? 'text-amber-400' : 'text-cyan-400'}>
                {selectedPass.passType} · Z{selectedPass.zLevel.toFixed(3)}
              </span>
            </div>
            <div className="text-[11px] text-slate-400 truncate">
              {selectedPass.operation} · {selectedPass.tool}
            </div>
            <div className="text-[11px] font-mono text-slate-400">
              Lines {selectedPass.startLine}–{selectedPass.endLine} · {selectedPass.segments.length} segs · {selectedPass.distance.toFixed(1)} mm
            </div>
          </div>
        ) : (
          <div className="text-xs text-slate-400">
            {rawLines.length === 0
              ? 'Import an NC / CL file to inspect raw program lines.'
              : 'Click any line below or pass in viewport to highlight. Press Esc to deselect.'}
          </div>
        )}
      </div>

      {/* Search + Window Pager */}
      <div className="p-2.5 border-b border-slate-800 space-y-2">
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search G00, Z-8.0, T02, GOTO..."
            className="w-full bg-[#0B0F17] border border-slate-800 rounded pl-8 pr-2.5 py-1 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-cyan-500"
          />
        </div>

        {!search && rawLines.length > WINDOW_SIZE && (
          <div className="flex items-center justify-between text-[11px] font-mono text-slate-400">
            <button
              type="button"
              disabled={windowStart === 0}
              onClick={() => setWindowStart((s) => Math.max(0, s - WINDOW_SIZE))}
              className="px-2 py-0.5 rounded bg-[#0B0F17] border border-slate-800 hover:text-white disabled:opacity-40"
            >
              Prev 500
            </button>
            <span>
              Lines {windowStart + 1}–{Math.min(rawLines.length, windowStart + WINDOW_SIZE)} / {rawLines.length.toLocaleString()}
            </span>
            <button
              type="button"
              disabled={windowStart + WINDOW_SIZE >= rawLines.length}
              onClick={() => setWindowStart((s) => Math.min(rawLines.length - 1, s + WINDOW_SIZE))}
              className="px-2 py-0.5 rounded bg-[#0B0F17] border border-slate-800 hover:text-white disabled:opacity-40"
            >
              Next 500
            </button>
          </div>
        )}
      </div>

      {/* Line Rows */}
      <div ref={listRef} className="flex-1 overflow-y-auto bg-[#080C13] font-mono text-xs">
        {rawLines.length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-500 font-sans">
            No NC lines loaded.
          </div>
        ) : (
          filteredLines.map((item) => {
            const isSelectedLine = selectedLineNum === item.lineNum;
            const inSelectedPass =
              selectedPass !== null &&
              item.lineNum >= selectedPass.startLine &&
              item.lineNum <= selectedPass.endLine;

            return (
              <button
                key={item.lineNum}
                type="button"
                data-line={item.lineNum}
                onClick={() => {
                  if (isSelectedLine) {
                    onClearSelection();
                  } else {
                    onSelectLine(item.lineNum);
                  }
                }}
                className={`w-full text-left px-3 py-1 flex items-start gap-2.5 border-b border-slate-900/70 transition-colors ${
                  isSelectedLine
                    ? 'bg-amber-500/20 text-amber-200'
                    : inSelectedPass
                    ? 'bg-cyan-950/40 text-cyan-100'
                    : 'text-slate-300 hover:bg-slate-900/70'
                }`}
              >
                <span className="text-slate-500 select-none w-10 text-right shrink-0">
                  {item.lineNum}
                </span>
                <span className="break-all">{item.text || ' '}</span>
              </button>
            );
          })
        )}
      </div>
    </aside>
  );
};
