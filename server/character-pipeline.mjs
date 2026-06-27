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
import { runStudio, runChat } from './mule.mjs';
import { matteFile } from './matte.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, '..', 'public');
const PLAYER_DIR = join(PUBLIC_DIR, 'assets', 'player');

// The seven generated animations. `engineState` maps each onto the fighter FSM
// (0 idle, 1 walk, 4 attack, 6 death) or a named extra state (intro/attack2/
// super). `frames` is how many sprites we keep — longer actions keep more.
// `playback`: loop | forward | yoyo (out-and-back retract) | hold (freeze last).
// `matte: false` keeps the background (the super keeps its full-screen effect).
export const ANIMS = [
  {
    key: 'idle', engineState: 0, duration: 4, frames: 8, playback: 'loop', matte: true,
  },
  {
    key: 'walk', engineState: 1, duration: 4, frames: 8, playback: 'loop', matte: true,
  },
  {
    key: 'attack1', engineState: 4, duration: 4, frames: 7, playback: 'yoyo', matte: true,
  },
  {
    key: 'attack2', engineState: 'attack2', duration: 4, frames: 7, playback: 'yoyo', matte: true,
  },
  {
    key: 'intro', engineState: 'intro', duration: 4, frames: 8, playback: 'forward', matte: true,
  },
  {
    key: 'death', engineState: 6, duration: 5, frames: 10, playback: 'hold', matte: true,
  },
  {
    key: 'super', engineState: 'super', duration: 6, frames: 14, playback: 'forward', matte: false,
  },
];

const ASPECT = '3:4'; // tall full-body framing for both stills and video
const IMG_RES = '1K';
const VID_RES = '480p';

// Hard technical constraints appended to every still prompt so the LLM only has
// to supply the creative pose/flavour. Magenta backdrop is what the matte keys.
const STYLE_BASE = 'retro 16-bit pixel-art fighting game sprite in King of Fighters style, '
  + 'single full-body character, side view facing right, full body fully inside frame with headroom and foot room, '
  + 'crisp clean pixels, no text, no UI, no health bar, sharp silhouette';
const MAGENTA_BG = 'flat solid pure magenta #FF00FF background, evenly lit, no shadows on the floor, '
  + 'the background is one uniform magenta color with nothing else';

function fallbackProfile(name) {
  // Used when the LLM step is skipped/fails: generic but still playable.
  const poses = {
    idle: { startPose: 'relaxed fighting idle stance, fists up, slight breathing', endPose: 'relaxed fighting idle stance, fists up, weight shifted', motion: 'subtle idle breathing bob, fighting stance', flavor: '' },
    walk: { startPose: 'mid stride walking forward, left foot forward', endPose: 'mid stride walking forward, right foot forward', motion: 'walking forward in a loop, marching gait', flavor: '' },
    attack1: { startPose: 'idle fighting stance, fists up', endPose: 'fully extended straight punch forward, arm out', motion: 'throws a fast straight punch forward then retracts', flavor: '' },
    attack2: { startPose: 'idle fighting stance, fists up', endPose: 'high roundhouse kick fully extended', motion: 'spins into a roundhouse kick then recovers', flavor: '' },
    intro: { startPose: 'standing neutral, arms at sides', endPose: 'confident entrance victory pose, taunting the camera', motion: 'steps in and strikes a confident entrance pose', flavor: '' },
    death: { startPose: 'staggering backward, off balance', endPose: 'knocked out lying on the ground, defeated', motion: 'gets knocked back and collapses to the ground defeated', flavor: '' },
    super: { startPose: 'charging up a massive special move, energy gathering, dramatic glow', endPose: 'unleashing an explosive screen-filling special attack, huge energy blast', motion: 'unleashes an explosive screen-filling super special move with energy effects', flavor: 'over-the-top finishing move' },
  };
  const anims = {};
  for (const a of ANIMS) anims[a.key] = poses[a.key];
  return {
    nameEn: name, nameCn: name, summary: '', anims, moves: {},
  };
}

