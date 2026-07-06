import type Phaser from 'phaser';

// Centralised UI / system sound effects (cursor move, confirm, cancel, start).
//
// cursor/select/start are real King of Fighters '97/'98 menu rips; cancel is a
// synthesised placeholder (no clean KOF cancel rip was freely available). To
// swap any of these, drop a file into `public/assets/sounds/ui/` and point its
// entry below at it — no other code change needed. See README for sources.
export const UI_SOUNDS = {
  cursor: 'assets/sounds/ui/cursor.mp3', // moving the cursor / switching fighter (KOF '97 rip)
  select: 'assets/sounds/ui/select.mp3', // confirming a fighter (KOF '98 rip)
  cancel: 'assets/sounds/ui/cancel.wav', // un-confirming / going back (synth placeholder)
  start: 'assets/sounds/ui/start.mp3', //  fight opener (KOF '97 "Round 1, Ready Go!")
  ko: 'assets/sounds/ui/ko.mp3', //         knockout (KOF 2003 "K.O.!")
  winner: 'assets/sounds/ui/winner.m4a', // victor announced (KOF '97 "Winner!")
  gameover: 'assets/sounds/ui/gameover.m4a', // player lost / draw (KOF '97 "Game Over")
};

// Looping menu music (KOF '97 "ORDER" player-select theme). Plays across the
// title + select screens and is stopped when the fight begins.
export const MENU_BGM_KEY = 'menu-bgm';
const MENU_BGM_URL = 'assets/music/menu.m4a';

// Impact SFX (KOF '97 hit slices in `assets/sfx/hit/`). A random one fires on
// each connecting hit, so repeated blows don't sound identical.
export const HIT_SOUND_KEYS = Array.from(
  { length: 15 },
  (_, i) => `hit-${String(i + 1).padStart(2, '0')}`,
);

// Queue every UI sound + the menu BGM on a scene's loader. Call once from a
// `preload()`; decoded audio lives in the global cache for any scene to use.
export function loadUiSounds(scene: any): void {
  for (const [key, url] of Object.entries(UI_SOUNDS)) {
    if (!scene.cache.audio.exists(key)) scene.load.audio(key, url);
  }
  if (!scene.cache.audio.exists(MENU_BGM_KEY)) scene.load.audio(MENU_BGM_KEY, MENU_BGM_URL);
  for (const key of HIT_SOUND_KEYS) {
    if (!scene.cache.audio.exists(key)) scene.load.audio(key, `assets/sfx/hit/${key}.m4a`);
  }
  loadVoiceGroup(scene, KYO_VOICE.attack);
  loadVoiceGroup(scene, KYO_VOICE.hurt);
  loadVoiceGroup(scene, KYO_VOICE.death);
  loadSfxGroup(scene, SWING_KEYS, 'swing');
  loadSfxGroup(scene, EXPLOSION_KEYS, 'explosion');
}

// Play a random impact sound. No-op if none decoded yet.
export function playHit(scene: any, config?: Phaser.Types.Sound.SoundConfig): void {
  const key = HIT_SOUND_KEYS[Math.floor(Math.random() * HIT_SOUND_KEYS.length)];
  if (scene.cache.audio.exists(key)) scene.sound.play(key, config);
}

// Shared battle voice for every fighter (built-in or generated), sourced from a
// KOF XI voice rip — the "kyo-" prefix on the files/keys just reflects where
// the clips came from, not which character plays them. One random clip plays
// per event: a grunt on attacking, a yelp on getting hit, a cry on the killing
// blow.
const KYO_VOICE_DIR = 'assets/sfx/voice/kyo';
export const KYO_VOICE = {
  attack: Array.from({ length: 6 }, (_, i) => `kyo-attack-${String(i + 1).padStart(2, '0')}`),
  hurt: Array.from({ length: 5 }, (_, i) => `kyo-hurt-${String(i + 1).padStart(2, '0')}`),
  death: Array.from({ length: 2 }, (_, i) => `kyo-death-${String(i + 1).padStart(2, '0')}`),
};

// Shared move SFX (also from the same rip): the air "whoosh" of a swing, and
// an explosion, used by every fighter's moves. Keyed by `<group>-NN`, files in
// their own dirs.
export const SWING_KEYS = Array.from({ length: 3 }, (_, i) => `swing-${String(i + 1).padStart(2, '0')}`);
export const EXPLOSION_KEYS = Array.from({ length: 3 }, (_, i) => `explosion-${String(i + 1).padStart(2, '0')}`);

function loadVoiceGroup(scene: any, keys: string[]): void {
  for (const key of keys) {
    if (!scene.cache.audio.exists(key)) {
      scene.load.audio(key, `${KYO_VOICE_DIR}/${key.replace('kyo-', '')}.m4a`);
    }
  }
}

function loadSfxGroup(scene: any, keys: string[], dir: string): void {
  for (const key of keys) {
    if (!scene.cache.audio.exists(key)) scene.load.audio(key, `assets/sfx/${dir}/${key}.m4a`);
  }
}

function playFrom(scene: any, keys: string[], config?: Phaser.Types.Sound.SoundConfig): void {
  if (!keys.length) return;
  const key = keys[Math.floor(Math.random() * keys.length)];
  if (scene.cache.audio.exists(key)) scene.sound.play(key, config);
}

export const playAttackVoice = (scene: any, config?: Phaser.Types.Sound.SoundConfig) => playFrom(scene, KYO_VOICE.attack, config);
export const playHurtVoice = (scene: any, config?: Phaser.Types.Sound.SoundConfig) => playFrom(scene, KYO_VOICE.hurt, config);
export const playDeathVoice = (scene: any, config?: Phaser.Types.Sound.SoundConfig) => playFrom(scene, KYO_VOICE.death, config);
export const playSwing = (scene: any, config?: Phaser.Types.Sound.SoundConfig) => playFrom(scene, SWING_KEYS, config);
export const playExplosion = (scene: any, config?: Phaser.Types.Sound.SoundConfig) => playFrom(scene, EXPLOSION_KEYS, config);

// Play a named UI sound. No-ops if the file is missing (e.g. user deleted a
// placeholder) and is safe to call before the audio system unlocks — Phaser
// silently waits for the first user gesture, then resumes.
export function playUi(scene: any, name: string, config?: Phaser.Types.Sound.SoundConfig): void {
  if (scene.cache.audio.exists(name)) scene.sound.play(name, config);
}

// The single shared BGM instance. Phaser's sound manager is game-global, so one
// looping sound survives scene changes; we just track it here.
let bgm: Phaser.Sound.BaseSound | null = null;

// Start the looping menu music if it isn't already going. Idempotent, so the
// title and select scenes can both call it without restarting the track.
// Browsers won't play audio until a user gesture, so if the manager is still
// locked we defer playback to the first interaction.
export function startMenuBgm(scene: any): void {
  if (bgm || !scene.cache.audio.exists(MENU_BGM_KEY)) return;
  bgm = scene.sound.add(MENU_BGM_KEY, { loop: true, volume: 0.45 });
  if (scene.sound.locked) {
    scene.sound.once('unlocked', () => { if (bgm) bgm.play(); });
  } else {
    bgm.play();
  }
}

// Stop and dispose the menu music (called when the fight scene opens).
export function stopMenuBgm(): void {
  if (!bgm) return;
  bgm.stop();
  bgm.destroy();
  bgm = null;
}
