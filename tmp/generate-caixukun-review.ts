import { execFileSync } from 'node:child_process';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { runStudio } from '../server/mule.ts';
import { matteFile } from '../server/matte.ts';
import {
  CHARACTER_BODY_PROPORTIONS,
  SPRITE_FRAMING_STANDARD,
  SPRITE_PIXEL_GRID_STANDARD,
} from '../server/character-pipeline.ts';

const root = process.cwd();
const charDir = join(root, 'public/assets/player/caixukun');
const review = join(charDir, '_review-v2');
const videos = join(review, 'videos');
const framesDir = join(review, 'frames');

type AnimSpec = {
  key: string;
  frames: number;
  frameRate: number;
  duration: number;
  playback: 'loop' | 'forward' | 'yoyo' | 'hold';
  prompt: string;
  start?: string;
  last?: string;
  matte: boolean;
  aspect?: string;
  resolution?: string;
};

const common = `${SPRITE_PIXEL_GRID_STANDARD}. ${SPRITE_FRAMING_STANDARD}. ${CHARACTER_BODY_PROPORTIONS}. Keep the exact same Cai Xukun fighter identity, same ash-gray hair, black turtleneck top, cream suspenders, gray plaid trousers and black leather shoes. Keep the camera locked, body scale unchanged, feet baseline consistent, no outfit change, no sneakers, no extra limbs, no duplicate body, no opponent, no projectile, no text.`;

const specs: Record<string, AnimSpec> = {
  jump: {
    key: 'jump',
    frames: 8,
    frameRate: 12,
    duration: 4,
    playback: 'forward',
    start: 'idle/0001.png',
    last: 'idle/0001.png',
    matte: true,
    prompt: `${common} Create an in-place fighting-game jump animation sprite, not a real high leap through the canvas. The game engine will move the character upward, so keep the character's overall body inside the same 3:4 frame with the camera locked and no large vertical travel. Show a quick jump cycle through pose changes only: slight crouch anticipation, knees lift into a compact airborne pose, then lands back into the exact same ready stance. Head and shoes must remain fully visible with generous headroom in every frame; never touch or cross the top edge. Fast and snappy, no hovering or pause.`,
  },
  guard: {
    key: 'guard',
    frames: 8,
    frameRate: 8,
    duration: 4,
    playback: 'hold',
    start: 'idle/0001.png',
    matte: true,
    prompt: `${common} Create a smooth continuous defensive guard transition for a fighting game. The character must start moving immediately from the first frame: frame-by-frame gradually bends the knees, lowers into a compact half-crouch, raises both forearms from idle into a strong guard protecting the head and upper body, then holds the final blocking pose. No idle pause at the beginning, no sudden snap cut, no teleporting pose change; every frame should visibly progress from standing to guard while body size and feet baseline stay stable.`,
  },
  hit: {
    key: 'hit',
    frames: 8,
    frameRate: 10,
    duration: 4,
    playback: 'forward',
    start: 'idle/0001.png',
    last: 'idle/0001.png',
    matte: true,
    prompt: `${common} The fighter reacts to one strong invisible hit to the upper torso, sharply recoils backward in pain, then regains balance and returns to the exact same ready idle stance. Do not show any impact beam, slash, projectile, attacker, weapon, or extra effect.`,
  },
  super: {
    key: 'super',
    frames: 16,
    frameRate: 16,
    duration: 8,
    playback: 'forward',
    start: 'idle/0001.png',
    matte: true,
    prompt: `${common} Create only the transparent character-layer animation for a signature basketball-themed fighting-game super move. Keep the camera locked and keep at least one foot anchored near the same floor baseline throughout; no large horizontal travel, no high jump, no flying off the ground, no sliding out of frame. The character performs an energetic idol dance-to-combat basketball move: stylish stance, dribbles or controls a basketball close to the body, winds up, then in the final third clearly releases/shoots the basketball from the hand so the ball separates from the hand and travels a short visible arc toward the upper-right side of the frame. The ball must visibly leave the hand, not stay attached. Character and basketball only on flat magenta background. No white energy burst, no impact beam, no lightning slash, no cinematic background, no text, no UI, no extra person. Body size and six-head proportions must remain stable.`,
  },
  'super-background': {
    key: 'super-background',
    frames: 25,
    frameRate: 10,
    duration: 8,
    matte: false,
    playback: 'forward',
    aspect: '16:9',
    resolution: '1080p',
    prompt: 'Retro 16-bit pixel-art cinematic fighting-game special-move background for Cai Xukun: concert stage + basketball court energy, neon spotlights, rhythmic speed lines, basketball arcs, shockwaves and dramatic stage lighting. Character-free background only, absolutely no person, no face, no body, no silhouette, no text, no logo, no UI, camera locked.',
  },
};

