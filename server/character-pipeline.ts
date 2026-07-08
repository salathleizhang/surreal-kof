// Custom-character generation pipeline.
//
// Given an uploaded photo + a name, this produces a fully playable KOF fighter:
//   base sprite -> portrait + per-anim keyframes -> videos -> frame extraction
//   -> chroma-key matte -> manifest.json. The super is assembled from two
//   independently generated assets: a transparent fighter action and a
//   full-screen background animation that never receives the character image.
//
// It runs inside the local-api process as a long-lived async job; callers start
// a job and poll its status. Final assets land in public/assets/player/<id>/ so
// Vite serves them straight to the game.
import { spawn } from 'node:child_process';
import {
  mkdir, writeFile, readFile, readdir, rm, copyFile,
} from 'node:fs/promises';
import { existsSync } from 'node:fs';
import {
  basename, dirname, join,
} from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { PNG } from 'pngjs';
import { runStudio } from './mule.ts';
import { matteFile } from './matte.ts';
import { DEFAULT_DAMAGE } from '../src/config/combat.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, '..', 'public');
// Tests can isolate generated output in a temp directory without touching the
// real roster; production keeps writing to Vite's public asset tree.
const PLAYER_DIR = process.env.KOF_GENERATED_PLAYER_DIR || join(PUBLIC_DIR, 'assets', 'player');
const LAOLUO_IDLE_STYLE_REFERENCE_DIR = join(
  PUBLIC_DIR,
  'assets',
  'player',
  'fighter-87633c7b',
  'idle',
);

export const LAOLUO_IDLE_STYLE_REFERENCE = ['webp', 'png']
  .map((extension) => join(LAOLUO_IDLE_STYLE_REFERENCE_DIR, `0001.${extension}`))
  .find((file) => existsSync(file)) || join(LAOLUO_IDLE_STYLE_REFERENCE_DIR, '0001.png');

export const BASE_REFERENCE_ROLES = 'Reference image 1 defines the target character identity, face, hairstyle, body build, clothing and colors. '
  + 'Reference image 2 is the Lao Luo idle sprite and is a STYLE REFERENCE ONLY: match only its logical pixel density, uniform pixel-block size, '
  + 'outline thickness, limited palette, shading complexity, body proportions and camera distance. Do not copy reference image 2 identity, face, '
  + 'hair, clothing, body shape or pose.';

export function baseImageReferences(photoPath) {
  if (!photoPath) return [];
  return [photoPath, existsSync(LAOLUO_IDLE_STYLE_REFERENCE) ? LAOLUO_IDLE_STYLE_REFERENCE : null]
    .filter(Boolean);
}

// The ten generated fighter animations. `engineState` maps each onto the fighter FSM
// (0 idle, 1 walk, 3 jump, 4 attack, 5 hit, 6 death, 10 guard) or a named extra state
// (intro/attack2/super). `frames` is how many sprites we keep — longer actions keep more.
// `playback`: loop | forward | yoyo (out-and-back retract) | hold (freeze last).
//
// attack1 = a PUNCH (技能1 出拳), attack2 = a KICK (技能2 踢腿) — two distinct
// moves, not the same generic strike.
//
// The super action itself now follows the same 3:4 + magenta + matte pipeline as
// every other fighter animation. Its cinematic 16:9 background is described by
// SUPER_BACKGROUND below and is rendered as a separate layer in the client.
//
// `startKf` / `endKf` describe the keyframe plan, so we never waste a generation
// on a frame we already have:
//   'base' — reuse the base sprite as this frame (the pose is just idle)
//   'gen'  — generate this frame from the base + the pose prompt
//   'same' — reuse this anim's start frame (start == end, e.g. a seamless loop)
// So idle/jump/hit need 0 new frames (base↔base), guard/attack/intro/death need 1
// (base→end), and walk/super need 1 (one pose used as both ends).
export const ANIMS = [
  {
    key: 'idle', engineState: 0, duration: 4, frames: 8, playback: 'loop', matte: true, startKf: 'base', endKf: 'base',
  },
  {
    key: 'walk', engineState: 1, duration: 4, frames: 8, playback: 'loop', matte: true, startKf: 'gen', endKf: 'same',
  },
  {
    key: 'jump', engineState: 3, duration: 4, frames: 8, playback: 'forward', matte: true, startKf: 'base', endKf: 'base',
  },
  {
    // Guard must own a dedicated end still: base idle -> generated crouch-block.
    // `hold` then keeps that authored final pose on screen while defense is held.
    key: 'guard', engineState: 10, duration: 4, frames: 8, playback: 'hold', matte: true, startKf: 'base', endKf: 'gen',
  },
  {
    key: 'hit', engineState: 5, duration: 4, frames: 8, playback: 'forward', matte: true, startKf: 'base', endKf: 'base',
  },
  {
    key: 'attack1', engineState: 4, duration: 4, frames: 7, playback: 'yoyo', matte: true, startKf: 'base', endKf: 'gen',
  },
  {
    key: 'attack2', engineState: 'attack2', duration: 4, frames: 7, playback: 'yoyo', matte: true, startKf: 'base', endKf: 'gen',
  },
  {
    key: 'intro', engineState: 'intro', duration: 4, frames: 8, playback: 'forward', matte: true, startKf: 'base', endKf: 'gen',
  },
  {
    key: 'death', engineState: 6, duration: 5, frames: 10, playback: 'hold', matte: true, startKf: 'base', endKf: 'gen',
  },
  {
    key: 'super', engineState: 'super', duration: 8, frames: 25, frameRate: 10, playback: 'forward', matte: true, startKf: 'base', endKf: 'gen',
  },
];

