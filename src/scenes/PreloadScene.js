import Phaser from 'phaser';
import { registerGifTextures } from '../utils/loadGif.js';
import { GAME_WIDTH, GAME_HEIGHT, SCENE_KEYS } from '../config/game.js';
import { PIXEL_FONT } from '../fonts.js';
import { loadUiSounds } from '../audio.js';
import { STAGES, STAGE_ORDER } from '../data/stages.js';
import { loadGeneratedIndex } from '../services/generatedCharacters.js';
import { loadDeferredScenes, registerDeferredScenes } from './sceneRegistry.js';

// Kyo has seven states, each backed by its own animated GIF:
// 0: idle, 1: forward, 2: backward, 3: jump, 4: attack, 5: be hit, 6: death
const KYO_STATE_COUNT = 7;

export default class PreloadScene extends Phaser.Scene {
  constructor() {
    super(SCENE_KEYS.PRELOAD);
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
    this.load.image('select-bg', 'assets/background/select-bg.png');
    this.load.image('select-scene', 'assets/background/select-scene.png');
    this.load.image('title-logo', 'assets/logo/kof-abstract-retro-01-transparent.png');
    STAGE_ORDER.forEach((stageKey) => {
      const stage = STAGES[stageKey];
      this.load.image(stage.texture, stage.image);
    });
    loadUiSounds(this);
  }

  // Phaser ignores the returned promise, but we can still `await` inside and
  // only advance to the fight once every GIF has been decoded into textures.
  async create() {
    try {
      // The legacy animated street remains the title-screen backdrop. Fight
      // stages themselves are the static images loaded in preload().
      const animationTasks = [registerGifTextures(this, 'bg', 'assets/background/0.gif')];

      for (let i = 0; i < KYO_STATE_COUNT; i += 1) {
        animationTasks.push(registerGifTextures(this, `kyo-${i}`, `assets/player/kyo/${i}.gif`));
      }

      const generatedCharactersTask = loadGeneratedIndex(this).catch((error) => {
        console.warn('Could not load generated characters', error);
        return [];
      });

      const [animationFrameCounts, deferredScenes] = await Promise.all([
        Promise.all(animationTasks),
        loadDeferredScenes(),
        generatedCharactersTask,
      ]);
      const [bgFrameCount, ...kyoFrameCounts] = animationFrameCounts;

      // The players need to know how many frames each state animation has so
      // they can cycle and detect when an animation finishes.
      this.registry.set('bgFrameCount', bgFrameCount);
      this.registry.set('kyoFrameCounts', kyoFrameCounts);

      registerDeferredScenes(this.scene, deferredScenes);
      this.scene.start(SCENE_KEYS.TITLE);
    } catch (err) {
      console.error(err);
      this.loadingText.setText('Failed to load assets.\nSee console for details.');
    }
  }
}
