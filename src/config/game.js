export const GAME_WIDTH = 1280;
export const GAME_HEIGHT = 720;

export const SCENE_KEYS = Object.freeze({
  PRELOAD: 'preload',
  TITLE: 'title',
  CHARACTER_SELECT: 'select',
  STAGE_SELECT: 'scene-select',
  FIGHT: 'fight',
});

export function createGameConfig(Phaser, preloadScene) {
  return {
    type: Phaser.AUTO,
    width: GAME_WIDTH,
    height: GAME_HEIGHT,
    parent: 'game',
    backgroundColor: '#000000',
    pixelArt: true,
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    // Other scenes are loaded in parallel with the initial assets, keeping the
    // entry bundle small and making PreloadScene the single boot boundary.
    scene: [preloadScene],
  };
}
