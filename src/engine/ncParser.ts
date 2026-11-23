import type { CamSourceFormat, MoveSegment, ParseResult } from '../types/toolpath';

const PAREN_COMMENT_RE = /\([^)]*\)/g;
const SEMI_COMMENT_RE = /;.*$/;
const WORD_RE = /([A-Z])\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))/g;
const CR_RE = /CR\s*=\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))/i;
const CL_GOTO_RE = /^\s*GOTO\s*\/\s*([+-]?\d+(?:\.\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?)/i;
const CL_FEDRAT_RE = /^\s*FEDRAT\s*\/\s*(?:[^,]*,\s*)?([+-]?\d+(?:\.\d+)?)/i;
const CL_LOADTL_RE = /^\s*(?:LOADTL|TOOLNO)\s*\/\s*(\d+)/i;

export function detectCamFormat(sampleLines: string[], filename = ''): CamSourceFormat {
  const dot = filename.lastIndexOf('.');
  const ext = dot >= 0 ? filename.slice(dot).toLowerCase() : '';
  const joined = sampleLines.slice(0, 80).join('\n').toUpperCase();

  if (joined.includes('GOTO/') || joined.includes('GOTO /') || joined.includes('FEDRAT/')) {
    return 'NX CL-Data';
  }
  if (
    joined.includes('DELCAM') ||
    joined.includes('POWERMILL') ||
    joined.includes('FEATURECAM') ||
    ext === '.ptp'
  ) {
    return 'Delcam / PowerMill';
  }
  if (
    joined.includes('SIEMENS') ||
    joined.includes('UGII') ||
    joined.includes('NX') ||
    joined.includes('OPERATION:') ||
    ext === '.mpf'
  ) {
    return 'Siemens NX';
  }
  if (ext === '.tap') {
    return 'Delcam / PowerMill';
  }
  return 'Generic ISO G-Code';
}

export class StreamingNCParser {
  private x = 0;
  private y = 0;
  private z = 0;
  private motionMode = 0; // 0=G00, 1=G01, 2=G02, 3=G03
  private absolute = true;
  private plane: 17 | 18 | 19 = 17;
  private feed = 600;
  private spindle = 0;
  private tool = 'T01';
  private operation = 'Default Operation';
  public units: 'mm' | 'inch' = 'mm';
  private clRapidNext = false;
  private readonly arcTolerance: number;

  constructor(arcToleranceMm = 0.05) {
    this.arcTolerance = Math.max(0.005, arcToleranceMm);
  }

  private extractOperationHint(commentText: string): string | null {
    const clean = commentText.replace(/^[();%\s]+|[();%\s]+$/g, '');
    if (!clean) return null;
    const upper = clean.toUpperCase();
    const keys = ['OPERATION:', 'OPERATION', 'TOOLPATH:', 'TOOLPATH', 'MSG(', 'PATH:', 'NAME:'];
    for (const key of keys) {
      const idx = upper.indexOf(key);
      if (idx !== -1) {
        const after = clean.slice(idx + key.length).replace(/^[\s:\-"')]+|[\s"']+$/g, '');
        if (after) return after.slice(0, 60);
      }
    }
    return null;
  }

  private linearizeArc(
    lineNum: number,
    x1: number,
    y1: number,
    z1: number,
    iVal: number | undefined,
    jVal: number | undefined,
    kVal: number | undefined,
    rVal: number | undefined,
    cw: boolean,
    rawLine: string
  ): MoveSegment[] {
    const x0 = this.x;
    const y0 = this.y;
    const z0 = this.z;

    let u0: number, v0: number, w0: number;
    let u1: number, v1: number, w1: number;
    let duC: number | undefined, dvC: number | undefined;

    if (this.plane === 17) {
      u0 = x0; v0 = y0; w0 = z0;
      u1 = x1; v1 = y1; w1 = z1;
      duC = iVal; dvC = jVal;
    } else if (this.plane === 18) {
      u0 = z0; v0 = x0; w0 = y0;
      u1 = z1; v1 = x1; w1 = y1;
      duC = kVal; dvC = iVal;
    } else {
      u0 = y0; v0 = z0; w0 = x0;
      u1 = y1; v1 = z1; w1 = x1;
      duC = jVal; dvC = kVal;
    }

    let cu = 0;
    let cv = 0;
    let radius = 0;

    if (duC !== undefined || dvC !== undefined) {
      cu = u0 + (duC ?? 0);
      cv = v0 + (dvC ?? 0);
      radius = Math.hypot(u0 - cu, v0 - cv);
    } else if (rVal !== undefined && Math.abs(rVal) > 1e-9) {
      const chordU = u1 - u0;
      const chordV = v1 - v0;
      const chordLen = Math.hypot(chordU, chordV);
      if (chordLen < 1e-9) return [];
      radius = Math.abs(rVal);
      const halfChord = Math.min(radius, chordLen * 0.5);
      const h = Math.sqrt(Math.max(0, radius * radius - halfChord * halfChord));
      const midU = (u0 + u1) * 0.5;
      const midV = (v0 + v1) * 0.5;
      const nx = -chordV / chordLen;
      const ny = chordU / chordLen;
      let sign = cw ? -1 : 1;
      if (rVal < 0) sign *= -1;
      cu = midU + sign * h * nx;
      cv = midV + sign * h * ny;
    } else {
      return [
        {
          lineNum,
          x0, y0, z0,
          x1, y1, z1,
          moveType: 'ARC',
          feed: this.feed,
          spindle: this.spindle,
          tool: this.tool,
          operation: this.operation,
          rawLine,
        },
      ];
    }

    if (radius < 1e-7) return [];

    const a0 = Math.atan2(v0 - cv, u0 - cu);
    const a1 = Math.atan2(v1 - cv, u1 - cu);
    let sweep = cw ? a0 - a1 : a1 - a0;
    if (sweep <= 1e-6) sweep += 2 * Math.PI;
    const stepSign = cw ? -1 : 1;

    const cosVal = Math.max(-1, Math.min(1, 1 - this.arcTolerance / Math.max(radius, this.arcTolerance)));
    const maxStep = Math.max(0.04, 2 * Math.acos(cosVal));
    const steps = Math.max(4, Math.min(72, Math.ceil(sweep / maxStep)));

    const out: MoveSegment[] = [];
    let pu = u0;
    let pv = v0;
    let pw = w0;

    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const ang = a0 + stepSign * sweep * t;
      let nu: number, nv: number, nw: number;
      if (s === steps) {
        nu = u1; nv = v1; nw = w1;
      } else {
        nu = cu + radius * Math.cos(ang);
        nv = cv + radius * Math.sin(ang);
        nw = w0 + (w1 - w0) * t;
      }

      let sx0: number, sy0: number, sz0: number;
      let sx1: number, sy1: number, sz1: number;
      if (this.plane === 17) {
        sx0 = pu; sy0 = pv; sz0 = pw;
        sx1 = nu; sy1 = nv; sz1 = nw;
      } else if (this.plane === 18) {
        sx0 = pv; sy0 = pw; sz0 = pu;
        sx1 = nv; sy1 = nw; sz1 = nu;
      } else {
        sx0 = pw; sy0 = pu; sz0 = pv;
        sx1 = nw; sy1 = nu; sz1 = nv;
      }

      out.push({
        lineNum,
        x0: sx0, y0: sy0, z0: sz0,
        x1: sx1, y1: sy1, z1: sz1,
        moveType: 'ARC',
        feed: this.feed,
        spindle: this.spindle,
        tool: this.tool,
        operation: this.operation,
        rawLine,
      });
      pu = nu; pv = nv; pw = nw;
    }

    return out;
  }

  public parseLine(lineNum: number, raw: string): MoveSegment[] {
    const stripped = raw.trim();
    if (!stripped || stripped === '%') return [];

    // Extract comments for NX / Delcam operation hints
    const parenMatches = stripped.match(PAREN_COMMENT_RE);
    if (parenMatches) {
      for (const c of parenMatches) {
        const hint = this.extractOperationHint(c);
        if (hint) this.operation = hint;
      }
    }
    const semiMatch = stripped.match(SEMI_COMMENT_RE);
    if (semiMatch) {
      const hint = this.extractOperationHint(semiMatch[0]);
      if (hint) this.operation = hint;
    }

    const upper = stripped.toUpperCase();

    // CL-Data statements (Siemens NX CLSF / Delcam APT)
    if (upper.startsWith('PPRINT')) {
      const hint = this.extractOperationHint(stripped.slice(6));
      if (hint) this.operation = hint;
      return [];
    }
    if (upper.startsWith('RAPID')) {
      this.clRapidNext = true;
      return [];
    }
    const clTool = stripped.match(CL_LOADTL_RE);
    if (clTool) {
      this.tool = `T${String(parseInt(clTool[1], 10)).padStart(2, '0')}`;
      return [];
    }
    const clFeed = stripped.match(CL_FEDRAT_RE);
    if (clFeed) {
      this.feed = Math.max(1, parseFloat(clFeed[1]));
      return [];
    }
    const clGoto = stripped.match(CL_GOTO_RE);
    if (clGoto) {
      const nx = parseFloat(clGoto[1]);
      const ny = parseFloat(clGoto[2]);
      const nz = parseFloat(clGoto[3]);
      const moveType = this.clRapidNext ? 'RAPID' : 'CUT';
      this.clRapidNext = false;
      const seg: MoveSegment = {
        lineNum,
        x0: this.x, y0: this.y, z0: this.z,
        x1: nx, y1: ny, z1: nz,
        moveType,
        feed: this.feed,
        spindle: this.spindle,
        tool: this.tool,
        operation: this.operation,
        rawLine: stripped,
      };
      this.x = nx; this.y = ny; this.z = nz;
      return [seg];
    }

    // Standard ISO / Siemens / Delcam G-code
    let code = stripped.replace(PAREN_COMMENT_RE, ' ').replace(SEMI_COMMENT_RE, '').trim().toUpperCase();
    if (!code) return [];

    let crVal: number | undefined;
    const crMatch = code.match(CR_RE);
    if (crMatch) {
      crVal = parseFloat(crMatch[1]);
      code = code.replace(CR_RE, ' ');
    }

    const words: Record<string, number> = {};
    const gCodes: number[] = [];

    WORD_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = WORD_RE.exec(code)) !== null) {
      const letter = m[1];
      const val = parseFloat(m[2]);
      if (Number.isNaN(val)) continue;
      if (letter === 'G') {
        gCodes.push(Math.round(val));
      } else if (letter !== 'N') {
        words[letter] = val;
      }
    }

    if (gCodes.length === 0 && Object.keys(words).length === 0) return [];

    for (const g of gCodes) {
      if (g === 0 || g === 1 || g === 2 || g === 3) this.motionMode = g;
      else if (g === 90) this.absolute = true;
      else if (g === 91) this.absolute = false;
      else if (g === 17) this.plane = 17;
      else if (g === 18) this.plane = 18;
      else if (g === 19) this.plane = 19;
      else if (g === 20) this.units = 'inch';
      else if (g === 21) this.units = 'mm';
    }

    if (words['F'] !== undefined && words['F'] > 0) this.feed = words['F'];
    if (words['S'] !== undefined && words['S'] >= 0) this.spindle = words['S'];
    if (words['T'] !== undefined) {
      this.tool = `T${String(Math.round(words['T'])).padStart(2, '0')}`;
    }

    const hasAxis = words['X'] !== undefined || words['Y'] !== undefined || words['Z'] !== undefined;
    if (!hasAxis) return [];

    const nx = this.absolute ? (words['X'] ?? this.x) : this.x + (words['X'] ?? 0);
    const ny = this.absolute ? (words['Y'] ?? this.y) : this.y + (words['Y'] ?? 0);
    const nz = this.absolute ? (words['Z'] ?? this.z) : this.z + (words['Z'] ?? 0);

    if (
      Math.abs(nx - this.x) < 1e-9 &&
      Math.abs(ny - this.y) < 1e-9 &&
      Math.abs(nz - this.z) < 1e-9
    ) {
      return [];
    }

    if (this.motionMode === 2 || this.motionMode === 3) {
      const rParam = crVal !== undefined ? crVal : words['R'];
      const segs = this.linearizeArc(
        lineNum,
        nx, ny, nz,
        words['I'], words['J'], words['K'],
        rParam,
        this.motionMode === 2,
        stripped
      );
      this.x = nx; this.y = ny; this.z = nz;
      return segs;
    }

    const seg: MoveSegment = {
      lineNum,
      x0: this.x, y0: this.y, z0: this.z,
      x1: nx, y1: ny, z1: nz,
      moveType: this.motionMode === 0 ? 'RAPID' : 'CUT',
      feed: this.feed,
      spindle: this.spindle,
      tool: this.tool,
      operation: this.operation,
      rawLine: stripped,
    };
    this.x = nx; this.y = ny; this.z = nz;
    return [seg];
  }
}