// A second, character-free asset for the super. Its still is generated from
// text only, then animated and sampled exactly like the fighter videos, but the
// extracted frames keep their opaque background.
const SUPER_BACKGROUND = {
  key: 'superBackground', dir: 'super-background', duration: 8, frames: 25,
  frameRate: 10, playback: 'forward', matte: false, fullscreen: true,
  aspect: '16:9', imgRes: '2K', vidRes: '1080p', startKf: 'gen', endKf: 'same',
  characterReference: false,
};

const FRAME_ASSETS = [...ANIMS, SUPER_BACKGROUND];
const PORTRAIT_ASSET = { key: 'portrait' };
const REVIEW_ASSETS = [...FRAME_ASSETS, PORTRAIT_ASSET];

const ASPECT = '3:4'; // tall full-body framing for both stills and video
const IMG_RES = '1K';
const VID_RES = '480p';

// Treat the generated 1K/480p files as nearest-neighbour enlargements of one
// canonical logical sprite grid. This prevents the image/video models from
// drifting between ultra-chunky 16px art and much finer 32/64px detail tiers.
export const SPRITE_PIXEL_GRID_STANDARD = 'strict consistent native pixel density: author the fighter on one 96 x 128 logical-pixel sprite canvas, '
  + 'with the standing body approximately 112 logical pixels tall from head to toe; every visible block is one uniform square logical pixel, '
  + 'then enlarge only with nearest-neighbour scaling; never switch to a chunky 16px sprite, mixed-size pixel blocks, antialiasing, '
  + 'smooth vector edges, high-resolution pseudo-pixel art or painterly detail';
export const SPRITE_FRAMING_STANDARD = 'fixed 3:4 orthographic fighting-game camera: keep the fighter horizontally centered, '
  + 'top of the head near 6% of the canvas height and both feet on one shared baseline at 96% of the canvas height; '
  + 'keep camera distance, body scale, logical pixel size and floor baseline identical in every pose and frame';

// Hard technical constraints appended to every still prompt; the per-state pose
// (above) is the only thing that varies. Magenta backdrop is what the matte keys.
export const CHARACTER_BODY_PROPORTIONS = 'consistent six-heads-tall adult body proportions: when measured along the body, '
  + 'the head is approximately one sixth of the character total height, with a proportionally sized torso, arms and longer legs; '
  + 'preserve the character-specific build (slim, athletic or stocky) without changing this six-head ratio; '
  + 'never chibi, super-deformed, childlike, big-headed, four-heads-tall or squat cartoon proportions';
const STYLE_BASE = 'retro 16-bit pixel-art fighting game sprite in King of Fighters style, '
  + `${SPRITE_PIXEL_GRID_STANDARD}, ${SPRITE_FRAMING_STANDARD}, `
  + 'single full-body character shown head to toe, standing upright on both feet, '
  + `${CHARACTER_BODY_PROPORTIONS}, `
  + 'entire body visible from the top of the head down to the shoes, both feet and both legs fully in frame, '
  + 'normal natural human body proportions, full-length wide shot, side view facing right, '
  + 'whole body fully inside the frame with clear headroom above and floor room below the feet, '
  + 'NOT a portrait, NOT a bust, NOT a half-body crop, NOT a close-up — do not cut off the legs or feet, '
  + 'crisp clean pixels, no text, no UI, no health bar, sharp silhouette';
const MAGENTA_BG = 'flat solid pure magenta #FF00FF background, evenly lit, no shadows on the floor, '
  + 'the background is one uniform magenta color with nothing else';
const SUPER_BACKGROUND_STYLE = 'retro 16-bit pixel-art cinematic fighting-game special-move background, '
  + 'landscape composition filled edge-to-edge with dramatic energy, speed lines, shockwaves and layered light effects, '
  + 'environment and abstract visual effects only, absolutely no person, no fighter, no character, no face, no body, '
  + 'no silhouette, no text, no logo, no UI, no health bar';
const PORTRAIT_STYLE = 'retro 16-bit pixel-art King of Fighters character-select portrait, square head-and-shoulders close-up, '
  + 'same exact face, hairstyle, outfit colours and identity as the reference character, centered face, confident expression, '
  + 'crisp clean pixels, bold arcade lighting, simple dark arena backdrop, no text, no logo, no UI';

const MOVE_NAME_BANK = {
  attack1: ['疾风直拳', '裂空拳', '爆裂冲拳', '破军拳', '闪电拳'],
  attack2: ['旋风踢', '流星飞踢', '烈焰回旋踢', '影牙踢', '断空脚'],
  super: ['终极爆炎波', '天翔破极阵', '星陨裂空斩', '霸者轰天击', '无双极光炮'],
};

function randomMoveName(key) {
  const names = MOVE_NAME_BANK[key] || [key];
  return names[Math.floor(Math.random() * names.length)];
}

function buildMoves() {
  return {
    attack1: { name: randomMoveName('attack1'), damage: DEFAULT_DAMAGE.attack1 },
    attack2: { name: randomMoveName('attack2'), damage: DEFAULT_DAMAGE.attack2 },
    super: { name: randomMoveName('super'), damage: DEFAULT_DAMAGE.super },
  };
}

