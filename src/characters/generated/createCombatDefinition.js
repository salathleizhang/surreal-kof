import { CHARACTER_SCALE, STATUS } from '../../config/combat.js';

const S = CHARACTER_SCALE;
const BODY_WIDTH = 120 * S;
const BODY_HEIGHT = 200 * S;

function mergeSkill(base, override = {}) {
  return {
    ...base,
    ...override,
    ai: { ...(base.ai || {}), ...(override.ai || {}) },
    events: override.events || base.events,
    startEffects: override.startEffects || base.startEffects,
  };
}

// Existing generated manifests only contain animation and damage metadata. This
// adapter gives them backwards-compatible skills while allowing future manifests
// to override body/stats/skills under a `combat` property.
export function createGeneratedCombatDefinition(entry = {}) {
  const moves = entry.moves || {};
  const custom = entry.combat || {};
  const bodyWidth = custom.body?.width ?? BODY_WIDTH;
  const bodyHeight = custom.body?.height ?? BODY_HEIGHT;
  const defaults = {
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
        box: { x: bodyWidth, y: 40 * S, width: 100 * S, height: 20 * S },
        hit: { damage: moves.attack1?.damage || 20, hitstop: 4 },
        onWhiff: 'swing',
      }],
    },
    attack2: {
      id: 'attack2',
      input: 'attack2',
      priority: 20,
      animation: STATUS.ATTACK2,
      stopOnStart: true,
      ai: { range: 130 * S },
      startEffects: ['attack-voice'],
      events: [{
        id: 'attack2-hit',
        frame: 'apex',
        type: 'hitbox',
        box: { x: bodyWidth, y: 20 * S, width: 130 * S, height: 70 * S },
        hit: { damage: moves.attack2?.damage || 24, hitstop: 4 },
        onWhiff: 'swing',
      }],
    },
    super: {
      id: 'super',
      input: 'special',
      priority: 30,
      animation: STATUS.SUPER,
      name: moves.super?.name,
      stopOnStart: true,
      startEffects: ['move-name', 'attack-voice'],
      events: [{
        id: 'super-hit',
        frame: 'apex',
        type: 'direct-hit',
        hit: { damage: 'all', hitstop: 4, effect: 'hit-spark' },
      }],
    },
  };

  const skillOverrides = custom.skills || {};
  const skills = {};
  for (const [id, skill] of Object.entries(defaults)) {
    skills[id] = mergeSkill(skill, skillOverrides[id]);
  }
  for (const [id, skill] of Object.entries(skillOverrides)) {
    if (!skills[id]) skills[id] = { id, ...skill };
  }

  return {
    stats: {
      maxHp: 100,
      moveSpeed: 400,
      jumpSpeed: -1000,
      gravity: 50,
      ...(custom.stats || {}),
    },
    body: {
      ...(custom.body || {}),
      width: bodyWidth,
      height: bodyHeight,
      pushbox: custom.body?.pushbox || {
        x: 0, y: 0, width: bodyWidth, height: bodyHeight,
      },
      hurtboxes: custom.body?.hurtboxes || [{
        x: 0, y: 0, width: bodyWidth, height: bodyHeight,
      }],
    },
    skills,
  };
}
