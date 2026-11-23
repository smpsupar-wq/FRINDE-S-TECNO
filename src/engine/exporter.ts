import type { CamSourceFormat, ProgramStats, ToolpathPass } from '../types/toolpath';

// Import Python desktop files directly from /desktop_app/ so the downloadable Windows ZIP
// is always 100% synced with the tested Python source files.
import pyParser from '../../desktop_app/parser.py?raw';
import pyPassGen from '../../desktop_app/pass_generator.py?raw';
import pyViewer from '../../desktop_app/viewer.py?raw';
import pyExporter from '../../desktop_app/exporter.py?raw';
import pyMain from '../../desktop_app/main.py?raw';
import pyReqs from '../../desktop_app/requirements.txt?raw';
import pyReadme from '../../desktop_app/README.md?raw';

export interface DesktopSourceFile {
  name: string;
  description: string;
  content: string;
}

export const DESKTOP_SOURCE_FILES: DesktopSourceFile[] = [
  { name: 'main.py', description: 'Tkinter desktop GUI, streaming thread loader, pass tree, and playback controls', content: pyMain },
  { name: 'parser.py', description: 'Streaming NX, Delcam, and CL-Data parser with G02/G03 arc linearization', content: pyParser },
  { name: 'pass_generator.py', description: 'Pass segmentation, Z-level grouping, statistics, and LOD point decimation', content: pyPassGen },
  { name: 'viewer.py', description: 'Pure Tkinter Canvas 2D/3D wireframe renderer with zoom, pan, and click-pick', content: pyViewer },
  { name: 'exporter.py', description: 'Re-indexed .nc, summary .txt, and coordinate .csv exporter', content: pyExporter },
  { name: 'requirements.txt', description: 'Zero external runtime dependencies (Python 3.8+ standard library)', content: pyReqs },
  { name: 'README.md', description: 'Step-by-step Windows setup and PyInstaller .exe build guide', content: pyReadme },
];

function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportReindexedNC(passes: ToolpathPass[], baseName = 'paas_wiver_export'): void {
  const out: string[] = [
    '%',
    `(${baseName.toUpperCase()} — Re-indexed Pass Export)`,
    'G90 G17 G21',
  ];
  let seq = 10;
  let lastOp = '';
  let lastTool = '';

  for (const p of passes) {
    if (!p.visible) continue;
    if (p.operation !== lastOp) {
      out.push(`(Operation: ${p.operation})`);
      lastOp = p.operation;
    }
    if (p.tool !== lastTool) {
      out.push(`N${String(seq).padStart(4, '0')} ${p.tool} M06`);
      seq += 10;
      lastTool = p.tool;
    }
    out.push(`(Pass #${p.passId} | ${p.passType} | Z=${p.zLevel.toFixed(3)})`);
    p.segments.forEach((s, idx) => {
      if (idx === 0) {
        const g0 = p.passType === 'RAPID' ? 'G00' : 'G01';
        out.push(`N${String(seq).padStart(4, '0')} ${g0} X${s.x0.toFixed(3)} Y${s.y0.toFixed(3)} Z${s.z0.toFixed(3)}`);
        seq += 10;
      }
      const g = s.moveType === 'RAPID' ? 'G00' : 'G01';
      const feedPart = s.moveType !== 'RAPID' ? ` F${s.feed.toFixed(1)}` : '';
      out.push(`N${String(seq).padStart(4, '0')} ${g} X${s.x1.toFixed(3)} Y${s.y1.toFixed(3)} Z${s.z1.toFixed(3)}${feedPart}`);
      seq += 10;
    });
  }

  out.push(`N${String(seq).padStart(4, '0')} M30`, '%');
  triggerBlobDownload(new Blob([out.join('\n')], { type: 'text/plain;charset=utf-8' }), `${baseName}_reindexed.nc`);
}

