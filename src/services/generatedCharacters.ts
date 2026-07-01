// Runtime registry for AI-generated fighters.
//
// A generated character is produced by the local pipeline as a manifest + a set
// of transparent PNG frames under assets/player/<id>/. This module loads those
// frames into Phaser textures (keyed `<id>-<state>-<frame>`, matching how
// Player.render() looks them up) and records the per-state animation metadata so
// a GeneratedFighter can play it. Textures live in Phaser's global manager, so a
// character loaded once (e.g. on the select screen) is available in the fight.

import {
  getGeneratedCharacter,
  hasGeneratedCharacter,
  registerGeneratedCharacter,
} from '../state/generatedCharacters.ts';
import type {
  GeneratedAnimationMeta, GeneratedCharacterEntry, GeneratedCharacterManifest,
} from '../types/generatedCharacter.ts';
import type { AnimationState } from '../types/combat.ts';

// Which engine FSM state each generated animation drives.
const KEY_TO_STATE: Record<string, AnimationState> = {
  idle: 0, walk: 1, attack1: 4, attack2: 7, super: 8, intro: 9, death: 6,
};

// Game frames per sprite frame, by playback mode (≈60fps): looping idles are
// slow, attacks are snappy.
const FRAME_RATE: Record<string, number> = {
  loop: 6, yoyo: 3, forward: 4, hold: 5,
};

function pad4(n: number): string { return String(n).padStart(4, '0'); }

// Load a list of {key,url} images through the scene loader, resolving once all
// have finished (or rejecting on the first hard error).
function loadImages(scene: any, entries: Array<{ key: string; url: string }>): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const pending = entries.filter((entry) => !scene.textures.exists(entry.key));
    if (!pending.length) { resolve(); return; }

    const loader = scene.load;
    const cleanup = () => {
      loader.off('complete', handleComplete);
      loader.off('loaderror', handleError);
    };
    const handleComplete = () => {
      cleanup();
      resolve();
    };
    const handleError = (file: { key?: string; src?: string }) => {
      cleanup();
      reject(new Error(`Failed to load ${file.key || file.src}`));
    };

    pending.forEach((entry) => loader.image(entry.key, entry.url));
    loader.once('complete', handleComplete);
    loader.once('loaderror', handleError);
    loader.start();
  });
}

// Register `${id}-${toState}-${k}` as a copy of an already-loaded source frame,
// so engine states without their own art (backward, jump, hit) can reuse one.
function aliasFrames(
  scene: any,
  id: string,
  fromState: AnimationState,
  toState: AnimationState,
  count: number,
): void {
  for (let k = 0; k < count; k += 1) {
    const src = `${id}-${fromState}-${k}`;
    const dst = `${id}-${toState}-${k}`;
    if (!scene.textures.exists(src)) continue;
    if (scene.textures.exists(dst)) scene.textures.remove(dst);
    scene.textures.addImage(dst, scene.textures.get(src).getSourceImage());
  }
}

// Load a manifest's frames into textures and register the character. `base` is a
// URL prefix (default '') in case assets are served from a sub-path.
export async function loadGeneratedCharacter(
  scene: any,
  manifest: GeneratedCharacterManifest,
  base = '',
): Promise<GeneratedCharacterEntry | null> {
  const { id } = manifest;
  if (hasGeneratedCharacter(id)) return getGeneratedCharacter(id);

  // Build the full frame list across every animation.
  const entries: Array<{ key: string; url: string }> = [];
  const animMeta: Record<string, GeneratedAnimationMeta> = {};
  for (const [animKey, info] of Object.entries(manifest.anims)) {
    // Known locomotion/legacy actions retain their numeric texture states.
    // Additional future skills may use a custom engineState or their animation
    // key directly, allowing manifests to add moves without editing this table.
    const state: AnimationState = KEY_TO_STATE[animKey] ?? info.engineState ?? animKey;
    for (let i = 0; i < info.frames; i += 1) {
      entries.push({ key: `${id}-${state}-${i}`, url: `${base}${info.dir}/${pad4(i + 1)}.png` });
    }
    animMeta[state] = {
      frame_cnt: info.frames,
      // The super carries its own play rate so it lasts ~4s; others use the
      // per-playback default.
      frame_rate: info.frameRate || FRAME_RATE[info.playback] || 5,
      playback: info.playback,
      // The super is a cinematic full-screen move (landscape, not chroma-keyed),
      // drawn covering the stage rather than anchored to the hitbox.
      fullscreen: !!info.fullscreen,
    };
  }

  await loadImages(scene, entries);

  // Record each state's source frame size. Most anims share the idle (3:4) size,
  // but the super is landscape (16:9), so the fighter needs per-state dimensions
  // to scale it correctly (especially the full-screen super).
  for (const state of Object.keys(animMeta)) {
    const tex = scene.textures.exists(`${id}-${state}-0`)
      ? scene.textures.get(`${id}-${state}-0`).getSourceImage()
      : null;
    if (tex) { animMeta[state].srcW = tex.width; animMeta[state].srcH = tex.height; }
  }

  // Reuse art for engine states the pipeline doesn't generate:
  //   2 backward <- walk, 3 jump <- idle, 5 hit <- first death frame.
  const walk = animMeta[1];
  const idle = animMeta[0];
  const death = animMeta[6];
  if (walk) {
    aliasFrames(scene, id, 1, 2, walk.frame_cnt);
    animMeta[2] = { ...walk, playback: 'loop' };
  }
  if (idle) {
    aliasFrames(scene, id, 0, 3, idle.frame_cnt);
    animMeta[3] = { ...idle, playback: 'loop' };
  }
  if (death) {
    aliasFrames(scene, id, 6, 5, 1); // single recoil frame
    animMeta[5] = { frame_cnt: 1, frame_rate: 4, playback: 'forward' };
  }

  // Source dimensions (all frames share a size) for the fighter's scale/offset.
  const idleSrc = scene.textures.get(`${id}-0-0`).getSourceImage();
  const entry = {
    id,
    name: manifest.name || id.toUpperCase(),
    cn: manifest.cn || manifest.name || id,
    portrait: `${id}-0-0`,
    srcW: idleSrc.width,
    srcH: idleSrc.height,
    animMeta,
    moves: manifest.moves || {},
    combat: manifest.combat || {},
  };
  return registerGeneratedCharacter(entry);
}

// Fetch the generated-character index and load every previously-made fighter so
// they survive a page reload. Best-effort: missing index just yields [].
export async function loadGeneratedIndex(scene: any, base = ''): Promise<GeneratedCharacterEntry[]> {
  let index: Array<{ manifest: string }> = [];
  try {
    const resp = await fetch(`${base}assets/player/generated-index.json`, { cache: 'no-store' });
    if (resp.ok) index = await resp.json() as Array<{ manifest: string }>;
  } catch { index = []; }

  if (!Array.isArray(index) || !index.length) return [];

  // Manifest requests are independent network operations. Fetch them together,
  // then feed their image frames through Phaser's single loader in sequence.
  const manifests = await Promise.all(index.map(async (item): Promise<GeneratedCharacterManifest | null> => {
    try {
      const response = await fetch(`${base}${item.manifest}`, { cache: 'no-store' });
      return response.ok ? await response.json() as GeneratedCharacterManifest : null;
    } catch {
      return null;
    }
  }));

  const loaded: GeneratedCharacterEntry[] = [];
  for (const manifest of manifests) {
    if (!manifest) continue;
    try {
      const entry = await loadGeneratedCharacter(scene, manifest, base);
      if (entry) loaded.push(entry);
    } catch { /* skip a broken entry, keep the rest */ }
  }
  return loaded;
}
