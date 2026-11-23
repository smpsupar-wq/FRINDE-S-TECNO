import type { LodMode, MoveSegment, ParseResult, ProgramStats, ToolpathPass } from '../types/toolpath';

function segLength(s: MoveSegment): number {
  const dx = s.x1 - s.x0;
  const dy = s.y1 - s.y0;
  const dz = s.z1 - s.z0;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Single-pass collinear / perpendicular-distance thinning (O(n))
 * to keep panning & zooming at 60 FPS on integrated graphics for large toolpaths.
 */
export function decimateSegments(segments: MoveSegment[], tolerance = 0.04): MoveSegment[] {
  const n = segments.length;
  if (n <= 3 || tolerance <= 0) return segments;

  const kept: MoveSegment[] = [];
  let accStart = segments[0];

  for (let i = 1; i < n; i++) {
    const curr = segments[i];
    if (curr.moveType !== accStart.moveType) {
      kept.push(accStart);
      accStart = curr;
      continue;
    }

    const vx = curr.x1 - accStart.x0;
    const vy = curr.y1 - accStart.y0;
    const vz = curr.z1 - accStart.z0;
    const vLen = Math.sqrt(vx * vx + vy * vy + vz * vz);
    if (vLen < 1e-9) continue;

    const px = accStart.x1 - accStart.x0;
    const py = accStart.y1 - accStart.y0;
    const pz = accStart.z1 - accStart.z0;

    const cx = py * vz - pz * vy;
    const cy = pz * vx - px * vz;
    const cz = px * vy - py * vx;
    const perpDist = Math.sqrt(cx * cx + cy * cy + cz * cz) / vLen;

    if (perpDist <= tolerance) {
      accStart = {
        ...curr,
        x0: accStart.x0,
        y0: accStart.y0,
        z0: accStart.z0,
        moveType: accStart.moveType,
      };
    } else {
      kept.push(accStart);
      accStart = curr;
    }
  }

  kept.push(accStart);
  return kept;
}

export function generatePasses(
  parsed: ParseResult,
  lodMode: LodMode = 'auto',
  rapidRateMmMin = 10000,
  zSnapTolerance = 0.02,
  autoLodThreshold = 18000
): {
  passes: ToolpathPass[];
  stats: ProgramStats;
  zLevels: number[];
} {
  const segs = parsed.segments;
  if (segs.length === 0) {
    return {
      passes: [],
      zLevels: [],
      stats: {
        totalPasses: 0,
        cuttingPasses: 0,
        rapidPasses: 0,
        zLevelsCount: 0,
        operationsCount: 0,
        totalSegments: 0,
        renderedSegments: 0,
        decimationRatio: 1,
        cuttingDistance: 0,
        rapidDistance: 0,
        totalDistance: 0,
        estCycleTimeSec: 0,
        xMin: 0,
        xMax: 0,
        yMin: 0,
        yMax: 0,
        zMin: 0,
        zMax: 0,
        lineCount: parsed.totalLines,
      },
    };
  }

  let xMin = Infinity, xMax = -Infinity;
  let yMin = Infinity, yMax = -Infinity;
  let zMin = Infinity, zMax = -Infinity;
  let cutDist = 0;
  let rapidDist = 0;
  let cutTimeSec = 0;
  let rapidTimeSec = 0;

  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    if (s.x0 < xMin) xMin = s.x0;
    if (s.x1 < xMin) xMin = s.x1;
    if (s.x0 > xMax) xMax = s.x0;
    if (s.x1 > xMax) xMax = s.x1;

    if (s.y0 < yMin) yMin = s.y0;
    if (s.y1 < yMin) yMin = s.y1;
    if (s.y0 > yMax) yMax = s.y0;
    if (s.y1 > yMax) yMax = s.y1;

    if (s.z0 < zMin) zMin = s.z0;
    if (s.z1 < zMin) zMin = s.z1;
    if (s.z0 > zMax) zMax = s.z0;
    if (s.z1 > zMax) zMax = s.z1;

    const d = segLength(s);
    if (s.moveType === 'RAPID') {
      rapidDist += d;
      rapidTimeSec += (d / Math.max(1, rapidRateMmMin)) * 60;
    } else {
      cutDist += d;
      cutTimeSec += (d / Math.max(1, s.feed)) * 60;
    }
  }

  const passes: ToolpathPass[] = [];
  let curSegs: MoveSegment[] = [];
  let curType: 'CUT' | 'RAPID' = segs[0].moveType === 'RAPID' ? 'RAPID' : 'CUT';
  let curOp = segs[0].operation;
  let curTool = segs[0].tool;

  const flushPass = (segList: MoveSegment[], passType: 'CUT' | 'RAPID', op: string, tool: string) => {
    if (segList.length === 0) return;
    let minZ = Infinity;
    let dist = 0;
    let dur = 0;
    for (let i = 0; i < segList.length; i++) {
      const s = segList[i];
      if (s.z1 < minZ) minZ = s.z1;
      const d = segLength(s);
      dist += d;
      dur += passType === 'RAPID'
        ? (d / Math.max(1, rapidRateMmMin)) * 60
        : (d / Math.max(1, s.feed)) * 60;
    }
    const snappedZ = zSnapTolerance > 0
      ? Math.round((Math.round(minZ / zSnapTolerance) * zSnapTolerance) * 1000) / 1000
      : Math.round(minZ * 1000) / 1000;

    passes.push({
      passId: passes.length + 1,
      passType,
      zLevel: snappedZ,
      operation: op,
      tool,
      startLine: segList[0].lineNum,
      endLine: segList[segList.length - 1].lineNum,
      segments: segList,
      distance: dist,
      durationSec: dur,
      visible: true,
    });
  };

  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    const sType: 'CUT' | 'RAPID' = s.moveType === 'RAPID' ? 'RAPID' : 'CUT';
    if (sType !== curType || s.operation !== curOp || s.tool !== curTool) {
      flushPass(curSegs, curType, curOp, curTool);
      curSegs = [s];
      curType = sType;
      curOp = s.operation;
      curTool = s.tool;
    } else {
      curSegs.push(s);
    }
  }
  flushPass(curSegs, curType, curOp, curTool);

  let tol = 0;
  if (lodMode === 'fast') tol = 0.08;
  else if (lodMode === 'auto' && segs.length > autoLodThreshold) tol = 0.04;

  let renderedSegments = 0;
  if (tol > 0) {
    for (const p of passes) {
      if (p.passType === 'CUT' && p.segments.length > 12) {
        p.segments = decimateSegments(p.segments, tol);
      }
      renderedSegments += p.segments.length;
    }
  } else {
    renderedSegments = segs.length;
  }

  const zSet = new Set<number>();
  const opSet = new Set<string>();
  let cutPasses = 0;
  let rapidPasses = 0;

  for (const p of passes) {
    zSet.add(p.zLevel);
    opSet.add(p.operation);
    if (p.passType === 'CUT') cutPasses++;
    else rapidPasses++;
  }

  const zLevels = Array.from(zSet).sort((a, b) => b - a);

  return {
    passes,
    zLevels,
    stats: {
      totalPasses: passes.length,
      cuttingPasses: cutPasses,
      rapidPasses,
      zLevelsCount: zLevels.length,
      operationsCount: opSet.size,
      totalSegments: segs.length,
      renderedSegments,
      decimationRatio: renderedSegments / Math.max(1, segs.length),
      cuttingDistance: cutDist,
      rapidDistance: rapidDist,
      totalDistance: cutDist + rapidDist,
      estCycleTimeSec: cutTimeSec + rapidTimeSec,
      xMin,
      xMax,
      yMin,
      yMax,
      zMin,
      zMax,
      lineCount: parsed.totalLines,
    },
  };
}
