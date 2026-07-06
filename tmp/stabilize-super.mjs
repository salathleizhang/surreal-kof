import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PNG } from 'pngjs';

const [inputDir, outputDir] = process.argv.slice(2);
if (!inputDir || !outputDir) throw new Error('usage: node stabilize-super.mjs <input-dir> <output-dir>');

const files = (await readdir(inputDir)).filter((f) => f.endsWith('.png')).sort();
const first = 29;
const last = 65;
const count = 25;
const selected = Array.from({ length: count }, (_, i) => Math.round(first + ((last - first) * i) / (count - 1)));

await mkdir(outputDir, { recursive: true });

function isForeground(data, i) {
  const r = data[i];
  const g = data[i + 1];
  const b = data[i + 2];
  return !(r > 190 && b > 190 && g < 95);
}

for (let outIndex = 0; outIndex < selected.length; outIndex += 1) {
  const src = PNG.sync.read(await readFile(join(inputDir, files[selected[outIndex]])));
  let minX = src.width;
  let minY = src.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < src.height; y += 1) {
    for (let x = 0; x < src.width; x += 1) {
      const i = (y * src.width + x) * 4;
      if (!isForeground(src.data, i)) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (maxX < 0) throw new Error(`no foreground in ${files[selected[outIndex]]}`);

  let footMinX = src.width;
  let footMaxX = -1;
  for (let y = Math.max(minY, maxY - 90); y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const i = (y * src.width + x) * 4;
      if (!isForeground(src.data, i)) continue;
      footMinX = Math.min(footMinX, x);
      footMaxX = Math.max(footMaxX, x);
    }
  }
  const footX = footMaxX >= 0 ? (footMinX + footMaxX) / 2 : (minX + maxX) / 2;
  const t = outIndex / (selected.length - 1);
  const scale = 1 + 0.12 * t;
  const anchorX = 280;
  const anchorY = 740;
  const out = new PNG({ width: 560, height: 752 });
  for (let i = 0; i < out.data.length; i += 4) {
    out.data[i] = 255;
    out.data[i + 1] = 0;
    out.data[i + 2] = 255;
    out.data[i + 3] = 255;
  }

  const dx0 = Math.max(0, Math.floor(anchorX + (minX - footX) * scale));
  const dx1 = Math.min(out.width - 1, Math.ceil(anchorX + (maxX - footX) * scale));
  const dy0 = Math.max(0, Math.floor(anchorY + (minY - maxY) * scale));
  const dy1 = Math.min(out.height - 1, anchorY);
  for (let dy = dy0; dy <= dy1; dy += 1) {
    for (let dx = dx0; dx <= dx1; dx += 1) {
      const sx = Math.round(footX + (dx - anchorX) / scale);
      const sy = Math.round(maxY + (dy - anchorY) / scale);
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
  await writeFile(join(outputDir, `${String(outIndex + 1).padStart(4, '0')}.png`), PNG.sync.write(out));
}
