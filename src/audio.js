// Centralised UI / system sound effects (cursor move, confirm, cancel, start).
//
// The bundled .wav files are simple placeholder beeps so the menus are audible
// out of the box. To use real King of Fighters system rips (or any UI pack),
// drop your files into `public/assets/sounds/ui/` keeping these same filenames
// and everything keeps working — no code change needed. See README for sources.
export const UI_SOUNDS = {
  cursor: 'assets/sounds/ui/cursor.wav', // moving the select cursor / switching fighter
  select: 'assets/sounds/ui/select.wav', // confirming a fighter
  cancel: 'assets/sounds/ui/cancel.wav', // un-confirming / going back
  start: 'assets/sounds/ui/start.wav', //  leaving the title / FIGHT!
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
