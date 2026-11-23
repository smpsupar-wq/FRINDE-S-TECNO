export interface SampleProgram {
  id: 'nx' | 'delcam' | 'cl';
  label: string;
  filename: string;
  description: string;
  content: string;
}

export function getNxCavitySample(): string {
  const lines: string[] = [
    '%',
    '; SIEMENS NX CAM POSTPROCESSOR OUTPUT',
    '; PART: HOUSING_BRACKET_REV_C',
    '; OPERATION: CAVITY_MILL_ROUGH',
    'N0010 G90 G17 G21 G40 G80',
    'N0020 T01 M06',
    'N0030 S4800 M03',
    'N0040 G00 X0.000 Y0.000 Z50.000',
  ];

  let seq = 50;
  const zLevels = [-4.0, -8.0, -12.0, -16.0];
  zLevels.forEach((z, idx) => {
    lines.push(`; Z-LEVEL ${idx + 1} (STEPDOWN Z=${z.toFixed(1)})`);
    lines.push(`N${String(seq).padStart(4, '0')} G00 X12.000 Y12.000 Z${(z + 6.0).toFixed(3)}`);
    seq += 10;
    lines.push(`N${String(seq).padStart(4, '0')} G01 Z${z.toFixed(3)} F320.0`);
    seq += 10;

    for (const offset of [12.0, 22.0, 32.0]) {
      const xMin = offset;
      const xMax = 120.0 - offset;
      const yMin = offset;
      const yMax = 85.0 - offset;
      const r = 5.0;

      lines.push(`N${String(seq).padStart(4, '0')} G01 X${xMin.toFixed(3)} Y${(yMin + r).toFixed(3)} F1100.0`);
      seq += 10;
      lines.push(`N${String(seq).padStart(4, '0')} G01 X${xMin.toFixed(3)} Y${(yMax - r).toFixed(3)}`);
      seq += 10;
      lines.push(`N${String(seq).padStart(4, '0')} G02 X${(xMin + r).toFixed(3)} Y${yMax.toFixed(3)} I${r.toFixed(3)} J0.000`);
      seq += 10;
      lines.push(`N${String(seq).padStart(4, '0')} G01 X${(xMax - r).toFixed(3)} Y${yMax.toFixed(3)}`);
      seq += 10;
      lines.push(`N${String(seq).padStart(4, '0')} G02 X${xMax.toFixed(3)} Y${(yMax - r).toFixed(3)} I0.000 J-${r.toFixed(3)}`);
      seq += 10;
      lines.push(`N${String(seq).padStart(4, '0')} G01 X${xMax.toFixed(3)} Y${(yMin + r).toFixed(3)}`);
      seq += 10;
      lines.push(`N${String(seq).padStart(4, '0')} G02 X${(xMax - r).toFixed(3)} Y${yMin.toFixed(3)} I-${r.toFixed(3)} J0.000`);
      seq += 10;
      lines.push(`N${String(seq).padStart(4, '0')} G01 X${(xMin + r).toFixed(3)} Y${yMin.toFixed(3)}`);
      seq += 10;
      lines.push(`N${String(seq).padStart(4, '0')} G02 X${xMin.toFixed(3)} Y${(yMin + r).toFixed(3)} I0.000 J${r.toFixed(3)}`);
      seq += 10;
    }

    lines.push(`N${String(seq).padStart(4, '0')} G00 Z25.000`);
    seq += 10;
  });

  lines.push('; OPERATION: ZLEVEL_PROFILE_FINISH');
  lines.push(`N${String(seq).padStart(4, '0')} T02 M06`);
  seq += 10;
  lines.push(`N${String(seq).padStart(4, '0')} S7200 M03`);
  seq += 10;
  lines.push(`N${String(seq).padStart(4, '0')} G00 X6.000 Y6.000 Z25.000`);
  seq += 10;

  for (const z of [-8.0, -16.0]) {
    lines.push(`N${String(seq).padStart(4, '0')} G00 Z${(z + 3.0).toFixed(3)}`);
    seq += 10;
    lines.push(`N${String(seq).padStart(4, '0')} G01 Z${z.toFixed(3)} F400.0`);
    seq += 10;
    lines.push(`N${String(seq).padStart(4, '0')} G01 X114.000 Y6.000 F1450.0`);
    seq += 10;
    lines.push(`N${String(seq).padStart(4, '0')} G01 X114.000 Y79.000`);
    seq += 10;
    lines.push(`N${String(seq).padStart(4, '0')} G01 X6.000 Y79.000`);
    seq += 10;
    lines.push(`N${String(seq).padStart(4, '0')} G01 X6.000 Y6.000`);
    seq += 10;
    lines.push(`N${String(seq).padStart(4, '0')} G00 Z30.000`);
    seq += 10;
  }

  lines.push(`N${String(seq).padStart(4, '0')} M30`);
  lines.push('%');
  return lines.join('\n');
}