function extractAssetUrls(result: unknown): string[] {
  const urls = new Set<string>();
  const visit = (o: unknown) => {
    if (!o) return;
    if (typeof o === 'string') {
      if (/^https?:\/\//.test(o) && /\.(png|jpe?g|webp|mp4|mov|webm)(\?|$)/i.test(o)) urls.add(o);
      return;
    }
    if (Array.isArray(o)) { o.forEach(visit); return; }
    if (typeof o === 'object') Object.values(o as Record<string, unknown>).forEach(visit);
  };
  visit(result);
  return [...urls];
}

async function downloadTo(url: string, dest: string) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`download ${resp.status} for ${url}`);
  await writeFile(dest, Buffer.from(await resp.arrayBuffer()));
}

async function flattenToMagenta(src: string, dest: string) {
  const png = PNG.sync.read(await readFile(src));
  const out = new PNG({ width: png.width, height: png.height });
  for (let i = 0; i < png.data.length; i += 4) {
    const a = png.data[i + 3] / 255;
    out.data[i] = Math.round(png.data[i] * a + 255 * (1 - a));
    out.data[i + 1] = Math.round(png.data[i + 1] * a);
    out.data[i + 2] = Math.round(png.data[i + 2] * a + 255 * (1 - a));
    out.data[i + 3] = 255;
  }
  await writeFile(dest, PNG.sync.write(out));
}

function run(command: string, args: string[]) {
  execFileSync(command, args, { stdio: 'inherit' });
}

async function extractFrames(videoPath: string, outDir: string) {
  await mkdir(outDir, { recursive: true });
  run('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', videoPath, '-vsync', '0', join(outDir, '%04d.png')]);
  return (await readdir(outDir)).filter((f) => f.endsWith('.png')).sort();
}

function evenly(files: string[], count: number) {
  if (files.length <= count) return files;
  return Array.from({ length: count }, (_, i) => files[Math.round((i * (files.length - 1)) / (count - 1))]);
}

async function makePreview(frameDir: string, outPath: string, frameRate: number) {
  run('ffmpeg', [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-framerate', String(frameRate),
    '-i', join(frameDir, '%04d.png'),
    '-vf', 'format=yuv420p',
    outPath,
  ]);
}

async function main() {
  const key = process.argv[2] || 'jump';
  const version = process.argv[3] || 'v1';
  const spec = specs[key];
  if (!spec) throw new Error(`Unknown spec ${key}. Choose: ${Object.keys(specs).join(', ')}`);

  await mkdir(videos, { recursive: true });
  await mkdir(framesDir, { recursive: true });
  const work = join(review, 'work', `${spec.key}-${version}`);
  await mkdir(work, { recursive: true });

  const imagePath = spec.start ? join(work, 'start-magenta.png') : undefined;
  const lastFramePath = spec.last ? join(work, 'last-magenta.png') : undefined;
  if (spec.start) await flattenToMagenta(join(charDir, spec.start), imagePath!);
  if (spec.last) await flattenToMagenta(join(charDir, spec.last), lastFramePath!);

  const body: Record<string, unknown> = {
    prompt: spec.prompt,
    duration: spec.duration,
    resolution: spec.resolution || '480p',
    aspectRatio: spec.aspect || '3:4',
    generateAudio: false,
    seed: Math.floor(Math.random() * 4294967295),
    maxWait: 900,
  };
  if (imagePath) body.image = imagePath;
  if (lastFramePath) body.lastFrameImage = lastFramePath;

  const endpoint = imagePath
    ? 'bytedance/seedance-2.0/image-to-video'
    : 'bytedance/seedance-2.0/text-to-video';
  const out = await runStudio(endpoint, body);
  await writeFile(join(work, 'mulerun-result.json'), JSON.stringify(out.body.result || out.body, null, 2));
  if (!out.body.ok) throw new Error(`mulerun failed: ${out.body.stderr || out.body.error || out.body.stdout || 'unknown'}`);
  const urls = extractAssetUrls(out.body.result);
  const url = urls.find((u) => /\.(mp4|mov|webm)(\?|$)/i.test(u)) || urls[0];
  if (!url) throw new Error(`No video URL returned from MuleRun. Saved raw result to ${join(work, 'mulerun-result.json')}`);
  const videoPath = join(videos, `${spec.key}-${version}.mp4`);
  await downloadTo(url, videoPath);

  const rawDir = join(work, 'raw');
  const selectedDir = join(framesDir, `${spec.key}-${version}`);
  await mkdir(selectedDir, { recursive: true });
  const raw = await extractFrames(videoPath, rawDir);
  const chosen = evenly(raw, spec.frames);
  for (let i = 0; i < chosen.length; i += 1) {
    const src = join(rawDir, chosen[i]);
    const dest = join(selectedDir, `${String(i + 1).padStart(4, '0')}.png`);
    if (spec.matte) await matteFile(src, dest);
    else await writeFile(dest, await readFile(src));
  }
  const previewPath = join(videos, `${spec.key}-${version}-preview.mp4`);
  await makePreview(selectedDir, previewPath, spec.frameRate);
  if (!existsSync(previewPath)) throw new Error(`Preview not written: ${previewPath}`);
  console.log(JSON.stringify({ key: spec.key, videoPath, frames: selectedDir, previewPath }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