// Fixed, character-agnostic prompts. We deliberately do NOT design specific
// moves: each prompt only names the STATE (idle / walk / attack / super / …) and
// lets the video model's inherent randomness "roll" the actual motion — every
// generation is a fresh gacha. The character's look comes entirely from the
// uploaded photo (carried through the base sprite), not from words.
function fixedProfile(name) {
  const anims = {
    idle: { startPose: 'relaxed ready fighting idle stance', endPose: 'relaxed ready fighting idle stance', motion: 'subtle idle breathing, standing ready in a fighting stance' },
    walk: { startPose: 'walking forward in a fighting game', endPose: 'walking forward in a fighting game', motion: 'walking forward in a steady seamless loop' },
    jump: { startPose: 'relaxed ready fighting idle stance', endPose: 'relaxed ready fighting idle stance', motion: 'jumps vertically into the air in a quick athletic fighting-game jump, then lands back in the exact same ready idle stance; keep the whole body visible throughout' },
    guard: { startPose: 'relaxed ready fighting idle stance', endPose: 'DEDICATED GUARD END KEYFRAME, clearly different from idle: a low defensive crouch-block stance, knees deeply bent with both forearms raised firmly to shield the head and torso from an incoming attack; do not render a neutral standing pose', motion: 'quickly shifts from the standing ready stance into a compact crouching defensive guard, raises both forearms to block, and holds the exact generated final guard pose' },
    hit: { startPose: 'relaxed ready fighting idle stance', endPose: 'relaxed ready fighting idle stance', motion: 'reacts to one strong invisible hit to the upper torso, sharply recoils backward in pain, regains balance, and returns to the exact same ready idle stance; show only this character with no opponent, projectile, weapon or additional person' },
    // 技能1 = 出拳 (punch): an arm/fist strike.
    attack1: { startPose: 'ready fighting stance with both fists raised in front of the face', endPose: 'throwing a straight punch, one arm fully extended forward with the fist striking toward the opponent', motion: 'throws a single fast straight punch with the fist toward the opponent, then snaps the arm back to a guarding stance' },
    // 技能2 = 踢腿 (kick): a leg strike (clearly different from the punch).
    attack2: { startPose: 'ready fighting stance, weight balanced on the back leg', endPose: 'performing a powerful kick, one leg extended high and forward with the foot striking toward the opponent', motion: 'performs a single fast powerful kick, swinging one leg up and forward to strike the opponent with the foot, then plants the leg back down into stance' },
    intro: { startPose: 'standing neutral', endPose: 'a confident dynamic entrance pose, taunting', motion: 'steps in and strikes a confident entrance pose' },
    death: { startPose: 'staggering, knocked off balance', endPose: 'knocked down, defeated, lying on the ground', motion: 'gets knocked back and collapses to the ground defeated' },
    // The fighter and the cinematic background are intentionally independent.
    super: { startPose: 'ready to perform a devastating special move', endPose: 'unleashing a powerful signature special-move pose with arms and body fully visible', motion: 'charges and unleashes a devastating signature fighting-game special move with a strong full-body action' },
    superBackground: { startPose: 'a climactic arena overwhelmed by a violent energy vortex, explosive beams and expanding shockwaves', endPose: 'same cinematic energy vortex', motion: 'energy surges, beams sweep across the scene and shockwaves expand dramatically; keep the camera locked and never introduce any person or character' },
  };
  return {
    nameEn: name, nameCn: name, summary: '', anims, moves: buildMoves(),
  };
}

// Pull the output asset URLs out of a studio result, wherever they live.
function extractAssetUrls(result) {
  const urls = new Set();
  const visit = (o) => {
    if (!o) return;
    if (typeof o === 'string') {
      if (/^https?:\/\//.test(o) && /\.(png|jpe?g|webp|mp4|mov|webm)(\?|$)/i.test(o)) urls.add(o);
      return;
    }
    if (Array.isArray(o)) { o.forEach(visit); return; }
    if (typeof o === 'object') Object.values(o).forEach(visit);
  };
  visit(result);
  return [...urls];
}

async function downloadTo(url, dest) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`download ${resp.status} for ${url}`);
  const buf = Buffer.from(await resp.arrayBuffer());
  await writeFile(dest, buf);
  return dest;
}

// nano-banana: generate from scratch (no `from`) or edit an existing image (the
// base sprite) for character consistency.
async function genImage({
  from, prompt, dest, aspect = ASPECT, resolution = IMG_RES,
}) {
  const images = (Array.isArray(from) ? from : [from]).filter(Boolean);
  const endpoint = images.length
    ? 'google/nano-banana-pro/edit'
    : 'google/nano-banana-pro/generation';
  const body: Record<string, unknown> = {
    prompt, aspectRatio: aspect, resolution, maxWait: 300,
  };
  if (images.length) body.images = images;
  const out = await runStudio(endpoint, body);
  if (!out.body.ok) throw new Error(`image gen failed: ${out.body.stderr || out.body.error || 'unknown'}`);
  const urls = extractAssetUrls(out.body.result);
  if (!urls.length) throw new Error('image gen returned no image url');
  await downloadTo(urls[0], dest);
  return dest;
}

