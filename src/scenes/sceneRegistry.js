import { SCENE_KEYS } from '../config/game.js';

const DEFERRED_SCENES = Object.freeze([
  [SCENE_KEYS.TITLE, () => import('./TitleScene.js')],
  [SCENE_KEYS.CHARACTER_SELECT, () => import('./SelectScene.js')],
  [SCENE_KEYS.STAGE_SELECT, () => import('./SceneSelectScene.js')],
  [SCENE_KEYS.FIGHT, () => import('./FightScene.js')],
]);

export async function loadDeferredScenes() {
  return Promise.all(DEFERRED_SCENES.map(async ([key, load]) => {
    const module = await load();
    return [key, module.default];
  }));
}

export function registerDeferredScenes(scenePlugin, scenes) {
  scenes.forEach(([key, SceneClass]) => {
    scenePlugin.add(key, SceneClass, false);
  });
}
