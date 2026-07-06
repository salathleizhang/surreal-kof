import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PNG } from 'pngjs';

const [inputDir, outputDir] = process.argv.slice(2);
if (!inputDir || !outputDir) throw new Error('usage: node stabilize-walk.mjs <input-dir> <output-dir>');
const files = (await readdir(inputDir)).filter((f) => f.endsWith('.png')).sort();
await mkdir(outputDir, { recursive: true });

function isForeground(data, i) {
  const r = data[i];
  const g = data[i + 1];
  const b = data[i + 2];
  return !(r > 190 && b > 190 && g < 95);
}

for (let frame = 0; frame < files.length; frame += 1) {
  const src = PNG.sync.read(await readFile(join(inputDir, files[frame])));
  let minX = src.width; let minY = src.height; let maxX = -1; let maxY = -1;
  for (let y = 0; y < src.height; y += 1) {
    for (let x = 0; x < src.width; x += 1) {
      const i = (y * src.width + x) * 4;
      if (!isForeground(src.data, i)) continue;
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    }
  }
  if (maxX < 0) throw new Error(`no foreground in ${files[frame]}`);

  const hipY = minY + (maxY - minY) * 0.525;
  const legScale = 1.15;
  let footMinX = src.width; let footMaxX = -1;
  for (let y = Math.max(minY, maxY - 90); y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const i = (y * src.width + x) * 4;
      if (!isForeground(src.data, i)) continue;
      footMinX = Math.min(footMinX, x); footMaxX = Math.max(footMaxX, x);
    }
  }
  const footX = footMaxX >= 0 ? (footMinX + footMaxX) / 2 : (minX + maxX) / 2;
  const anchorX = 280;
  const anchorY = 740;
  const destHipY = anchorY - (maxY - hipY) * legScale;

  const out = new PNG({ width: 560, height: 752 });
  for (let i = 0; i < out.data.length; i += 4) {
    out.data[i] = 255; out.data[i + 1] = 0; out.data[i + 2] = 255; out.data[i + 3] = 255;
  }

  const dx0 = Math.max(0, Math.floor(anchorX + minX - footX));
  const dx1 = Math.min(out.width - 1, Math.ceil(anchorX + maxX - footX));
  const dy0 = Math.max(0, Math.floor(destHipY - (hipY - minY)));
  for (let dy = dy0; dy <= anchorY; dy += 1) {
    for (let dx = dx0; dx <= dx1; dx += 1) {
      const sx = Math.round(footX + dx - anchorX);
      const sy = dy <= destHipY
        ? Math.round(hipY - (destHipY - dy))
        : Math.round(hipY + (dy - destHipY) / legScale);
      if (sx < 0 || sx >= src.width || sy < 0 || sy >= src.height) continue;
      const si = (sy * src.width + sx) * 4;
      if (!isForeground(src.data, si)) continue;
      const di = (dy * out.width + dx) * 4;
      out.data[di] = src.data[si];
      out.data[di + 1] = src.data[si + 1];
      out.data[di + 2] = src.data[si + 2];
      out.data[di + 3] = 255;
    }
  }
  await writeFile(join(outputDir, `${String(frame + 1).padStart(4, '0')}.png`), PNG.sync.write(out));
}
