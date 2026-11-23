import React from 'react';
import { Eye, EyeOff } from 'lucide-react';
import type { ToolpathPass } from '../types/toolpath';

interface PassSummaryTableProps {
  passes: ToolpathPass[];
  units: 'mm' | 'inch';
  selectedPassId: number | null;
  onInspectPassInViewport: (pass: ToolpathPass) => void;
  onTogglePassVisibility: (passId: number) => void;
}

export const PassSummaryTable: React.FC<PassSummaryTableProps> = ({
  passes,
  units,
  selectedPassId,
  onInspectPassInViewport,
  onTogglePassVisibility,
}) => {
  return (
    <div className="flex-1 overflow-auto bg-[#080C13] p-6">
      <div className="max-w-6xl mx-auto bg-[#111827] border border-slate-800 rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">Generated Pass Schedule</h2>
          <span className="text-xs font-mono text-slate-400">
            {passes.length} total passes · Click any row to highlight in viewport
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-[#0D131F] border-b border-slate-800 text-slate-400 font-medium">
                <th className="py-2.5 px-3">Visible</th>
                <th className="py-2.5 px-3">Pass #</th>
                <th className="py-2.5 px-3">Type</th>
                <th className="py-2.5 px-3">Operation</th>
                <th className="py-2.5 px-3">Tool</th>
                <th className="py-2.5 px-3 text-right">Z-Level ({units})</th>
                <th className="py-2.5 px-3 text-right">Segments</th>
                <th className="py-2.5 px-3 text-right">Distance ({units})</th>
                <th className="py-2.5 px-3 text-right">Est. Time (s)</th>
                <th className="py-2.5 px-3 text-right">NC Lines</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70 font-mono">
              {passes.map((p) => {
                const isSelected = selectedPassId === p.passId;
                return (
                  <tr
                    key={p.passId}
                    onClick={() => onInspectPassInViewport(p)}
                    className={`cursor-pointer transition-colors ${
                      isSelected
                        ? 'bg-cyan-950/50 text-white'
                        : 'hover:bg-slate-800/40 text-slate-300'
                    } ${!p.visible ? 'opacity-45' : ''}`}
                  >
                    <td className="py-2 px-3">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onTogglePassVisibility(p.passId);
                        }}
                        className="p-1 text-slate-400 hover:text-white"
                      >
                        {p.visible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5 text-slate-600" />}
                      </button>
                    </td>
                    <td className="py-2 px-3 font-semibold text-slate-100">#{p.passId}</td>
                    <td className={`py-2 px-3 ${p.passType === 'RAPID' ? 'text-amber-400' : 'text-cyan-400'}`}>
                      {p.passType}
                    </td>
                    <td className="py-2 px-3 font-sans text-slate-200 max-w-xs truncate">{p.operation}</td>
                    <td className="py-2 px-3">{p.tool}</td>
                    <td className="py-2 px-3 text-right">{p.zLevel.toFixed(3)}</td>
                    <td className="py-2 px-3 text-right">{p.segments.length}</td>
                    <td className="py-2 px-3 text-right">{p.distance.toFixed(2)}</td>
                    <td className="py-2 px-3 text-right">{p.durationSec.toFixed(2)}</td>
                    <td className="py-2 px-3 text-right text-slate-400">
                      {p.startLine}–{p.endLine}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
