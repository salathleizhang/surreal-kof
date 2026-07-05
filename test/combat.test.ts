import test from 'node:test';
import assert from 'node:assert/strict';
import CollisionWorld from '../src/combat/CollisionWorld.ts';
import SkillRunner from '../src/combat/SkillRunner.ts';
import { intersectsAabb, localBoxToWorld } from '../src/combat/collision/geometry.ts';
import { isGuardInput, resolveDamage } from '../src/combat/guard.ts';
import { createGeneratedCombatDefinition } from '../src/characters/generated/createCombatDefinition.ts';
import {
  DEFAULT_WINNER_QUOTE, getWinnerQuote, WINNER_QUOTES,
} from '../src/data/winnerQuotes.ts';
import {
  findVisibleBounds, resolveGeneratedFigureTexture,
} from '../src/services/generatedCharacters.ts';
import { fitVisibleSprite } from '../src/utils/spriteLayout.ts';

test('winner quotes cover every requested fighter verbatim', () => {
  assert.deepEqual(WINNER_QUOTES, {
    'fighter-87633c7b': '理解万岁！',
    chenmian: '此一时彼一时！',
    speed: 'siu！',
    kobe: 'man！what can i say！',
    caixukun: '你～干～嘛',
    'fengge-wangming-tianya': '这是好事儿啊！',
  });
  assert.equal(getWinnerQuote('kyo'), DEFAULT_WINNER_QUOTE);
});

test('large generated-character art uses the final entrance pose', () => {
  assert.equal(resolveGeneratedFigureTexture('speed', {
    0: { frame_cnt: 8, frame_rate: 6, playback: 'loop' },
    9: { frame_cnt: 8, frame_rate: 4, playback: 'forward' },
  }), 'speed-9-7');
  assert.equal(resolveGeneratedFigureTexture('legacy', {
    0: { frame_cnt: 8, frame_rate: 6, playback: 'loop' },
  }), 'legacy-0-0');
});

test('sprite layout fits visible pixels instead of transparent canvas margins', () => {
  const pixels = new Uint8ClampedArray(10 * 12 * 4);
  for (let y = 3; y <= 10; y += 1) {
    for (let x = 2; x <= 5; x += 1) pixels[(y * 10 + x) * 4 + 3] = 255;
  }
  const bounds = findVisibleBounds(pixels, 10, 12);
  assert.deepEqual(bounds, {
    x: 2, y: 3, width: 4, height: 8, sourceWidth: 10, sourceHeight: 12,
  });
  assert.deepEqual(fitVisibleSprite(10, 12, bounds, 20, 24), {
    originX: 0.4,
    originY: 11 / 12,
    scale: 3,
  });
});

test('local boxes mirror around fighters without changing authored dimensions', () => {
  const fighter = {
    x: 100, y: 50, width: 80, height: 160, direction: 1,
  };
  const box = { x: 80, y: 20, width: 40, height: 30 };
  assert.deepEqual(localBoxToWorld(fighter, box), {
    x: 180, y: 70, width: 40, height: 30,
  });
  fighter.direction = -1;
  assert.deepEqual(localBoxToWorld(fighter, box), {
    x: 60, y: 70, width: 40, height: 30,
  });
});

test('AABB overlap excludes boxes that only touch at an edge', () => {
  const a = { x: 0, y: 0, width: 20, height: 20 };
  assert.equal(intersectsAabb(a, { x: 19, y: 0, width: 10, height: 10 }), true);
  assert.equal(intersectsAabb(a, { x: 20, y: 0, width: 10, height: 10 }), false);
});

test('guard requires down plus the direction away from the opponent', () => {
  assert.equal(isGuardInput({ down: true, left: true }, 1), true);
  assert.equal(isGuardInput({ down: true, right: true }, 1), false);
  assert.equal(isGuardInput({ down: true, right: true }, -1), true);
  assert.equal(isGuardInput({ down: false, left: true }, 1), false);
});

test('guarded hits deal no damage, including all-damage hits', () => {
  assert.equal(resolveDamage(20, 100, true), 0);
  assert.equal(resolveDamage('all', 100, true), 0);
  assert.equal(resolveDamage(20, 100, false), 20);
  assert.equal(resolveDamage('all', 73, false), 73);
});

test('collision world resolves a skill-owned hitbox against target hurtboxes', () => {
  const hits = [];
  let rage = 0;
  const scene = { scale: { width: 1280 } };
  const effects = { emit() {} };
  const world = new CollisionWorld(scene, effects as any);
  const owner = {
    id: 0, x: 100, y: 100, width: 80, height: 160, direction: 1,
    isDead: () => false,
    gainRage: (amount = 25) => { rage += amount; },
  };
  const target = {
    id: 1,
    isDead: () => false,
    getHurtboxes: () => [{ x: 190, y: 110, width: 60, height: 100 }],
    getPushbox: () => ({ x: 190, y: 110, width: 60, height: 100 }),
    receiveHit: (hit) => hits.push(hit),
  };
  world.registerFighter(owner as any);
  world.registerFighter(target as any);

  const count = world.activateHitbox(owner as any, {
    type: 'hitbox',
    box: { x: 80, y: 20, width: 50, height: 30 },
    hit: { damage: 17 },
  });
  assert.equal(count, 1);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].damage, 17);
  assert.equal(hits[0].attacker, owner);
  assert.equal(rage, 25);
  assert.equal(world.activeHitboxes.length, 1);
  assert.deepEqual(world.activeHitboxes[0].box, {
    x: 180, y: 120, width: 50, height: 30,
  });
  world.beginFrame();
  assert.equal(world.activeHitboxes.length, 0);
});

