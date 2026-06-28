// Custom-character generation pipeline.
//
// Given an uploaded photo + a name, this produces a fully playable KOF fighter:
//   research (LLM) -> base sprite (nano-banana) -> per-anim start/end keyframes
//   (nano-banana edit) -> per-anim video (seedance i2v) -> frame extraction
//   (ffmpeg) -> chroma-key matte -> manifest.json.
//
// It runs inside the local-api process as a long-lived async job; callers start
// a job and poll its status. Final assets land in public/assets/player/<id>/ so
// Vite serves them straight to the game.
import { spawn } from 'node:child_process';
import {
  mkdir, writeFile, readFile, readdir, rm, copyFile,
} from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { PNG } from 'pngjs';
import { runStudio } from './mule.mjs';
import { matteFile } from './matte.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, '..', 'public');
const PLAYER_DIR = join(PUBLIC_DIR, 'assets', 'player');

// The seven generated animations. `engineState` maps each onto the fighter FSM
// (0 idle, 1 walk, 4 attack, 6 death) or a named extra state (intro/attack2/
// super). `frames` is how many sprites we keep — longer actions keep more.
// `playback`: loop | forward | yoyo (out-and-back retract) | hold (freeze last).
// `matte: false` keeps the background (the super keeps its full-screen effect).
//
// `startKf` / `endKf` describe the keyframe plan, so we never waste a generation
// on a frame we already have:
//   'base' — reuse the base sprite as this frame (the pose is just idle)
//   'gen'  — generate this frame from the base + the pose prompt
//   'same' — reuse this anim's start frame (start == end, e.g. a seamless loop)
// So idle needs 0 new frames (base↔base), attack/intro/death need 1 (base→end),
// and walk/super need 1 (one pose used as both ends).
export const ANIMS = [
  {
    key: 'idle', engineState: 0, duration: 4, frames: 8, playback: 'loop', matte: true, startKf: 'base', endKf: 'base',
  },
  {
    key: 'walk', engineState: 1, duration: 4, frames: 8, playback: 'loop', matte: true, startKf: 'gen', endKf: 'same',
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
    key: 'super', engineState: 'super', duration: 6, frames: 14, playback: 'forward', matte: false, startKf: 'gen', endKf: 'same',
  },
];

const ASPECT = '3:4'; // tall full-body framing for both stills and video
const IMG_RES = '1K';
const VID_RES = '480p';

// Hard technical constraints appended to every still prompt; the per-state pose
// (above) is the only thing that varies. Magenta backdrop is what the matte keys.
const STYLE_BASE = 'retro 16-bit pixel-art fighting game sprite in King of Fighters style, '
  + 'single full-body character, side view facing right, full body fully inside frame with headroom and foot room, '
  + 'crisp clean pixels, no text, no UI, no health bar, sharp silhouette';
const MAGENTA_BG = 'flat solid pure magenta #FF00FF background, evenly lit, no shadows on the floor, '
  + 'the background is one uniform magenta color with nothing else';

// Fixed, character-agnostic prompts. We deliberately do NOT design specific
// moves: each prompt only names the STATE (idle / walk / attack / super / …) and
// lets the video model's inherent randomness "roll" the actual motion — every
// generation is a fresh gacha. The character's look comes entirely from the
// uploaded photo (carried through the base sprite), not from words.
function fixedProfile(name) {
  const anims = {
    idle: { startPose: 'relaxed ready fighting idle stance', endPose: 'relaxed ready fighting idle stance', motion: 'subtle idle breathing, standing ready in a fighting stance' },
    walk: { startPose: 'walking forward in a fighting game', endPose: 'walking forward in a fighting game', motion: 'walking forward in a steady seamless loop' },
    attack1: { startPose: 'ready fighting idle stance', endPose: 'an offensive attacking pose, striking toward the opponent', motion: 'performs a quick melee attack toward the opponent, then returns to stance' },
    attack2: { startPose: 'ready fighting idle stance', endPose: 'a strong powerful attacking pose, heavy strike toward the opponent', motion: 'performs a strong heavy melee attack toward the opponent, then recovers' },
    intro: { startPose: 'standing neutral', endPose: 'a confident dynamic entrance pose, taunting', motion: 'steps in and strikes a confident entrance pose' },
    death: { startPose: 'staggering, knocked off balance', endPose: 'knocked down, defeated, lying on the ground', motion: 'gets knocked back and collapses to the ground defeated' },
    super: { startPose: 'charging up a powerful special move, energy gathering', endPose: 'unleashing an explosive powerful special move with dramatic energy effects', motion: 'unleashes an explosive powerful special move with big dramatic energy effects' },
  };
  return {
    nameEn: name, nameCn: name, summary: '', anims, moves: {},
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
async function genImage({ from, prompt, dest }) {
  const endpoint = from
    ? 'google/nano-banana-pro/edit'
    : 'google/nano-banana-pro/generation';
  const body = {
    prompt, aspectRatio: ASPECT, resolution: IMG_RES, maxWait: 300,
  };
  if (from) body.images = [from];
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
  image, lastFrame, prompt, duration, dest,
}) {
  const body = {
    image,
    prompt,
    duration,
    resolution: VID_RES,
    aspectRatio: ASPECT,
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
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args]);
    let stderr = '';
    child.stderr.on('data', (c) => { stderr += c; });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(stderr.trim() || `ffmpeg exit ${code}`))));
  });
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
const CONCURRENCY = Math.max(1, Number(process.env.GEN_CONCURRENCY) || 3);

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
    const png = synthFrame(384, 512, anim.playback === 'loop' ? Math.sin(t * Math.PI) : t, hue);
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
//   keyframes  the start/end frames we actually need -> awaiting (review)
//   frames     videos + extract + matte + manifest   -> done
//
// Each stage runs async; the client polls getJob until status === 'awaiting',
// shows the result, then calls advance (approve) or regenerate (redo). Internal
// (_-prefixed) fields carry state between stages but are hidden from clients.