export function parseNCText(text: string, filename = ''): ParseResult {
  const parser = new StreamingNCParser(0.05);
  const rawLines = text.split(/\r?\n/);
  const segments: MoveSegment[] = [];
  const warnings: string[] = [];

  for (let i = 0; i < rawLines.length; i++) {
    try {
      const segs = parser.parseLine(i + 1, rawLines[i]);
      for (let j = 0; j < segs.length; j++) {
        segments.push(segs[j]);
      }
    } catch (err) {
      if (warnings.length < 25) {
        warnings.push(`Line ${i + 1}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  return {
    segments,
    rawLines,
    sourceFormat: detectCamFormat(rawLines, filename),
    totalLines: rawLines.length,
    warnings,
    units: parser.units,
  };
}

/**
 * Chunked streaming File parser using File.slice() + TextDecoder.
 * Yields to the browser main thread every chunk so multi-megabyte files never freeze the UI.
 */
export async function parseNCFileStreaming(
  file: File,
  onProgress?: (pct: number, linesParsed: number) => void
): Promise<ParseResult> {
  const CHUNK_BYTES = 256 * 1024; // 256 KB per tick
  const decoder = new TextDecoder('utf-8', { fatal: false });
  const parser = new StreamingNCParser(0.05);

  const segments: MoveSegment[] = [];
  const rawLines: string[] = [];
  const headerSample: string[] = [];
  const warnings: string[] = [];

  let offset = 0;
  let leftover = '';
  let lineNum = 0;

  while (offset < file.size) {
    const end = Math.min(file.size, offset + CHUNK_BYTES);
    const buffer = await file.slice(offset, end).arrayBuffer();
    const isLast = end >= file.size;
    const chunkText = leftover + decoder.decode(buffer, { stream: !isLast });

    const lines = chunkText.split(/\r?\n/);
    if (!isLast) {
      leftover = lines.pop() ?? '';
    } else {
      leftover = '';
    }

    for (let i = 0; i < lines.length; i++) {
      lineNum++;
      const line = lines[i];
      rawLines.push(line);
      if (headerSample.length < 80) headerSample.push(line);
      try {
        const segs = parser.parseLine(lineNum, line);
        for (let j = 0; j < segs.length; j++) {
          segments.push(segs[j]);
        }
      } catch (err) {
        if (warnings.length < 25) {
          warnings.push(`Line ${lineNum}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }

    offset = end;
    if (onProgress) {
      const pct = Math.min(100, Math.round((offset / Math.max(1, file.size)) * 100));
      onProgress(pct, lineNum);
    }

    // Yield to UI event loop
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  return {
    segments,
    rawLines,
    sourceFormat: detectCamFormat(headerSample, file.name),
    totalLines: lineNum,
    warnings,
    units: parser.units,
  };
}
