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
  start: 'assets/sounds/ui/start.mp3', //  leaving the title / FIGHT! (KOF '97 "Round 1, Ready Go!")
};

// Queue every UI sound on a scene's loader. Call once from a `preload()`; the
// decoded audio lives in the global cache, so any scene can play it afterwards.
export function loadUiSounds(scene) {
  for (const [key, url] of Object.entries(UI_SOUNDS)) {
    if (!scene.cache.audio.exists(key)) scene.load.audio(key, url);
  }
}

// Play a named UI sound. No-ops if the file is missing (e.g. user deleted a
// placeholder) and is safe to call before the audio system unlocks — Phaser
// silently waits for the first user gesture, then resumes.
export function playUi(scene, name, config) {
  if (scene.cache.audio.exists(name)) scene.sound.play(name, config);
}