export function exportPassSummaryTXT(
  passes: ToolpathPass[],
  stats: ProgramStats,
  sourceFormat: CamSourceFormat,
  baseName = 'paas_wiver_export'
): void {
  const out: string[] = [
    'PAAS WIVER — Toolpath Pass Summary',
    '='.repeat(54),
    `Detected Format : ${sourceFormat}`,
    `Total Lines     : ${stats.lineCount}`,
    `Total Passes    : ${stats.totalPasses} (Cut: ${stats.cuttingPasses}, Rapid: ${stats.rapidPasses})`,
    `Z-Levels        : ${stats.zLevelsCount}`,
    `Cutting Dist    : ${stats.cuttingDistance.toFixed(2)} mm`,
    `Rapid Dist      : ${stats.rapidDistance.toFixed(2)} mm`,
    `Est. Cycle Time : ${(stats.estCycleTimeSec / 60).toFixed(2)} min (${stats.estCycleTimeSec.toFixed(1)} s)`,
    `X Bounds        : [${stats.xMin.toFixed(3)}, ${stats.xMax.toFixed(3)}]`,
    `Y Bounds        : [${stats.yMin.toFixed(3)}, ${stats.yMax.toFixed(3)}]`,
    `Z Bounds        : [${stats.zMin.toFixed(3)}, ${stats.zMax.toFixed(3)}]`,
    '',
    'Pass  Type    Z-Level        Lines    Dist(mm)   Time(s)  Operation',
    '-'.repeat(78),
  ];

  for (const p of passes) {
    const pid = String(p.passId).padStart(4, ' ');
    const ptype = p.passType.padEnd(6, ' ');
    const z = p.zLevel.toFixed(3).padStart(9, ' ');
    const lr = `${p.startLine}-${p.endLine}`.padStart(12, ' ');
    const dist = p.distance.toFixed(2).padStart(10, ' ');
    const tm = p.durationSec.toFixed(2).padStart(8, ' ');
    out.push(`${pid}  ${ptype}  ${z}  ${lr}  ${dist}  ${tm}  ${p.operation}`);
  }

  triggerBlobDownload(new Blob([out.join('\n')], { type: 'text/plain;charset=utf-8' }), `${baseName}_summary.txt`);
}

export function exportPassesCSV(passes: ToolpathPass[], baseName = 'nxpass_export'): void {
  const rows: string[] = [
    'pass_id,pass_type,operation,tool,z_level,line_num,move_type,x0,y0,z0,x1,y1,z1,feed,spindle',
  ];
  for (const p of passes) {
    if (!p.visible) continue;
    const safeOp = `"${p.operation.replace(/"/g, '""')}"`;
    for (const s of p.segments) {
      rows.push([
        p.passId,
        p.passType,
        safeOp,
        p.tool,
        p.zLevel.toFixed(3),
        s.lineNum,
        s.moveType,
        s.x0.toFixed(4),
        s.y0.toFixed(4),
        s.z0.toFixed(4),
        s.x1.toFixed(4),
        s.y1.toFixed(4),
        s.z1.toFixed(4),
        s.feed.toFixed(1),
        s.spindle.toFixed(0),
      ].join(','));
    }
  }
  triggerBlobDownload(new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8' }), `${baseName}_passes.csv`);
}

// ── Minimal CRC32 + Uncompressed ZIP Packager (Zero Dependencies) ────────────
const CRC_TABLE = (() => {
  const tbl = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    tbl[i] = c >>> 0;
  }
  return tbl;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function downloadPythonDesktopZip(): void {
  const encoder = new TextEncoder();
  const localChunks: Uint8Array[] = [];
  const centralChunks: Uint8Array[] = [];
  let offset = 0;

  for (const file of DESKTOP_SOURCE_FILES) {
    const nameBytes = encoder.encode(`paas_wiver/${file.name}`);
    const dataBytes = encoder.encode(file.content);
    const crc = crc32(dataBytes);

    // Local File Header (30 bytes + name)
    const lh = new ArrayBuffer(30 + nameBytes.length);
    const lv = new DataView(lh);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true); // UTF-8
    lv.setUint16(8, 0, true);      // STORE (uncompressed)
    lv.setUint16(10, 0, true);
    lv.setUint16(12, 0, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, dataBytes.length, true);
    lv.setUint32(22, dataBytes.length, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    new Uint8Array(lh, 30).set(nameBytes);

    // Central Directory Header (46 bytes + name)
    const ch = new ArrayBuffer(46 + nameBytes.length);
    const cv = new DataView(ch);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, dataBytes.length, true);
    cv.setUint32(24, dataBytes.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);
    new Uint8Array(ch, 46).set(nameBytes);

    localChunks.push(new Uint8Array(lh), dataBytes);
    centralChunks.push(new Uint8Array(ch));
    offset += 30 + nameBytes.length + dataBytes.length;
  }

  let centralSize = 0;
  for (const c of centralChunks) centralSize += c.length;

  const eocd = new ArrayBuffer(22);
  const ev = new DataView(eocd);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, DESKTOP_SOURCE_FILES.length, true);
  ev.setUint16(10, DESKTOP_SOURCE_FILES.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true);

  let totalSize = 22;
  for (const c of localChunks) totalSize += c.byteLength;
  for (const c of centralChunks) totalSize += c.byteLength;

  const outBuffer = new ArrayBuffer(totalSize);
  const outBytes = new Uint8Array(outBuffer);
  let writePos = 0;
  for (const c of localChunks) {
    outBytes.set(c, writePos);
    writePos += c.byteLength;
  }
  for (const c of centralChunks) {
    outBytes.set(c, writePos);
    writePos += c.byteLength;
  }
  outBytes.set(new Uint8Array(eocd), writePos);

  const zipBlob = new Blob([outBuffer], {
    type: 'application/zip',
  });
  triggerBlobDownload(zipBlob, 'paas_wiver_desktop_windows.zip');
}
