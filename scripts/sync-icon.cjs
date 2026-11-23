/**
 * scripts/sync-icon.cjs
 *
 * Ensures app_icon/icon.ico is always a valid multi-size Windows ICO file
 * before electron-builder packages the .EXE.
 *
 * If the user replaces app_icon/icon.png (so icon.png is newer than icon.ico,
 * or icon.ico is missing), this script uses Windows PowerShell + System.Drawing
 * to generate a clean multi-size (256, 48, 32, 16) icon.ico automatically.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const iconDir = path.join(rootDir, 'app_icon');
const icoPath = path.join(iconDir, 'icon.ico');
const pngPath = path.join(iconDir, 'icon.png');

function isValidIco(filePath) {
  if (!fs.existsSync(filePath)) return false;
  const buf = fs.readFileSync(filePath);
  if (buf.length < 22) return false;
  // Valid ICO starts with 00 00 01 00
  return buf[0] === 0 && buf[1] === 0 && buf[2] === 1 && buf[3] === 0;
}

function buildMultiSizeIcoFromPngViaPowerShell(srcPng, destIco) {
  const psScript = `
Add-Type -AssemblyName System.Drawing
$src = [System.Drawing.Image]::FromFile('${srcPng.replace(/'/g, "''")}')
$sizes = @(16, 32, 48, 256)
$pngStreams = @()
foreach ($s in $sizes) {
  $bmp = New-Object System.Drawing.Bitmap $s, $s
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.DrawImage($src, 0, 0, $s, $s)
  $g.Dispose()
  $ms = New-Object System.IO.MemoryStream
  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  $pngStreams += ,($ms.ToArray())
  $ms.Dispose()
}
$src.Dispose()

$fs = [System.IO.File]::Open('${destIco.replace(/'/g, "''")}', [System.IO.FileMode]::Create)
$bw = New-Object System.IO.BinaryWriter($fs)
$bw.Write([UInt16]0)
$bw.Write([UInt16]1)
$bw.Write([UInt16]$sizes.Count)

$offset = 6 + (16 * $sizes.Count)
for ($i = 0; $i -lt $sizes.Count; $i++) {
  $s = $sizes[$i]
  $bytes = $pngStreams[$i]
  $w = if ($s -eq 256) { [byte]0 } else { [byte]$s }
  $h = if ($s -eq 256) { [byte]0 } else { [byte]$s }
  $bw.Write($w)
  $bw.Write($h)
  $bw.Write([byte]0)
  $bw.Write([byte]0)
  $bw.Write([UInt16]1)
  $bw.Write([UInt16]32)
  $bw.Write([UInt32]$bytes.Length)
  $bw.Write([UInt32]$offset)
  $offset += $bytes.Length
}
for ($i = 0; $i -lt $sizes.Count; $i++) {
  $bw.Write($pngStreams[$i])
}
$bw.Close()
$fs.Close()
`;
  execFileSync(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psScript],
    { stdio: 'inherit' }
  );
}

function buildSinglePngIcoFallback(srcPng, destIco) {
  const pngBuf = fs.readFileSync(srcPng);
  // Check PNG signature
  if (pngBuf.length < 24 || pngBuf[0] !== 0x89 || pngBuf[1] !== 0x50) {
    throw new Error('app_icon/icon.png is not a valid PNG image.');
  }
  const header = Buffer.alloc(6 + 16);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  header.writeUInt8(0, 6);  // 256px
  header.writeUInt8(0, 7);
  header.writeUInt8(0, 8);
  header.writeUInt8(0, 9);
  header.writeUInt16LE(1, 10);
  header.writeUInt16LE(32, 12);
  header.writeUInt32LE(pngBuf.length, 14);
  header.writeUInt32LE(22, 18);
  fs.writeFileSync(destIco, Buffer.concat([header, pngBuf]));
}

function main() {
  if (!fs.existsSync(iconDir)) {
    console.error('[ERROR] app_icon directory is missing.');
    process.exit(1);
  }

  const hasPng = fs.existsSync(pngPath);
  const hasValidIco = isValidIco(icoPath);

  if (hasPng) {
    const pngStat = fs.statSync(pngPath);
    const icoMtime = hasValidIco ? fs.statSync(icoPath).mtimeMs : 0;

    if (!hasValidIco || pngStat.mtimeMs > icoMtime + 500) {
      console.log('[Icon] Detected updated app_icon/icon.png -> generating multi-size icon.ico...');
      try {
        if (process.platform === 'win32') {
          buildMultiSizeIcoFromPngViaPowerShell(pngPath, icoPath);
        } else {
          buildSinglePngIcoFallback(pngPath, icoPath);
        }
        console.log('[Icon] app_icon/icon.ico updated successfully.');
      } catch (err) {
        console.warn('[Icon] PowerShell resize fallback triggered:', err.message);
        buildSinglePngIcoFallback(pngPath, icoPath);
      }
      return;
    }
  }

  if (!hasValidIco) {
    console.error('[ERROR] Valid app_icon/icon.ico or app_icon/icon.png not found!');
    console.error('Please place a valid .ico or .png image inside app_icon\\');
    process.exit(1);
  }

  console.log('[Icon] Using valid app_icon/icon.ico.');
}

main();
