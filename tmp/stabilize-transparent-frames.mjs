import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PNG } from 'pngjs';

const [inputDir, outputDir] = process.argv.slice(2);
if (!inputDir || !outputDir) throw new Error('usage: node stabilize-transparent-frames.mjs <input-dir> <output-dir>');
const files = (await readdir(inputDir)).filter((f) => f.endsWith('.png')).sort();
await mkdir(outputDir, { recursive: true });

for (const file of files) {
  const src = PNG.sync.read(await readFile(join(inputDir, file)));
  let minX = src.width; let minY = src.height; let maxX = -1; let maxY = -1;
  for (let y = 0; y < src.height; y += 1) {
    for (let x = 0; x < src.width; x += 1) {
      if (src.data[(y * src.width + x) * 4 + 3] <= 8) continue;
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    }
  }
  if (maxX < 0) throw new Error(`no foreground in ${file}`);

  let footMinX = src.width; let footMaxX = -1;
  for (let y = Math.max(minY, maxY - 100); y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      if (src.data[(y * src.width + x) * 4 + 3] <= 8) continue;
      footMinX = Math.min(footMinX, x); footMaxX = Math.max(footMaxX, x);
    }
  }
  const footX = footMaxX >= 0 ? (footMinX + footMaxX) / 2 : (minX + maxX) / 2;
  const offsetX = Math.round(280 - footX);
  const offsetY = 740 - maxY;
  const out = new PNG({ width: 560, height: 752 });

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const si = (y * src.width + x) * 4;
      if (src.data[si + 3] <= 8) continue;
      const dx = x + offsetX; const dy = y + offsetY;
      if (dx < 0 || dx >= out.width || dy < 0 || dy >= out.height) continue;
      const di = (dy * out.width + dx) * 4;
      out.data[di] = src.data[si]; out.data[di + 1] = src.data[si + 1];
      out.data[di + 2] = src.data[si + 2]; out.data[di + 3] = src.data[si + 3];
    }
  }
  await writeFile(join(outputDir, file), PNG.sync.write(out));
}