// seedance image-to-video with a first frame, optional last frame, and a motion
// prompt. Returns the downloaded mp4 path.
async function genVideo({
  image, lastFrame, prompt, duration, dest, aspect = ASPECT, resolution = VID_RES,
}) {
  const body: Record<string, unknown> = {
    image,
    prompt,
    duration,
    resolution,
    aspectRatio: aspect,
    generateAudio: false,
    // A fresh random seed each call so every (re)generation rolls a different
    // motion — the moves come from this "gacha", not from a scripted prompt.
    seed: Math.floor(Math.random() * 4294967295),
    maxWait: 900,
  };
  if (lastFrame) body.lastFrameImage = lastFrame;
  const out = await runStudio('bytedance/seedance-2.0/image-to-video', body);
  if (!out.body.ok) throw new Error(`video gen failed: ${out.body.stderr || out.body.error || 'unknown'}`);
  const urls = extractAssetUrls(out.body.result);
  if (!urls.length) throw new Error('video gen returned no video url');
  await downloadTo(urls[0], dest);
  return dest;
}

function runFfmpeg(args) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args]);
    let stderr = '';
    child.stderr.on('data', (c) => { stderr += c; });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(stderr.trim() || `ffmpeg exit ${code}`))));
  });
}

function runCommand(command, args) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args);
    let stderr = '';
    child.stderr?.on('data', (c) => { stderr += c; });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(stderr.trim() || `${command} exit ${code}`))));
  });
}

const WEBP_QUALITY = Math.max(1, Math.min(100, Number(process.env.KOF_WEBP_QUALITY) || 82));
const COMPRESS_RUNTIME_ASSETS = process.env.KOF_COMPRESS_RUNTIME_ASSETS !== '0';
let webpEncoderPromise = null;

async function findWebpEncoder() {
  if (!COMPRESS_RUNTIME_ASSETS) return null;
  if (!webpEncoderPromise) {
    webpEncoderPromise = (async () => {
      const candidates = [
        process.env.CWEBP_BIN,
        'cwebp',
        '/opt/homebrew/bin/cwebp',
        '/usr/local/bin/cwebp',
      ].filter(Boolean);
      for (const candidate of candidates) {
        try {
          await runCommand(candidate, ['-version']);
          return candidate;
        } catch {
          // Try the next common install location.
        }
      }
      return null;
    })();
  }
  return webpEncoderPromise;
}

function toWebpPath(filePath) {
  return filePath.replace(/\.png$/i, '.webp');
}

async function compressRuntimePng(filePath, log, label) {
  if (!filePath || !/\.png$/i.test(filePath) || !existsSync(filePath)) return filePath;
  const encoder = await findWebpEncoder();
  if (!encoder) {
    log(`未找到 cwebp，${label} 保留 PNG`);
    return filePath;
  }

  const webpPath = toWebpPath(filePath);
  try {
    await runCommand(encoder, ['-quiet', '-q', String(WEBP_QUALITY), filePath, '-o', webpPath]);
    await rm(filePath, { force: true });
    return webpPath;
  } catch (err) {
    await rm(webpPath, { force: true });
    log(`${label} WebP 压缩失败，保留 PNG：${err.message}`);
    return filePath;
  }
}

async function compressRuntimeFrameSet(framePaths, log, label) {
  if (!framePaths.length) return { paths: framePaths, extension: 'png' };
  const encoder = await findWebpEncoder();
  if (!encoder) {
    log(`未找到 cwebp，「${label}」帧保留 PNG`);
    return { paths: framePaths, extension: 'png' };
  }

  const converted = [];
  try {
    for (const framePath of framePaths) {
      const webpPath = toWebpPath(framePath);
      await runCommand(encoder, ['-quiet', '-q', String(WEBP_QUALITY), framePath, '-o', webpPath]);
      converted.push(webpPath);
    }
    await Promise.all(framePaths.map((framePath) => rm(framePath, { force: true })));
    return { paths: converted, extension: 'webp' };
  } catch (err) {
    await Promise.all(framePaths.map((framePath) => rm(toWebpPath(framePath), { force: true })));
    log(`「${label}」帧 WebP 压缩失败，保留 PNG：${err.message}`);
    return { paths: framePaths, extension: 'png' };
  }
}

async function extractFrames(videoPath, outDir) {
  await mkdir(outDir, { recursive: true });
  await runFfmpeg(['-i', videoPath, '-vsync', '0', join(outDir, '%04d.png')]);
  const files = (await readdir(outDir)).filter((f) => f.endsWith('.png')).sort();
  return files.map((f) => join(outDir, f));
}

function pickEvenly(items, count) {
  if (count >= items.length) return items.slice();
  if (count <= 1) return [items[0]];
  const out = [];
  for (let i = 0; i < count; i += 1) {
    out.push(items[Math.round((i * (items.length - 1)) / (count - 1))]);
  }
  return out;
}

// How many per-animation jobs (keyframe images, then videos) run at once. The
// animations are independent, so each stage fans them out — bounded so we don't
// hammer the MuleRun queue or saturate local ffmpeg/matte. Tune via env.
const CONCURRENCY = Math.max(1, Number(process.env.GEN_CONCURRENCY) || 7);