// Ask the language model to research the character (by name) and design the
// seven animations with memey, in-character, slightly absurd flavour.
async function researchProfile(name, log) {
  const schema = ANIMS.map((a) => `"${a.key}": {"startPose": "...", "endPose": "...", "motion": "...", "flavor": "..."}`).join(',\n    ');
  const prompt = `You are designing a King of Fighters style pixel fighter based on a real/known character named "${name}".
First, recall who "${name}" is (a celebrity, athlete, meme, fictional character, etc.) and their signature traits, catchphrases, iconic moves and memes.
Then design SEVEN animations. For each, write SHORT vivid English descriptions:
- "startPose": the body pose for the FIRST keyframe
- "endPose": the body pose for the LAST keyframe
- "motion": how the body moves from start to end (for a video model)
- "flavor": one witty, meme-aware, in-character, slightly absurd detail tying the move to this specific person (this is the fun part — make attack/super reference their real iconic moves/memes; e.g. a basketball player elbows / throws a basketball, an idol does a dance move).
Keep each field under 18 words. Do NOT mention background or art style (that is added later).

Reply with ONLY this JSON, no markdown, no commentary:
{
  "nameEn": "...",
  "nameCn": "...",
  "summary": "one sentence on who they are and their fighting gimmick",
  "anims": {
    ${schema}
  },
  "moves": {
    "attack1": {"archetype": "punch|kick|elbow|...", "damage": 10},
    "attack2": {"archetype": "...", "damage": 14},
    "super": {"archetype": "projectile|barrage|aoe|...", "damage": 30, "multiHit": true}
  }
}`;

  const res = await runChat({ prompt, effort: 'medium' });
  if (!res.ok || !res.content) {
    log(`LLM research failed (${res.error || res.stderr || 'no output'}); using fallback profile.`);
    return fallbackProfile(name);
  }
  const parsed = extractJson(res.content);
  if (!parsed || !parsed.anims) {
    log('LLM returned unparseable JSON; using fallback profile.');
    return fallbackProfile(name);
  }
  // Backfill any missing anim so the rest of the pipeline never crashes.
  const fb = fallbackProfile(name);
  parsed.anims = { ...fb.anims, ...parsed.anims };
  for (const a of ANIMS) parsed.anims[a.key] = { ...fb.anims[a.key], ...parsed.anims[a.key] };
  parsed.nameEn = parsed.nameEn || name;
  parsed.nameCn = parsed.nameCn || name;
  return parsed;
}

