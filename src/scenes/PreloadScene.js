import Phaser from 'phaser';
import { registerGifTextures } from '../utils/loadGif.js';
import { GAME_WIDTH, GAME_HEIGHT } from '../main.js';
import { PIXEL_FONT } from '../fonts.js';
import { loadUiSounds } from '../audio.js';

// Kyo has seven states, each backed by its own animated GIF:
// 0: idle, 1: forward, 2: backward, 3: jump, 4: attack, 5: be hit, 6: death
const KYO_STATE_COUNT = 7;

export default class PreloadScene extends Phaser.Scene {
  constructor() {
    super('preload');
  }

  preload() {
    this.loadingText = this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT / 2, 'Loading...', {
        fontFamily: PIXEL_FONT,
        fontSize: '32px',
        color: '#ffffff',
      })
      .setOrigin(0.5);

    // UI sounds go through Phaser's standard loader so they're decoded into the
    // global audio cache before any menu scene runs. (The GIF art is decoded
    // separately in create().)
    loadUiSounds(this);
  }

  // Phaser ignores the returned promise, but we can still `await` inside and
  // only advance to the fight once every GIF has been decoded into textures.
  async create() {
    try {
      const tasks = [registerGifTextures(this, 'bg', 'assets/background/0.gif')];

      for (let i = 0; i < KYO_STATE_COUNT; i += 1) {
        tasks.push(registerGifTextures(this, `kyo-${i}`, `assets/player/kyo/${i}.gif`));
      }

      const [, ...kyoFrameCounts] = await Promise.all(tasks);

      // The players need to know how many frames each state animation has so
      // they can cycle and detect when an animation finishes.
      this.registry.set('kyoFrameCounts', kyoFrameCounts);

      this.scene.start('title');
    } catch (err) {
      console.error(err);
      this.loadingText.setText('Failed to load assets.\nSee console for details.');
    }
  }
}
