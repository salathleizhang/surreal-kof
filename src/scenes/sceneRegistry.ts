import { SCENE_KEYS } from '../config/game.ts';
import type Phaser from 'phaser';

type SceneModule = { default: typeof Phaser.Scene };
type DeferredScene = readonly [string, () => Promise<SceneModule>];
type LoadedScene = [string, typeof Phaser.Scene];

const DEFERRED_SCENES: readonly DeferredScene[] = Object.freeze([
  [SCENE_KEYS.TITLE, () => import('./TitleScene.ts')],
  [SCENE_KEYS.CHARACTER_SELECT, () => import('./SelectScene.ts')],
  [SCENE_KEYS.STAGE_SELECT, () => import('./SceneSelectScene.ts')],
  [SCENE_KEYS.FIGHT, () => import('./FightScene.ts')],
]);

export async function loadDeferredScenes(): Promise<LoadedScene[]> {
  return Promise.all(DEFERRED_SCENES.map(async ([key, load]) => {
    const module = await load();
    return [key, module.default];
  }));
}

export function registerDeferredScenes(
  scenePlugin: Phaser.Scenes.ScenePlugin,
  scenes: LoadedScene[],
): void {
  scenes.forEach(([key, SceneClass]) => {
    scenePlugin.add(key, SceneClass, false);
  });
}
