import { copyFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PNG } from 'pngjs';

const root = process.cwd();
const charDir = join(root, 'public/assets/player/caixukun');
const source = 'super-background-v1';
const frames = 25;

async function main() {
  const srcDir = join(charDir, '_review-v2/frames', source);
  const files = (await readdir(srcDir)).filter((f) => f.endsWith('.png')).sort();
  if (files.length !== frames) {
    throw new Error(`super-background: expected ${frames} frames, got ${files.length}`);
  }

  const outDir = join(charDir, 'super-background');
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  for (const file of files) {
    const src = join(srcDir, file);
    const dest = join(outDir, file);
    await copyFile(src, dest);
    const png = PNG.sync.read(await readFile(dest));
    if (png.width !== 1920 || png.height !== 1080) {
      throw new Error(`${dest}: expected 1920x1080, got ${png.width}x${png.height}`);
    }
  }

  const manifestPath = join(charDir, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.superBackground = {
    dir: 'assets/player/caixukun/super-background',
    frames,
    frameRate: 10,
    playback: 'forward',
    matte: false,
    fullscreen: true,
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Installed caixukun super-background from ${source}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
