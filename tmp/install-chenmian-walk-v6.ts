import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { matteFile } from '../server/matte.ts';

const root = process.cwd();
const sourceDir = join(root, 'public/assets/player/chenmian/_review-v2/videos/walk-v6-continuous-frames');
const outputDir = join(root, 'public/assets/player/chenmian/walk');
const files = (await readdir(sourceDir)).filter((file) => file.endsWith('.png')).sort();
const shiftX = 70;

if (files.length !== 12) throw new Error(`Expected 12 approved walk frames, got ${files.length}`);
await mkdir(outputDir, { recursive: true });

for (let index = 0; index < files.length; index += 1) {
  const output = join(outputDir, `${String(index + 1).padStart(4, '0')}.png`);
  await matteFile(join(sourceDir, files[index]), output);
  const png = PNG.sync.read(await readFile(output));
  if (png.width !== 560 || png.height !== 752 || png.data[3] !== 0) {
    throw new Error(`Invalid installed frame: ${output}`);
  }
  const centered = new PNG({ width: png.width, height: png.height });
  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < png.width - shiftX; x += 1) {
      const sourceOffset = (y * png.width + x) * 4;
      const targetOffset = (y * png.width + x + shiftX) * 4;
      png.data.copy(centered.data, targetOffset, sourceOffset, sourceOffset + 4);
    }
  }
  await writeFile(output, PNG.sync.write(centered));
}

console.log('Installed Chen Mian walk V6: 12 continuous transparent frames at 12 fps, centered +70px.');
