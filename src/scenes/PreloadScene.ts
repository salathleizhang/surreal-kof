import Phaser from 'phaser';
import { registerGifTextures } from '../utils/loadGif.ts';
import { GAME_WIDTH, GAME_HEIGHT, SCENE_KEYS } from '../config/game.ts';
import { PIXEL_FONT } from '../fonts.ts';
import { loadUiSounds } from '../audio.ts';
import { STAGES, STAGE_ORDER } from '../data/stages.ts';
import { loadGeneratedIndex } from '../services/generatedCharacters.ts';
import { loadDeferredScenes, registerDeferredScenes } from './sceneRegistry.ts';

const BAR_WIDTH = 420;
const BAR_HEIGHT = 18;

export default class PreloadScene extends Phaser.Scene {
  // Phaser scene state is populated across preload/create lifecycle hooks.
  [key: string]: any;
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

    const barX = (GAME_WIDTH - BAR_WIDTH) / 2;
    const barY = GAME_HEIGHT / 2 + 54;
    this.progressBg = this.add.graphics();
    this.progressBg.fillStyle(0x183050, 1);
    this.progressBg.fillRect(barX, barY, BAR_WIDTH, BAR_HEIGHT);
    this.progressBg.lineStyle(2, 0x7fffd4, 1);
    this.progressBg.strokeRect(barX, barY, BAR_WIDTH, BAR_HEIGHT);
    this.progressFill = this.add.graphics();
    this.progressText = this.add
      .text(GAME_WIDTH / 2, barY + 34, '0%', {
        fontFamily: PIXEL_FONT,
        fontSize: '16px',
        color: '#7fffd4',
      })
      .setOrigin(0.5);

    const handleCoreProgress = (value) => this.setProgress(value * 0.12);
    this.load.on('progress', handleCoreProgress);
    this.load.once('complete', () => this.load.off('progress', handleCoreProgress));

    // UI sounds go through Phaser's standard loader so they're decoded into the
    // global audio cache before any menu scene runs. (The GIF art is decoded
    // separately in create().)
    this.load.image('select-bg', 'assets/background/select-bg.webp');
    this.load.image('select-scene', 'assets/background/select-scene.webp');
    this.load.image('title-logo', 'assets/logo/kof-abstract-retro-01-transparent.webp');
    STAGE_ORDER.forEach((stageKey) => {
      const stage = STAGES[stageKey];
      this.load.image(stage.texture, stage.image);
    });
    loadUiSounds(this);
  }

  setProgress(value) {
    const progress = Math.max(this.progressValue || 0, Phaser.Math.Clamp(value, 0, 1));
    this.progressValue = progress;
    const barX = (GAME_WIDTH - BAR_WIDTH) / 2;
    const barY = GAME_HEIGHT / 2 + 54;
    this.progressFill.clear();
    this.progressFill.fillStyle(0x7fffd4, 1);
    this.progressFill.fillRect(barX + 3, barY + 3, (BAR_WIDTH - 6) * progress, BAR_HEIGHT - 6);
    this.progressText.setText(`${Math.round(progress * 100)}%`);
  }

  // Phaser ignores the returned promise, but we can still `await` inside and
  // only advance to the fight once every GIF has been decoded into textures.
  async create() {
    try {
      let startupCompleted = 0;
      const startupTotal = 10;
      let generatedCompleted = 0;
      let generatedTotal = 0;
      const tick = (amount = 1) => {
        startupCompleted += amount;
        this.setProgress(0.12 + (startupCompleted / startupTotal) * 0.23);
      };
      const addTotal = (amount) => {
        generatedTotal += amount;
        this.setProgress(0.35);
      };
      const tickGenerated = (amount = 1) => {
        generatedCompleted += amount;
        if (generatedTotal > 0) {
          this.setProgress(0.35 + (generatedCompleted / generatedTotal) * 0.65);
        }
      };

      // The legacy animated street remains the title-screen backdrop. Fight
      // stages themselves are the static images loaded in preload().
      const animationTasks = [registerGifTextures(this, 'bg', 'assets/background/0.gif').then((count) => {
        tick();
        return count;
      })];

      const generatedCharactersTask = loadGeneratedIndex(this, '', { addTotal, step: tickGenerated });

      const [animationFrameCounts, deferredScenes] = await Promise.all([
        Promise.all(animationTasks),
        loadDeferredScenes().then((scenes) => {
          tick(2);
          return scenes;
        }),
        generatedCharactersTask,
      ]);
      const [bgFrameCount] = animationFrameCounts;

      // The players need to know how many frames the background animation has
      // so it can cycle and detect when an animation finishes.
      this.registry.set('bgFrameCount', bgFrameCount);
      this.setProgress(1);

      registerDeferredScenes(this.scene, deferredScenes);
      // Development-only direct fight launch keeps combat iteration and browser
      // smoke tests fast without adding a production route or hidden menu.
      const params = new URLSearchParams(globalThis.location?.search || '');
      if (import.meta.env.DEV && params.get('dev') === 'fight') {
        this.scene.start(SCENE_KEYS.FIGHT, {
          mode: params.get('mode') || 'versus',
          selections: [params.get('p1') || undefined, params.get('p2') || undefined],
          scene: params.get('stage') || undefined,
        });
      } else if (import.meta.env.DEV && params.get('dev') === 'select') {
        this.scene.start(SCENE_KEYS.CHARACTER_SELECT, {
          mode: params.get('mode') || 'single',
        });
      } else {
        this.scene.start(SCENE_KEYS.TITLE);
      }
    } catch (err) {
      console.error(err);
      this.loadingText.setText('Failed to load assets.\nSee console for details.');
    }
  }
}