// Run `worker` over `items` with at most `limit` in flight at a time.
async function mapPool(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const run = async () => {
    while (next < items.length) {
      const idx = next;
      next += 1;
      results[idx] = await worker(items[idx], idx);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

// ---- mock mode: synthesise frames locally so the whole plumbing (job ->
// manifest -> client load -> playable) can be tested without spending money or
// minutes on real generation. Draws a moving silhouette on magenta.
function synthFrame(width, height, t, hue) {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      png.data[i] = 255; png.data[i + 1] = 0; png.data[i + 2] = 255; png.data[i + 3] = 255; // magenta bg
    }
  }
  // A bobbing/reaching rectangle "body" + "arm" that varies with t (0..1).
  const cx = Math.round(width * (0.5 + 0.04 * Math.sin(t * Math.PI * 2)));
  const bodyW = Math.round(width * 0.34);
  const bodyH = Math.round(height * 0.6);
  const bodyTop = height - bodyH - Math.round(height * 0.05);
  const armLen = Math.round(width * 0.18 * t);
  const draw = (x0, y0, x1, y1, r, g, b) => {
    for (let y = Math.max(0, y0); y < Math.min(height, y1); y += 1) {
      for (let x = Math.max(0, x0); x < Math.min(width, x1); x += 1) {
        const i = (y * width + x) * 4;
        png.data[i] = r; png.data[i + 1] = g; png.data[i + 2] = b; png.data[i + 3] = 255;
      }
    }
  };
  const [r, g, b] = hsv(hue, 0.7, 0.9);
  draw(cx - bodyW / 2, bodyTop, cx + bodyW / 2, bodyTop + bodyH, r, g, b); // body
  draw(cx + bodyW / 2, bodyTop + bodyH * 0.2, cx + bodyW / 2 + armLen, bodyTop + bodyH * 0.35, r, g, b); // arm
  draw(cx - bodyW * 0.3, bodyTop - height * 0.16, cx + bodyW * 0.3, bodyTop, 240, 200, 170); // head
  return png;
}

// Character-free cinematic mock used to prove that the background layer is a
// genuinely separate opaque asset even when the paid models are bypassed.
function synthBackdropFrame(width, height, t, hue) {
  const png = new PNG({ width, height });
  const [r, g, b] = hsv(hue, 0.78, 0.85);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const wave = (Math.sin((x / width) * Math.PI * 8 + t * Math.PI * 2) + 1) / 2;
      const glow = Math.max(0, 1 - Math.hypot(x - width / 2, y - height / 2) / (width * 0.55));
      png.data[i] = Math.min(255, Math.round(12 + r * glow + 70 * wave));
      png.data[i + 1] = Math.min(255, Math.round(8 + g * glow + 24 * wave));
      png.data[i + 2] = Math.min(255, Math.round(28 + b * glow + 90 * wave));
      png.data[i + 3] = 255;
    }
  }
  return png;
}

function synthPortraitFrame(hue) {
  const size = 128;
  const png = synthBackdropFrame(size, size, 0.3, hue);
  const [r, g, b] = hsv(hue, 0.65, 0.95);
  const draw = (x0, y0, x1, y1, color) => {
    for (let y = Math.max(0, y0); y < Math.min(size, y1); y += 1) {
      for (let x = Math.max(0, x0); x < Math.min(size, x1); x += 1) {
        const i = (y * size + x) * 4;
        [png.data[i], png.data[i + 1], png.data[i + 2], png.data[i + 3]] = [...color, 255];
      }
    }
  };
  draw(24, 82, 104, 128, [r, g, b]); // shoulders
  draw(39, 26, 89, 88, [238, 188, 150]); // face
  draw(34, 18, 94, 40, [35, 28, 42]); // hair
  draw(48, 51, 55, 57, [28, 20, 35]);
  draw(73, 51, 80, 57, [28, 20, 35]);
  return png;
}

function hsv(h, s, v) {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let rgb = [0, 0, 0];
  if (h < 60) rgb = [c, x, 0]; else if (h < 120) rgb = [x, c, 0];
  else if (h < 180) rgb = [0, c, x]; else if (h < 240) rgb = [0, x, c];
  else if (h < 300) rgb = [x, 0, c]; else rgb = [c, 0, x];
  return rgb.map((v2) => Math.round((v2 + m) * 255));
}

async function synthAnimFrames(anim, outDir, workDir, hue) {
  await mkdir(outDir, { recursive: true });
  await mkdir(workDir, { recursive: true });
  const paths = [];
  for (let i = 0; i < anim.frames; i += 1) {
    const t = anim.frames === 1 ? 1 : i / (anim.frames - 1);
    const png = anim.key === SUPER_BACKGROUND.key
      ? synthBackdropFrame(320, 180, t, hue)
      : synthFrame(96, 128, anim.playback === 'loop' ? Math.sin(t * Math.PI) : t, hue);
    const dest = join(outDir, `${String(i + 1).padStart(4, '0')}.png`);
    if (anim.matte) {
      // Matte the synthetic magenta frame just like the real pipeline, so a mock
      // character renders with proper transparency in the game.
      const raw = join(workDir, `${String(i + 1).padStart(4, '0')}.png`);
      await writeFile(raw, PNG.sync.write(png));
      await matteFile(raw, dest);
    } else {
      await writeFile(dest, PNG.sync.write(png));
    }
    paths.push(dest);
  }
  return paths;
}

// ---- job store ----
const jobs = new Map();

// Strip internal (underscore-prefixed) fields before handing a job to clients.
function publicJob(j) {
  if (!j) return null;
  const pub = {};
  for (const [k, v] of Object.entries(j)) if (!k.startsWith('_')) pub[k] = v;
  return pub;
}

export function getJob(id) { return publicJob(jobs.get(id)); }
export function listJobs() { return [...jobs.values()].map(publicJob); }

function slugify(name) {
  const base = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return (base || 'fighter').slice(0, 24);
}

// Vite-served path for a char asset, with a cache-busting version so the modal
// always shows the freshly (re)generated image instead of a stale cached one.
function assetUrl(charId, rel, v) {
  return `assets/player/${charId}/${rel}?v=${v}`;
}

