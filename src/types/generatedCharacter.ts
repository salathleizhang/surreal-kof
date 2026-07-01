import type { AnimationDefinition, AnimationState, CombatDefinition } from './combat.ts';

export type PlaybackMode = 'loop' | 'forward' | 'yoyo' | 'hold';

export interface GeneratedAnimationManifest {
  dir: string;
  frames: number;
  playback: PlaybackMode;
  engineState?: AnimationState;
  frameRate?: number;
  fullscreen?: boolean;
}

export interface GeneratedMove {
  name?: string;
  damage?: number;
  [key: string]: unknown;
}

export interface GeneratedCharacterManifest {
  id: string;
  name?: string;
  cn?: string;
  anims: Record<string, GeneratedAnimationManifest>;
  moves?: Record<string, GeneratedMove>;
  combat?: CombatDefinition;
}

export interface GeneratedAnimationMeta extends AnimationDefinition {
  srcW?: number;
  srcH?: number;
}

export interface GeneratedCharacterEntry {
  id: string;
  name: string;
  cn: string;
  portrait: string;
  srcW: number;
  srcH: number;
  animMeta: Record<string, GeneratedAnimationMeta>;
  moves: Record<string, GeneratedMove>;
  combat: CombatDefinition;
}
