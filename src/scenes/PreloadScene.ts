import Phaser from 'phaser';
import { registerGifTextures } from '../utils/loadGif.ts';
import { GAME_WIDTH, GAME_HEIGHT, SCENE_KEYS } from '../config/game.ts';
import { PIXEL_FONT } from '../fonts.ts';
import { loadUiSounds } from '../audio.ts';
import { STAGES, STAGE_ORDER } from '../data/stages.ts';
import { loadGeneratedIndex } from '../services/generatedCharacters.ts';
import { loadDeferredScenes, registerDeferredScenes } from './sceneRegistry.ts';

// Kyo has seven states, each backed by its own animated GIF:
// 0: idle, 1: forward, 2: backward, 3: jump, 4: attack, 5: be hit, 6: death
const KYO_STATE_COUNT = 7;

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
      // Development-only direct fight launch keeps combat iteration and browser
      // smoke tests fast without adding a production route or hidden menu.
      const params = new URLSearchParams(globalThis.location?.search || '');
      if (import.meta.env.DEV && params.get('dev') === 'fight') {
        this.scene.start(SCENE_KEYS.FIGHT, {
          mode: params.get('mode') || 'versus',
          selections: [params.get('p1') || 'kyo', params.get('p2') || 'kyo'],
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