// Mock body hue per anim, kept in a green→blue band away from the magenta key.
function kfHue(hueBase, anim) {
  return 90 + ((hueBase - 90 + ANIMS.indexOf(anim) * 20 + 120) % 120);
}

// --- Review-gated wizard: three stages the client drives one at a time ---
//
//   base       research + base sprite                -> awaiting (review)
//   keyframes  portrait + action/background anchors -> awaiting (review)
//   frames     videos + extract + matte + manifest   -> done
//
// Each stage runs async; the client polls getJob until status === 'awaiting',
// shows the result, then calls advance (approve) or regenerate (redo). Internal
// (_-prefixed) fields carry state between stages but are hidden from clients.

const NEXT_STAGE = { base: 'keyframes', keyframes: 'frames' };
const PREV_STAGE = { keyframes: 'base', frames: 'keyframes' };

export function startCharacterJob({ name, photoPath, mock = false }) {
  const id = randomUUID().slice(0, 8);
  const charId = `${slugify(name)}-${id}`;
  const job = {
    id,
    charId,
    name,
    mock,
    stage: 'base',
    status: 'running',
    step: 'queued',
    progress: 0,
    log: [],
    profile: null,
    base: null,
    portrait: null,
    keyframes: null,
    manifest: null,
    error: null,
    startedAt: Date.now(),
    _photoPath: photoPath,
    _profile: null,
    _baseAbs: null,
    _portraitAbs: null,
    _kf: {},
  };
  jobs.set(id, job);
  kickoff(job, 'base');
  return getJob(id);
}

// Approve the current stage and run the next one.
export function advanceJob(id) {
  const job = jobs.get(id);
  if (!job) return null;
  if (job.status === 'running') return getJob(id); // still working — ignore
  const next = NEXT_STAGE[job.stage];
  if (next) kickoff(job, next);
  return getJob(id);
}

// Step back to the previous stage to review/redo it. The earlier stage's assets
// are still on the job (base / keyframes are kept), so this just moves the stage
// pointer back and marks it awaiting again — no regeneration. Refused mid-run.
export function backJob(id) {
  const job = jobs.get(id);
  if (!job) return null;
  if (job.status === 'running') return getJob(id); // can't rewind mid-run
  const prev = PREV_STAGE[job.stage];
  if (!prev) return getJob(id); // already at the first generated stage
  job.stage = prev;
  job.status = 'awaiting';
  job.error = null;
  job.progress = 1;
  job.step = prev === 'base' ? 'base 图（已生成），可重做或确认' : '首尾帧（已生成），可重做或确认';
  return getJob(id);
}

// Redo the current stage. `target` optionally narrows a keyframes redo to one
// animation so disliking a single frame doesn't re-roll the whole set.
export function regenerateJob(id, target) {
  const job = jobs.get(id);
  if (!job) return null;
  if (job.status === 'running') return getJob(id);
  kickoff(job, job.stage, { target });
  return getJob(id);
}

function kickoff(job, stage, opts = {}) {
  job.stage = stage;
  job.status = 'running';
  job.error = null;
  job.progress = 0;
  job.step = '排队中…';
  runStage(job, stage, opts).catch((err) => {
    job.status = 'failed';
    job.error = err.message;
    job.log.push(`FATAL: ${err.message}`);
  });
}

async function runStage(job, stage, opts) {
  const log = (m) => { job.log.push(m); job.step = m; };
  const charDir = join(PLAYER_DIR, job.charId);
  const workDir = join(charDir, '_work');
  await mkdir(workDir, { recursive: true });
  if (stage === 'base') await stageBase(job, charDir, workDir, log);
  else if (stage === 'keyframes') await stageKeyframes(job, charDir, log, opts);
  else if (stage === 'frames') await stageFrames(job, charDir, workDir, log);
}

// Stage 1 — generate the base sprite from the uploaded photo. No LLM: the prompt
// is fixed and the character's look comes entirely from the reference photo.
async function stageBase(job, charDir, workDir, log) {
  if (!job._profile) {
    const profile = fixedProfile(job.name);
    await writeFile(join(workDir, 'profile.json'), JSON.stringify(profile, null, 2));
    job._profile = profile;
    job.profile = { nameEn: profile.nameEn, nameCn: profile.nameCn, summary: '' };
  }

  log('生成全身像素 base 图…');
  job.progress = 0.4;
  const basePath = join(charDir, 'base.png');
  if (job.mock) {
    await writeFile(basePath, PNG.sync.write(synthFrame(96, 128, 0, 200)));
  } else {
    const references = baseImageReferences(job._photoPath);
    const referenceRoles = references.length > 1 ? `${BASE_REFERENCE_ROLES} ` : '';
    const identityInstruction = references.length
      ? 'Keep the same person/character as reference image 1 — their face, hairstyle, outfit and colours — but render the COMPLETE full body from head to toe even if the identity reference is only a face shot, a portrait or a half-body crop: invent and draw the rest of the body, legs and feet so the whole standing figure is shown.'
      : 'Create one distinct original fighter and render the COMPLETE full body from head to toe.';
    const basePrompt = `${referenceRoles}${STYLE_BASE}. Neutral idle fighting stance. ${identityInstruction} ${MAGENTA_BG}.`;
    await genImage({ from: references, prompt: basePrompt, dest: basePath });
  }
  job._baseAbs = basePath;
  // The base stays on magenta (needed as the img2img anchor), but for review we
  // show a matted preview so the user judges the character, not the backdrop.
  const basePrev = join(charDir, 'base.preview.png');
  await matteFile(basePath, basePrev);
  job.base = assetUrl(job.charId, 'base.preview.png', Date.now());
  job.progress = 1;
  job.status = 'awaiting';
  job.step = 'base 图已生成，确认后继续';
}

