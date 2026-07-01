import Phaser from 'phaser';
import { PIXEL_FONT_FAMILY } from '../fonts.ts';
import PreloadScene from '../scenes/PreloadScene.ts';
import { createGameConfig } from '../config/game.ts';

const GAME_KEY = Symbol.for('kof-ai.game');
const BOOT_KEY = Symbol.for('kof-ai.boot');

async function loadPixelFont() {
  if (!document.fonts?.load) return;
  try {
    await document.fonts.load(`10px ${PIXEL_FONT_FAMILY}`);
  } catch {
    // A font failure must not prevent the game from starting.
  }
}

export function bootGame() {
  if (globalThis[GAME_KEY]) return Promise.resolve(globalThis[GAME_KEY]);
  if (globalThis[BOOT_KEY]) return globalThis[BOOT_KEY];

  const bootPromise = loadPixelFont()
    .then(() => {
      const game = new Phaser.Game(createGameConfig(Phaser, PreloadScene));
      globalThis[GAME_KEY] = game;
      return game;
    })
    .catch((error) => {
      delete globalThis[BOOT_KEY];
      throw error;
    });

  globalThis[BOOT_KEY] = bootPromise;
  return bootPromise;
}
