export type MoveType = 'RAPID' | 'CUT' | 'ARC';

export type CamSourceFormat =
  | 'Siemens NX'
  | 'Delcam / PowerMill'
  | 'NX CL-Data'
  | 'Generic ISO G-Code';

export type ViewMode = 'XY' | 'XZ' | 'YZ' | '3D';

export type LodMode = 'auto' | 'full' | 'fast';

export interface MoveSegment {
  lineNum: number;
  x0: number;
  y0: number;
  z0: number;
  x1: number;
  y1: number;
  z1: number;
  moveType: MoveType;
  feed: number;
  spindle: number;
  tool: string;
  operation: string;
  rawLine: string;
}

export interface ToolpathPass {
  passId: number;
  passType: 'CUT' | 'RAPID';
  zLevel: number;
  operation: string;
  tool: string;
  startLine: number;
  endLine: number;
  segments: MoveSegment[];
  distance: number;
  durationSec: number;
  visible: boolean;
}

export interface ProgramStats {
  totalPasses: number;
  cuttingPasses: number;
  rapidPasses: number;
  zLevelsCount: number;
  operationsCount: number;
  totalSegments: number;
  renderedSegments: number;
  decimationRatio: number;
  cuttingDistance: number;
  rapidDistance: number;
  totalDistance: number;
  estCycleTimeSec: number;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  zMin: number;
  zMax: number;
  lineCount: number;
}

export interface ParseResult {
  segments: MoveSegment[];
  rawLines: string[];
  sourceFormat: CamSourceFormat;
  totalLines: number;
  warnings: string[];
  units: 'mm' | 'inch';
}

export interface DisplayOptions {
  showCutting: boolean;
  showRapids: boolean;
  showArrows: boolean;
  showMarkers: boolean;
  colorByZ: boolean;
}
