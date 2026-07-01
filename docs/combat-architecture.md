# Combat architecture

The combat layer is data-driven: fighters share runtime machinery, while body
sizes, skills, movement, hitboxes, projectiles and effects belong to character
or skill definitions.

## Runtime flow

```text
input / AI -> SkillRunner -> timed skill events
                              |-- movement
                              |-- melee hitbox -> CollisionWorld -> receiveHit
                              |-- projectile   -> CollisionWorld -> receiveHit
                              `-- visual/audio effect
```

- `src/combat/Fighter.js` owns locomotion, HP, animation playback and reactions.
- `src/combat/SkillRunner.js` runs declarative skill timelines.
- `src/combat/CollisionWorld.js` resolves pushboxes, hurtboxes, hitboxes and projectiles.
- `src/combat/effects/EffectSystem.js` maps effect names to presentation code.
- `src/characters/` contains character combat definitions.

The engine is shared; tuning is not. Do not add new skill branches to `Fighter`.

## Character definition

```js
export const CHARACTER_COMBAT = {
  stats: {
    maxHp: 110,
    moveSpeed: 360,
    jumpSpeed: -920,
    gravity: 48,
  },
  body: {
    width: 180,
    height: 300,
    pushbox: { x: 20, y: 40, width: 140, height: 260 },
    hurtboxes: [
      { x: 45, y: 0, width: 90, height: 110 },
      { x: 20, y: 110, width: 140, height: 190 },
    ],
  },
  skills: { /* definitions below */ },
};
```

Boxes use fighter-local pixels and automatically mirror when facing left.
`pushbox` controls fighter spacing. `hurtboxes` receive attacks. A character may
have multiple hurtboxes and every skill may have multiple hitbox events. Skills
may also provide their own `pushbox` or `hurtboxes` to temporarily change the
fighter's collision profile while that skill is active.

## Melee skill

```js
heavyPunch: {
  id: 'heavyPunch',
  input: 'attack2',
  animation: 'heavy-punch',
  stopOnStart: true,
  startEffects: ['attack-voice'],
  events: [
    {
      frame: 10,
      type: 'movement',
      from: 10,
      to: 14,
      velocityX: 240,
    },
    {
      id: 'heavy-hit',
      from: 14,
      to: 16,
      type: 'hitbox',
      box: { x: 170, y: 55, width: 150, height: 80 },
      hit: {
        damage: 26,
        hitstop: 6,
        knockback: { x: 280, y: -180 },
        effect: 'heavy-hit-spark',
      },
      onWhiff: 'swing',
    },
  ],
}
```

`frame` may be a number, `"apex"`, or `"end"`. Movement is facing-relative by
default; set `relative: false` for an absolute world velocity. A hitbox with
`from`/`to` remains active for that window and hits each target once.

## Projectile skill

```js
fireball: {
  id: 'fireball',
  input: 'special',
  animation: 'fireball-cast',
  startEffects: ['attack-voice'],
  events: [{
    frame: 12,
    type: 'projectile',
    projectile: {
      forward: 8,
      y: 95,
      width: 52,
      height: 34,
      speed: 560,
      lifeMs: 1800,
      hit: {
        damage: 18,
        hitstop: 4,
        knockback: { x: 190, y: 0 },
      },
      visual: { texture: 'kyo-fireball', scale: 1.2 },
      spawnEffect: 'fireball-cast',
      hitEffect: 'fireball-hit',
    },
  }],
}
```

Projectiles are independent combat entities. They own position, velocity,
lifetime, collision size, hit data and presentation.

## Effects

Skill data refers to effects by name. Register their implementation once:

```js
scene.combatEffects.register('heavy-hit-spark', ({ x, y }) => {
  // Create Phaser sprites, particles, camera shake or sound here.
});
```

Effects never apply damage. Damage remains in `CollisionWorld`, so visual changes
cannot silently change game balance.

## Generated fighters

Existing manifests receive compatible default skills. A future manifest may add
or override a `combat` block containing `stats`, `body`, and `skills`. Unknown
animation keys are loaded as custom states, so a new skill does not require an
edit to the old numeric `STATUS` table.

During development, open the fight directly with:

```text
http://127.0.0.1:5173/?dev=fight&p1=kyo&p2=kyo
```

This shortcut is disabled in production builds.
