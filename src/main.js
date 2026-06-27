import Phaser from 'phaser';
import PreloadScene from './scenes/PreloadScene.js';
import TitleScene from './scenes/TitleScene.js';
import SelectScene from './scenes/SelectScene.js';
import FightScene from './scenes/FightScene.js';

// The original game was authored against a fixed 1280x720 stage.
export const GAME_WIDTH = 1280;
export const GAME_HEIGHT = 720;

const config = {
  type: Phaser.AUTO,
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  parent: 'game',
  backgroundColor: '#000000',
  pixelArt: true,
  // The game logic uses absolute coordinates, so letterbox-fit the stage into
  // whatever space the page gives us instead of reflowing it.
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [PreloadScene, TitleScene, SelectScene, FightScene],
};

// eslint-disable-next-line no-new
new Phaser.Game(config);