// Stage 2 — generate the select-screen portrait plus only the keyframes we do
// not already have. The super background deliberately uses text-to-image: the
// uploaded character/base image is never included in that model request.
async function stageKeyframes(job, charDir, log, opts: { target?: string } = {}) {
  const profile = job._profile || fixedProfile(job.name);
  const kfDir = join(charDir, 'kf');
  await mkdir(kfDir, { recursive: true });
  const baseAbs = job._baseAbs || join(charDir, 'base.png');
  job.keyframes = job.keyframes || {};
  job._kf = job._kf || {};
  job._hue = job._hue || (90 + Math.floor(Math.random() * 60));
  const v = Date.now();

  let done = 0;
  const total = REVIEW_ASSETS.length;
  const bump = () => { done += 1; job.progress = done / total; job.step = `首尾帧 ${done}/${total}…`; };

  // Portrait, fighter actions and the background are independent — fan them
  // out while preserving single-card regeneration in the review UI.
  await mapPool(REVIEW_ASSETS, CONCURRENCY, async (anim) => {
    const existing = anim.key === PORTRAIT_ASSET.key ? job._portraitAbs : job._kf[anim.key];
    if (opts.target && opts.target !== anim.key && existing) { bump(); return; }

    if (anim.key === PORTRAIT_ASSET.key) {
      log('生成角色选择头像…');
      const portraitAbs = join(charDir, 'portrait.png');
      if (job.mock) {
        await writeFile(portraitAbs, PNG.sync.write(synthPortraitFrame(job._hue)));
      } else {
        await genImage({
          from: baseAbs,
          prompt: PORTRAIT_STYLE,
          dest: portraitAbs,
          aspect: '1:1',
          resolution: '1K',
        });
      }
      job._portraitAbs = portraitAbs;
      job.portrait = assetUrl(job.charId, 'portrait.png', v);
      job.keyframes.portrait = {
        label: '角色选择头像',
        first: job.portrait,
        last: job.portrait,
        single: true,
        generated: true,
        transparent: false,
      };
      bump();
      return;
    }

    const a = profile.anims[anim.key];
    const generates = anim.startKf === 'gen' || anim.endKf === 'gen';
    log(generates ? `生成「${anim.key}」首尾帧…` : `「${anim.key}」复用 base（无需生成）`);

    const usesCharacter = anim.characterReference !== false;
    const mkPrompt = (pose) => usesCharacter
      ? `${STYLE_BASE}. ${pose}. Same exact character as the reference. ${MAGENTA_BG}.`
      : `${SUPER_BACKGROUND_STYLE}. ${pose}.`;
    const makeMockFrame = (t) => (usesCharacter
      ? synthFrame(96, 128, t, kfHue(job._hue, anim))
      : synthBackdropFrame(320, 180, t, kfHue(job._hue, anim)));

    // Character anchors have a magenta original and a matted preview. The
    // independent background is opaque and copied directly for review.
    const makePreview = async (srcAbs, prevAbs) => {
      if (anim.matte) await matteFile(srcAbs, prevAbs);
      else await copyFile(srcAbs, prevAbs);
    };

    // First frame.
    let firstAbs; let firstPrevRel;
    if (anim.startKf === 'base') {
      firstAbs = baseAbs; firstPrevRel = 'base.preview.png';
    } else {
      firstAbs = join(kfDir, `${anim.key}-start.png`);
      if (job.mock) await writeFile(firstAbs, PNG.sync.write(makeMockFrame(0)));
      else await genImage({
        from: usesCharacter ? baseAbs : undefined,
        prompt: mkPrompt(a.startPose),
        dest: firstAbs,
        aspect: anim.aspect,
        resolution: anim.imgRes,
      });
      await makePreview(firstAbs, join(kfDir, `${anim.key}-start.preview.png`));
      firstPrevRel = `kf/${anim.key}-start.preview.png`;
    }

    // Last frame.
    let lastAbs; let lastPrevRel;
    if (anim.endKf === 'base') {
      lastAbs = baseAbs; lastPrevRel = 'base.preview.png';
    } else if (anim.endKf === 'same') {
      lastAbs = firstAbs; lastPrevRel = firstPrevRel;
    } else {
      lastAbs = join(kfDir, `${anim.key}-end.png`);
      if (job.mock) await writeFile(lastAbs, PNG.sync.write(makeMockFrame(1)));
      else await genImage({
        from: usesCharacter ? baseAbs : undefined,
        prompt: mkPrompt(a.endPose),
        dest: lastAbs,
        aspect: anim.aspect,
        resolution: anim.imgRes,
      });
      await makePreview(lastAbs, join(kfDir, `${anim.key}-end.preview.png`));
      lastPrevRel = `kf/${anim.key}-end.preview.png`;
    }

    job._kf[anim.key] = { firstAbs, lastAbs };
    job.keyframes[anim.key] = {
      label: (profile.moves && profile.moves[anim.key] && profile.moves[anim.key].name) || anim.key,
      first: assetUrl(job.charId, firstPrevRel, v),
      last: assetUrl(job.charId, lastPrevRel, v),
      single: lastPrevRel === firstPrevRel, // start == end (no separate last frame)
      generated: generates, // false when the whole anim just reuses the base
      transparent: !!anim.matte,
    };
    bump();
  });

  job.status = 'awaiting';
  job.step = '首尾帧已生成，确认后生成视频';
}

