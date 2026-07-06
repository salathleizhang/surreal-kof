import { execFileSync } from 'node:child_process';
import {
  copyFile, mkdir, readFile, readdir, rm, writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { matteFile } from '../server/matte.ts';

const root = process.cwd();
const charDir = join(root, 'public/assets/player/chenmian');
const review = join(charDir, '_review-v2');
const videos = join(review, 'videos');
const work = join(charDir, '_work/v2-integration');

const anims = [
  { key: 'idle', video: 'idle-v1.mp4', frames: 8, playback: 'loop', engineState: 0 },
  { key: 'walk', video: 'walk-v1.mp4', frames: 8, playback: 'loop', engineState: 1 },
  { key: 'jump', video: 'jump-v4.mp4', frames: 8, frameRate: 8, playback: 'forward', engineState: 3 },
  { key: 'guard', video: 'guard-v2.mp4', frames: 8, frameRate: 8, playback: 'hold', engineState: 10 },
  { key: 'hit', video: 'hit-v4.mp4', frames: 8, frameRate: 10, playback: 'forward', engineState: 5 },
  { key: 'attack1', video: 'attack1-v1.mp4', frames: 7, frameRate: 10, playback: 'forward', engineState: 4 },
  { key: 'attack2', video: 'attack2-v2.mp4', frames: 9, frameRate: 10, playback: 'forward', engineState: 'attack2' },
  { key: 'intro', video: 'intro-v1.mp4', frames: 8, frameRate: 10, playback: 'forward', engineState: 'intro' },
  { key: 'death', video: 'death-v5.mp4', frames: 10, frameRate: 8, playback: 'hold', engineState: 6 },
  { key: 'super', video: 'super-v3.mp4', frames: 16, frameRate: 16, playback: 'forward', engineState: 'super' },
] as const;

const background = {
  key: 'super-background', video: 'super-background-v1.mp4', frames: 25,
  frameRate: 10, playback: 'forward', matte: false, fullscreen: true,
};

function run(command: string, args: string[]) {
  execFileSync(command, args, { stdio: 'inherit' });
}

async function extractAll(videoPath: string, outDir: string) {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  run('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', videoPath, '-vsync', '0', join(outDir, '%04d.png')]);
  return (await readdir(outDir)).filter((f) => f.endsWith('.png')).sort();
}

function evenly(files: string[], count: number) {
  return Array.from({ length: count }, (_, i) => files[Math.round((i * (files.length - 1)) / (count - 1))]);
}

async function installAnimation(anim: typeof anims[number]) {
  const rawDir = join(work, `${anim.key}-raw`);
  const files = await extractAll(join(videos, anim.video), rawDir);
  const selected = evenly(files, anim.frames);
  const outDir = join(charDir, anim.key);
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  for (let i = 0; i < selected.length; i += 1) {
    await matteFile(join(rawDir, selected[i]), join(outDir, `${String(i + 1).padStart(4, '0')}.png`));
  }
}

async function installBackground() {
  const rawDir = join(work, 'super-background-raw');
  const files = await extractAll(join(videos, background.video), rawDir);
  const selected = evenly(files, background.frames);
  const outDir = join(charDir, background.key);
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  for (let i = 0; i < selected.length; i += 1) {
    await copyFile(join(rawDir, selected[i]), join(outDir, `${String(i + 1).padStart(4, '0')}.png`));
  }
}

await mkdir(work, { recursive: true });
await copyFile(join(review, 'base-v2.png'), join(charDir, 'base.png'));
await copyFile(join(review, 'portrait-v2-32px.png'), join(charDir, 'portrait.png'));

await Promise.all(anims.map(installAnimation));
await installBackground();

const kfDir = join(charDir, 'kf');
await mkdir(kfDir, { recursive: true });
const keyframes = {
  'walk-start.png': 'walk-v1-a.png',
  'jump-end.png': 'jump-v1-a.png',
  'guard-end.png': 'guard-approved.png',
  'attack1-end.png': 'attack1-v1-a.png',
  'attack2-end.png': 'attack2-v4.png',
  'intro-end.png': 'intro-v1-a.png',
  'death-end.png': 'death-v3.png',
  'super-character-end.png': 'super-v1.png',
  'super-background.png': 'super-background-v1.png',
};
for (const [dest, src] of Object.entries(keyframes)) await copyFile(join(review, src), join(kfDir, dest));

const oldManifest = JSON.parse(await readFile(join(charDir, 'manifest.json'), 'utf8'));
const manifestAnims = Object.fromEntries(anims.map((anim) => [anim.key, {
  engineState: anim.engineState,
  dir: `assets/player/chenmian/${anim.key}`,
  frames: anim.frames,
  ...(anim.frameRate ? { frameRate: anim.frameRate } : {}),
  playback: anim.playback,
  matte: true,
}]));
const manifest = {
  ...oldManifest,
  base: 'assets/player/chenmian/base.png',
  portrait: 'assets/player/chenmian/portrait.png',
  anims: manifestAnims,
  superBackground: {
    dir: 'assets/player/chenmian/super-background',
    frames: background.frames,
    frameRate: background.frameRate,
    playback: background.playback,
    matte: false,
    fullscreen: true,
  },
};
await writeFile(join(charDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

for (const anim of anims) {
  const files = (await readdir(join(charDir, anim.key))).filter((f) => f.endsWith('.png')).sort();
  if (files.length !== anim.frames) throw new Error(`${anim.key}: expected ${anim.frames}, got ${files.length}`);
  const png = PNG.sync.read(await readFile(join(charDir, anim.key, files[0])));
  if (png.data[3] !== 0) throw new Error(`${anim.key}: top-left corner is not transparent`);
}
const bgFiles = (await readdir(join(charDir, background.key))).filter((f) => f.endsWith('.png'));
if (bgFiles.length !== background.frames) throw new Error(`background: expected ${background.frames}, got ${bgFiles.length}`);

await copyFile(
  join(root, 'public/assets/player/fighter-87633c7b/_review-v2/portrait-v2-32px-b.png'),
  join(root, 'public/assets/player/fighter-87633c7b/portrait.png'),
);

console.log('Installed Chen Mian V2 animations/background and Lao Luo 32px portrait.');
