import { copyFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PNG } from 'pngjs';

const root = process.cwd();
const charDir = join(root, 'public/assets/player/caixukun');

const configs: Record<string, {
  source: string;
  frames: number;
  frameRate?: number;
  playback: 'loop' | 'forward' | 'yoyo' | 'hold';
  engineState: number | string;
  matte: boolean;
}> = {
  jump: {
    source: 'jump-v3-safe',
    frames: 8,
    frameRate: 12,
    playback: 'forward',
    engineState: 3,
    matte: true,
  },
  guard: {
    source: 'guard-v2-fixed',
    frames: 8,
    frameRate: 8,
    playback: 'hold',
    engineState: 10,
    matte: true,
  },
  hit: {
    source: 'hit-v1',
    frames: 8,
    frameRate: 10,
    playback: 'forward',
    engineState: 5,
    matte: true,
  },
  super: {
    source: 'super-v3',
    frames: 16,
    frameRate: 16,
    playback: 'forward',
    engineState: 'super',
    matte: true,
  },
};

async function assertTransparentFrame(path: string) {
  const png = PNG.sync.read(await readFile(path));
  if (png.width !== 560 || png.height !== 752) {
    throw new Error(`${path}: expected 560x752, got ${png.width}x${png.height}`);
  }
  if (png.data[3] !== 0) throw new Error(`${path}: top-left corner is not transparent`);
}

async function main() {
  const key = process.argv[2];
  const config = configs[key];
  if (!config) throw new Error(`Unknown or unapproved animation: ${key}`);

  const srcDir = join(charDir, '_review-v2/frames', config.source);
  const files = (await readdir(srcDir)).filter((f) => f.endsWith('.png')).sort();
  if (files.length !== config.frames) {
    throw new Error(`${key}: expected ${config.frames} approved frames, got ${files.length}`);
  }

  const outDir = join(charDir, key);
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  for (const file of files) {
    await copyFile(join(srcDir, file), join(outDir, file));
    if (config.matte) await assertTransparentFrame(join(outDir, file));
  }

  const manifestPath = join(charDir, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.anims = manifest.anims || {};
  manifest.anims[key] = {
    engineState: config.engineState,
    dir: `assets/player/caixukun/${key}`,
    frames: config.frames,
    ...(config.frameRate ? { frameRate: config.frameRate } : {}),
    playback: config.playback,
    matte: config.matte,
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Installed caixukun ${key} from ${config.source}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