// Stage 3 — generate every fighter video plus the separate super background,
// then write the manifest and register the character. Terminal (status: done).
async function stageFrames(job, charDir, workDir, log) {
  const profile = job._profile || fixedProfile(job.name);
  const baseAbs = job._baseAbs || join(charDir, 'base.png');
  const manifestAnims = {};
  let manifestSuperBackground = null;

  let done = 0;
  const total = FRAME_ASSETS.length;
  const bump = () => { done += 1; job.progress = done / total; job.step = `视频与抽帧 ${done}/${total}…`; };

  // Each anim's video -> extract -> matte is independent; fan out the (slow)
  // seedance calls with bounded concurrency.
  await mapPool(FRAME_ASSETS, CONCURRENCY, async (anim) => {
    const a = profile.anims[anim.key];
    const animWork = join(workDir, anim.key);
    await mkdir(animWork, { recursive: true });
    const assetDir = anim.dir || anim.key;
    const outDir = join(charDir, assetDir);
    await rm(outDir, { recursive: true, force: true });
    await mkdir(outDir, { recursive: true });

    let framePaths;
    if (job.mock) {
      framePaths = await synthAnimFrames(anim, outDir, join(animWork, 'raw'), kfHue(job._hue || 120, anim));
    } else {
      const kf = job._kf[anim.key] || { firstAbs: baseAbs, lastAbs: baseAbs };
      log(`生成「${anim.key}」动画视频…`);
      const videoPath = join(animWork, 'video.mp4');
      await genVideo({
        image: kf.firstAbs,
        lastFrame: kf.lastAbs, // equals first frame for loops -> seamless loop
        prompt: anim.characterReference === false
          ? a.motion
          : `${SPRITE_PIXEL_GRID_STANDARD}. ${SPRITE_FRAMING_STANDARD}. ${CHARACTER_BODY_PROPORTIONS}. Keep the character body proportions unchanged in every frame. ${a.motion}`,
        duration: anim.duration,
        dest: videoPath,
        aspect: anim.aspect, // landscape for the full-screen super
        resolution: anim.vidRes, // larger res so the super can fill the screen
      });

      log(`抽帧并处理「${anim.key}」…`);
      const rawFrames = await extractFrames(videoPath, join(animWork, 'raw'));
      const chosen = pickEvenly(rawFrames, anim.frames);
      framePaths = [];
      for (let i = 0; i < chosen.length; i += 1) {
        const dest = join(outDir, `${String(i + 1).padStart(4, '0')}.png`);
        if (anim.matte) await matteFile(chosen[i], dest);
        else await copyFile(chosen[i], dest);
        framePaths.push(dest);
      }
    }

    const compressed = await compressRuntimeFrameSet(framePaths, log, anim.key);
    framePaths = compressed.paths;

    const manifestAnimation = {
      ...(anim.engineState !== undefined ? { engineState: anim.engineState } : {}),
      dir: `assets/player/${job.charId}/${assetDir}`,
      ...(compressed.extension !== 'png' ? { extension: compressed.extension } : {}),
      frames: framePaths.length,
      playback: anim.playback,
      matte: anim.matte,
      ...(anim.frameRate ? { frameRate: anim.frameRate } : {}),
      ...(anim.fullscreen ? { fullscreen: true } : {}),
    };
    if (anim.key === SUPER_BACKGROUND.key) manifestSuperBackground = manifestAnimation;
    else manifestAnims[anim.key] = manifestAnimation;
    bump();
  });

  log('压缩基础 runtime 素材…');
  const runtimeBaseAbs = await compressRuntimePng(baseAbs, log, 'base');
  const portraitAbs = job._portraitAbs || join(charDir, 'portrait.png');
  const runtimePortraitAbs = await compressRuntimePng(portraitAbs, log, 'portrait');

  log('写入 manifest…');
  const manifest = {
    id: job.charId,
    name: (profile.nameEn || job.name).toUpperCase(),
    cn: profile.nameCn || job.name,
    summary: profile.summary || '',
    base: `assets/player/${job.charId}/${basename(runtimeBaseAbs)}`,
    portrait: `assets/player/${job.charId}/${basename(runtimePortraitAbs)}`,
    anims: manifestAnims,
    superBackground: manifestSuperBackground,
    moves: profile.moves || {},
    createdAt: Date.now(),
  };
  await writeFile(join(charDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  await appendToIndex(manifest);

  job.manifest = manifest;
  job.manifestUrl = `assets/player/${job.charId}/manifest.json`;
  job.stage = 'done';
  job.status = 'done';
  job.progress = 1;
  job.step = '完成';
  log(`完成：${manifest.name}`);
}

async function appendToIndex(manifest) {
  const indexPath = join(PLAYER_DIR, 'generated-index.json');
  let index = [];
  if (existsSync(indexPath)) {
    try { index = JSON.parse(await readFile(indexPath, 'utf8')); } catch { index = []; }
  }
  index = index.filter((e) => e.id !== manifest.id);
  index.push({
    id: manifest.id,
    name: manifest.name,
    cn: manifest.cn,
    portrait: manifest.portrait,
    manifest: `assets/player/${manifest.id}/manifest.json`,
  });
  await writeFile(indexPath, JSON.stringify(index, null, 2));
}