function extractJson(text) {
  // Tolerate code fences / stray prose around the JSON object.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(body.slice(start, end + 1)); } catch { return null; }
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

export function getJob(id) {
  const j = jobs.get(id);
  if (!j) return null;
  const { _frames, ...pub } = j;
  return pub;
}

export function listJobs() {
  return [...jobs.values()].map(({ _frames, ...pub }) => pub);
}

function slugify(name) {
  const base = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return (base || 'fighter').slice(0, 24);
}

// Start a generation job and return its id immediately. Progress is reported via
// getJob(id): { status, step, progress(0..1), log[], manifest, error }.
export function startCharacterJob({ name, photoPath, mock = false }) {
  const id = randomUUID().slice(0, 8);
  const charId = `${slugify(name)}-${id}`;
  const job = {
    id,
    charId,
    name,
    mock,
    status: 'running',
    step: 'queued',
    progress: 0,
    log: [],
    manifest: null,
    error: null,
    startedAt: Date.now(),
  };
  jobs.set(id, job);
  runJob(job, { photoPath }).catch((err) => {
    job.status = 'failed';
    job.error = err.message;
    job.log.push(`FATAL: ${err.message}`);
  });
  return getJob(id);
}

async function runJob(job, { photoPath }) {
  const log = (m) => { job.log.push(m); job.step = m; };
  const charDir = join(PLAYER_DIR, job.charId);
  const workDir = join(charDir, '_work');
  await mkdir(workDir, { recursive: true });

  // Total weighted steps for the progress bar: research + base + 7 anims.
  const totalUnits = 1 + 1 + ANIMS.length;
  let unit = 0;
  const advance = () => { unit += 1; job.progress = unit / totalUnits; };

  // 1) research / prompt design
  log('研究角色与设计动画提示词…');
  const profile = job.mock ? fallbackProfile(job.name) : await researchProfile(job.name, log);
  await writeFile(join(workDir, 'profile.json'), JSON.stringify(profile, null, 2));
  job.profile = { nameEn: profile.nameEn, nameCn: profile.nameCn, summary: profile.summary };
  advance();

  // 2) base sprite (consistency anchor for every keyframe)
  log('生成全身像素 base 图…');
  const basePath = join(charDir, 'base.png');
  if (job.mock) {
    await writeFile(basePath, PNG.sync.write(synthFrame(384, 512, 0.0, 200)));
  } else {
    const basePrompt = `${STYLE_BASE}. Neutral idle fighting stance. The character is ${profile.nameEn}: ${profile.summary || ''}. ${MAGENTA_BG}.`;
    await genImage({ from: photoPath, prompt: basePrompt, dest: basePath });
  }
  advance();

  // Keep mock body colours in a green→blue band, well away from the magenta key
  // so the chroma matte never eats the silhouette.
  const hueBase = 90 + Math.floor(Math.random() * 60);
  const manifestAnims = {};

  // 3) per-animation: keyframes -> video -> frames -> matte
  for (const anim of ANIMS) {
    const a = profile.anims[anim.key];
    log(`生成「${anim.key}」首尾帧…`);
    const animWork = join(workDir, anim.key);
    await mkdir(animWork, { recursive: true });
    const outDir = join(charDir, anim.key);
    await rm(outDir, { recursive: true, force: true });
    await mkdir(outDir, { recursive: true });

    let framePaths;
    if (job.mock) {
      framePaths = await synthAnimFrames(anim, outDir, join(animWork, 'raw'), 90 + ((hueBase - 90 + ANIMS.indexOf(anim) * 20) % 120));
    } else {
      const bgRule = anim.matte ? MAGENTA_BG : 'dramatic dynamic energy-filled background with motion lines and effects';
      const mkPrompt = (pose) => `${STYLE_BASE}. ${pose}. Same exact character as the reference. ${a.flavor || ''}. ${bgRule}.`;
      const startPath = await genImage({ from: basePath, prompt: mkPrompt(a.startPose), dest: join(animWork, 'start.png') });
      const endPath = await genImage({ from: basePath, prompt: mkPrompt(a.endPose), dest: join(animWork, 'end.png') });

      log(`生成「${anim.key}」动画视频…`);
      const videoPath = join(animWork, 'video.mp4');
      await genVideo({
        image: startPath, lastFrame: endPath, prompt: a.motion, duration: anim.duration, dest: videoPath,
      });

      log(`抽帧并处理「${anim.key}」…`);
      const rawDir = join(animWork, 'raw');
      const rawFrames = await extractFrames(videoPath, rawDir);
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
    advance();
  }

  // 4) manifest
  log('写入 manifest…');
  const portraitFrame = `assets/player/${job.charId}/idle/0001.png`;
  const manifest = {
    id: job.charId,
    name: (profile.nameEn || job.name).toUpperCase(),
    cn: profile.nameCn || job.name,
    summary: profile.summary || '',
    base: `assets/player/${job.charId}/base.png`,
    portrait: portraitFrame,
    anims: manifestAnims,
    moves: profile.moves || {},
    createdAt: Date.now(),
  };
  await writeFile(join(charDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  // Keep an index of all generated characters so the game can list them.
  await appendToIndex(manifest);

  job.manifest = manifest;
  job.manifestUrl = `assets/player/${job.charId}/manifest.json`;
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