export function getDelcamRasterSample(): string {
  const lines: string[] = [
    '%',
    '(DELCAM POWERMILL 3D RASTER FINISH)',
    '(TOOLPATH: DOME_SURFACE_RASTER)',
    'G90 G17 G21',
    'T04 M06',
    'S9500 M03',
    'G00 X0.000 Y0.000 Z35.000',
  ];

  const rows = 16;
  const cols = 28;
  for (let r = 0; r < rows; r++) {
    const y = r * 5.0;
    const xs = Array.from({ length: cols }, (_, c) => c * 4.0);
    if (r % 2 === 1) xs.reverse();

    const zStart = -10.0 + 7.5 * Math.sin(xs[0] / 34.0) * Math.cos((y - 37.5) / 28.0);
    lines.push(`G00 X${xs[0].toFixed(3)} Y${y.toFixed(3)} Z18.000`);
    lines.push(`G01 Z${zStart.toFixed(3)} F650.0`);
    for (let i = 1; i < xs.length; i++) {
      const x = xs[i];
      const z = -10.0 + 7.5 * Math.sin(x / 34.0) * Math.cos((y - 37.5) / 28.0);
      lines.push(`G01 X${x.toFixed(3)} Y${y.toFixed(3)} Z${z.toFixed(3)} F1800.0`);
    }
    lines.push('G00 Z18.000');
  }

  lines.push('G00 Z45.000', 'M30', '%');
  return lines.join('\n');
}

export function getNxClDataSample(): string {
  return [
    'PPRINT/ OPERATION: PLANAR_FACE_MILL',
    'LOADTL/ 03',
    'RAPID',
    'GOTO/ -10.000, 10.000, 30.000',
    'FEDRAT/ MMPM, 1200.0',
    'GOTO/ -10.000, 10.000, -2.000',
    'GOTO/ 110.000, 10.000, -2.000',
    'RAPID',
    'GOTO/ 110.000, 10.000, 15.000',
    'GOTO/ 110.000, 30.000, 15.000',
    'FEDRAT/ MMPM, 1200.0',
    'GOTO/ 110.000, 30.000, -2.000',
    'GOTO/ -10.000, 30.000, -2.000',
    'RAPID',
    'GOTO/ -10.000, 30.000, 15.000',
    'GOTO/ -10.000, 50.000, 15.000',
    'FEDRAT/ MMPM, 1200.0',
    'GOTO/ -10.000, 50.000, -2.000',
    'GOTO/ 110.000, 50.000, -2.000',
    'RAPID',
    'GOTO/ 110.000, 50.000, 40.000',
  ].join('\n');
}

export const SAMPLE_PROGRAMS: SampleProgram[] = [
  {
    id: 'nx',
    label: 'NX Cavity + Profile (.mpf)',
    filename: 'nx_housing_cavity.mpf',
    description: '4 Z-level roughing pocket passes with G02 corner arcs + T02 Z-level finish profile',
    content: getNxCavitySample(),
  },
  {
    id: 'delcam',
    label: 'Delcam 3D Raster (.tap)',
    filename: 'delcam_dome_raster.tap',
    description: 'PowerMill zig-zag 3D surface finishing raster passes across contoured Z dome',
    content: getDelcamRasterSample(),
  },
  {
    id: 'cl',
    label: 'NX CL-Data GOTO (.txt)',
    filename: 'nx_planar_cldata.txt',
    description: 'APT / CLSF toolpath text output with PPRINT, LOADTL, RAPID, FEDRAT, and GOTO/',
    content: getNxClDataSample(),
  },
];
