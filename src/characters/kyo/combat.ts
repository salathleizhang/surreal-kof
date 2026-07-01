import { CHARACTER_SCALE, STATUS } from '../../config/combat.ts';
import type { CombatDefinition } from '../../types/combat.ts';

const S = CHARACTER_SCALE;
const BODY_WIDTH = 120 * S;
const BODY_HEIGHT = 200 * S;

export const KYO_COMBAT = Object.freeze<CombatDefinition>({
  stats: {
    maxHp: 100,
    moveSpeed: 400,
    jumpSpeed: -1000,
    gravity: 50,
  },
  body: {
    width: BODY_WIDTH,
    height: BODY_HEIGHT,
    pushbox: { x: 0, y: 0, width: BODY_WIDTH, height: BODY_HEIGHT },
    hurtboxes: [{ x: 0, y: 0, width: BODY_WIDTH, height: BODY_HEIGHT }],
  },
  skills: {
    attack1: {
      id: 'attack1',
      input: 'attack',
      priority: 10,
      animation: STATUS.ATTACK,
      stopOnStart: true,
      trail: true,
      ai: { range: 100 * S },
      startEffects: ['attack-voice'],
      events: [{
        id: 'attack1-hit',
        frame: 18,
        type: 'hitbox',
        box: { x: BODY_WIDTH, y: 40 * S, width: 100 * S, height: 20 * S },
        hit: { damage: 20, hitstop: 4, effect: 'hit-spark' },
        onWhiff: 'swing',
      }],
    },
  },
});