const NEXT_STAGE = { base: 'keyframes', keyframes: 'frames' };

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
    keyframes: null,
    manifest: null,
    error: null,
    startedAt: Date.now(),
    _photoPath: photoPath,
    _profile: null,
    _baseAbs: null,
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
    await writeFile(basePath, PNG.sync.write(synthFrame(384, 512, 0, 200)));
  } else {
    const basePrompt = `${STYLE_BASE}. Neutral idle fighting stance. Keep the same person/character as the reference photo — their face, hairstyle, outfit and colours. ${MAGENTA_BG}.`;
    await genImage({ from: job._photoPath, prompt: basePrompt, dest: basePath });
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

// Stage 2 — generate only the keyframes we don't already have (idle reuses the
// base for both ends; loops reuse one pose for both; attacks reuse the base as
// their first frame). `opts.target` redoes a single animation.
async function stageKeyframes(job, charDir, log, opts = {}) {
  const profile = job._profile || fixedProfile(job.name);
  const kfDir = join(charDir, 'kf');
  await mkdir(kfDir, { recursive: true });
  const baseAbs = job._baseAbs || join(charDir, 'base.png');
  job.keyframes = job.keyframes || {};
  job._kf = job._kf || {};
  job._hue = job._hue || (90 + Math.floor(Math.random() * 60));
  const v = Date.now();

  let done = 0;
  const total = ANIMS.length;
  const bump = () => { done += 1; job.progress = done / total; job.step = `首尾帧 ${done}/${total}…`; };

  // The animations are independent — fan them out (bounded concurrency).
  await mapPool(ANIMS, CONCURRENCY, async (anim) => {
    // Single-anim redo: keep the others exactly as they were.
    if (opts.target && opts.target !== anim.key && job._kf[anim.key]) { bump(); return; }

    const a = profile.anims[anim.key];
    const generates = anim.startKf === 'gen' || anim.endKf === 'gen';
    log(generates ? `生成「${anim.key}」首尾帧…` : `「${anim.key}」复用 base（无需生成）`);

    const bgRule = anim.matte
      ? MAGENTA_BG
      : 'dramatic dynamic energy-filled background with motion lines and effects';
    const mkPrompt = (pose) => `${STYLE_BASE}. ${pose}. Same exact character as the reference. ${bgRule}.`;

    // Each frame has a magenta original (the seedance input, *Abs) and a matted
    // preview (*PrevRel) shown to the user — except the super, which is keyed
    // false and reviewed on its own dramatic background.
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
      if (job.mock) await writeFile(firstAbs, PNG.sync.write(synthFrame(384, 512, 0, kfHue(job._hue, anim))));
      else await genImage({ from: baseAbs, prompt: mkPrompt(a.startPose), dest: firstAbs });
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
      if (job.mock) await writeFile(lastAbs, PNG.sync.write(synthFrame(384, 512, 1, kfHue(job._hue, anim))));
      else await genImage({ from: baseAbs, prompt: mkPrompt(a.endPose), dest: lastAbs });
      await makePreview(lastAbs, join(kfDir, `${anim.key}-end.preview.png`));
      lastPrevRel = `kf/${anim.key}-end.preview.png`;
    }

    job._kf[anim.key] = { firstAbs, lastAbs };
    job.keyframes[anim.key] = {
      label: anim.key,
      first: assetUrl(job.charId, firstPrevRel, v),
      last: assetUrl(job.charId, lastPrevRel, v),
      single: lastPrevRel === firstPrevRel, // start == end (no separate last frame)
      generated: generates, // false when the whole anim just reuses the base
    };
    bump();
  });

  job.status = 'awaiting';
  job.step = '首尾帧已生成，确认后生成视频';
}

// Stage 3 — for each anim: keyframes -> seedance video -> extract -> matte, then
// write the manifest and register the character. Terminal (status: done).
async function stageFrames(job, charDir, workDir, log) {
  const profile = job._profile || fixedProfile(job.name);
  const baseAbs = job._baseAbs || join(charDir, 'base.png');
  const manifestAnims = {};

  let done = 0;
  const total = ANIMS.length;
  const bump = () => { done += 1; job.progress = done / total; job.step = `视频与抽帧 ${done}/${total}…`; };

  // Each anim's video -> extract -> matte is independent; fan out the (slow)
  // seedance calls with bounded concurrency.
  await mapPool(ANIMS, CONCURRENCY, async (anim) => {
    const a = profile.anims[anim.key];
    const animWork = join(workDir, anim.key);
    await mkdir(animWork, { recursive: true });
    const outDir = join(charDir, anim.key);
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
        prompt: a.motion,
        duration: anim.duration,
        dest: videoPath,
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

    manifestAnims[anim.key] = {
      engineState: anim.engineState,
      dir: `assets/player/${job.charId}/${anim.key}`,
      frames: framePaths.length,
      playback: anim.playback,
      matte: anim.matte,
    };
    bump();
  });

  log('写入 manifest…');
  const manifest = {
    id: job.charId,
    name: (profile.nameEn || job.name).toUpperCase(),
    cn: profile.nameCn || job.name,
    summary: profile.summary || '',
    base: `assets/player/${job.charId}/base.png`,
    portrait: `assets/player/${job.charId}/idle/0001.png`,
    anims: manifestAnims,
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