test('rage-gated skills only start when full and consume their cost', () => {
  const fighter = {
    status: 0,
    frame_current_cnt: 0,
    rage: 149,
    maxRage: 150,
    isDead: () => false,
    canStartSkill: () => true,
    canUseSkill(skill) {
      return skill.rageCost === 'all'
        ? this.rage >= this.maxRage
        : this.rage >= (skill.rageCost || 0);
    },
    hasAnimation: () => true,
    animationApex: () => 3,
    animationDuration: () => 9,
    beginSkill(skill) {
      this.rage -= skill.rageCost === 'all' ? this.maxRage : (skill.rageCost || 0);
      this.status = skill.animation;
    },
    scene: { combatEffects: { emit() {} } },
  };
  const runner = new SkillRunner(fighter as any, {
    super: {
      id: 'super', input: 'special', animation: 8, rageCost: 'all',
    },
  });

  assert.equal(runner.tryStartFromInput({ special: true }), false);
  assert.equal(fighter.rage, 149);
  fighter.rage = 150;
  assert.equal(runner.tryStartFromInput({ special: true }), true);
  assert.equal(fighter.rage, 0);
});

test('skill runner fires multiple same-frame events exactly once', () => {
  const dispatched = [];
  const fighter = {
    status: 0,
    frame_current_cnt: 0,
    isDead: () => false,
    canStartSkill: () => true,
    hasAnimation: () => true,
    animationApex: () => 3,
    animationDuration: () => 9,
    beginSkill(skill) { this.status = skill.animation; this.frame_current_cnt = 0; },
    scene: {
      combatWorld: {
        activateHitbox(_owner, event) { dispatched.push(event.id); return 1; },
      },
      combatEffects: { emit() {} },
    },
  };
  const runner = new SkillRunner(fighter as any, {
    combo: {
      id: 'combo', input: 'attack', animation: 4,
      events: [
        { id: 'high', frame: 3, type: 'hitbox', box: {} },
        { id: 'low', frame: 3, type: 'hitbox', box: {} },
      ],
    },
  });

  assert.equal(runner.tryStartFromInput({ attack: true }), true);
  fighter.frame_current_cnt = 3;
  runner.update();
  runner.update();
  assert.deepEqual(dispatched, ['high', 'low']);
});

test('active hitbox windows damage the same target only once', () => {
  const target = {};
  let hits = 0;
  const fighter = {
    status: 0,
    frame_current_cnt: 0,
    isDead: () => false,
    canStartSkill: () => true,
    hasAnimation: () => true,
    animationApex: () => 3,
    animationDuration: () => 9,
    beginSkill(skill) { this.status = skill.animation; },
    scene: {
      combatWorld: {
        activateHitbox(_owner, _event, hitTargets) {
          if (hitTargets.has(target)) return 0;
          hitTargets.add(target);
          hits += 1;
          return 1;
        },
      },
      combatEffects: { emit() {} },
    },
  };
  const runner = new SkillRunner(fighter as any, {
    sweep: {
      id: 'sweep', input: 'attack', animation: 4,
      events: [{ id: 'sweep-hit', type: 'hitbox', from: 2, to: 4, box: {} }],
    },
  });
  runner.start('sweep');
  for (const frame of [2, 3, 4]) {
    fighter.frame_current_cnt = frame;
    runner.update();
  }
  assert.equal(hits, 1);
});

test('generated character body overrides resize default pushbox and hurtbox', () => {
  const combat = createGeneratedCombatDefinition({
    combat: { body: { width: 240, height: 360 } },
  });
  assert.deepEqual(combat.body.pushbox, {
    x: 0, y: 0, width: 240, height: 360,
  });
  assert.deepEqual(combat.body.hurtboxes, [{
    x: 0, y: 0, width: 240, height: 360,
  }]);
  const attackEvent = combat.skills.attack1.events[0];
  assert.equal(attackEvent.type === 'hitbox' ? attackEvent.box.x : undefined, 240);
});

test('projectiles move independently and resolve their own collision box', () => {
  const hits = [];
  const effects = { emit() {}, createProjectileVisual: () => null };
  const world = new CollisionWorld({ scale: { width: 1280 } }, effects as any);
  const owner = {
    id: 0, x: 0, y: 0, width: 50, height: 100, direction: 1,
    isDead: () => false,
  };
  const target = {
    id: 1,
    isDead: () => false,
    getHurtboxes: () => [{ x: 100, y: 20, width: 40, height: 60 }],
    getPushbox: () => ({ x: 100, y: 20, width: 40, height: 60 }),
    receiveHit: (hit) => hits.push(hit),
  };
  world.registerFighter(owner as any);
  world.registerFighter(target as any);
  world.spawnProjectile(owner as any, {
    y: 20, width: 20, height: 20, speed: 100, lifeMs: 1000,
    hit: { damage: 12 },
  });
  world.update(500);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].damage, 12);
  assert.equal(world.projectiles.length, 0);
});
