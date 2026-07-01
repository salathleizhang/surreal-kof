import Projectile from './entities/Projectile.js';
import { intersectsAabb, localBoxToWorld, overlapAmount } from './collision/geometry.js';

// The shared collision engine knows how boxes intersect, but owns no character
// or skill tuning. Body sizes live on character definitions; attack boxes and
// projectiles live on skill definitions.
export default class CollisionWorld {
  constructor(scene, effects) {
    this.scene = scene;
    this.effects = effects;
    this.fighters = [];
    this.projectiles = [];
  }

  registerFighter(fighter) {
    if (!this.fighters.includes(fighter)) this.fighters.push(fighter);
  }

  unregisterFighter(fighter) {
    this.fighters = this.fighters.filter((entry) => entry !== fighter);
  }

  activateHitbox(owner, event, hitTargets = new Set()) {
    const attackBox = localBoxToWorld(owner, event.box || {});
    let hits = 0;
    for (const target of this.opponentsOf(owner)) {
      if (target.isDead() || hitTargets.has(target)) continue;
      const hurt = target.getHurtboxes().some((box) => intersectsAabb(attackBox, box));
      if (!hurt) continue;
      this.applyHit(owner, target, event.hit || event, attackBox);
      hitTargets.add(target);
      hits += 1;
    }
    return hits;
  }

  hitOpponentDirectly(owner, hit) {
    let hits = 0;
    for (const target of this.opponentsOf(owner)) {
      if (target.isDead()) continue;
      this.applyHit(owner, target, hit, target.getPushbox());
      hits += 1;
    }
    return hits;
  }

  applyHit(owner, target, hit, contactBox) {
    target.receiveHit({ ...hit, attacker: owner });
    const x = contactBox.x + contactBox.width / 2;
    const y = contactBox.y + contactBox.height / 2;
    this.effects?.emit(hit.effect || 'hit-spark', {
      fighter: owner, target, hit, x, y,
    });
  }

  spawnProjectile(owner, definition) {
    const projectile = new Projectile(this, owner, definition);
    this.projectiles.push(projectile);
    this.effects?.emit(definition.spawnEffect, { fighter: owner, projectile });
    return projectile;
  }

  update(delta) {
    for (const projectile of this.projectiles) {
      projectile.update(delta);
      if (projectile.destroyed) continue;

      for (const target of this.opponentsOf(projectile.owner)) {
        if (target.isDead() || projectile.hitTargets.has(target)) continue;
        const hurt = target.getHurtboxes().some(
          (box) => intersectsAabb(projectile.getBounds(), box),
        );
        if (!hurt) continue;

        projectile.hitTargets.add(target);
        this.applyHit(
          projectile.owner,
          target,
          projectile.definition.hit || projectile.definition,
          projectile.getBounds(),
        );
        this.effects?.emit(projectile.definition.hitEffect || 'projectile-hit', {
          fighter: projectile.owner, target, projectile,
        });
        if (!projectile.definition.pierce) projectile.destroy();
        break;
      }
    }
    this.projectiles = this.projectiles.filter((projectile) => !projectile.destroyed);
  }

  resolvePushboxes() {
    if (this.fighters.length < 2) return;
    const [a, b] = this.fighters;
    if (a.isDead() || b.isDead()) return;
    const boxA = a.getPushbox();
    const boxB = b.getPushbox();
    if (!intersectsAabb(boxA, boxB)) return;
    const overlap = overlapAmount(boxA, boxB);
    if (overlap.x <= 0 || overlap.y <= 0) return;

    const aOnLeft = boxA.x + boxA.width / 2 <= boxB.x + boxB.width / 2;
    const push = overlap.x / 2 + 0.01;
    a.x += aOnLeft ? -push : push;
    b.x += aOnLeft ? push : -push;
    a.clampToStage();
    b.clampToStage();
  }

  opponentsOf(owner) {
    return this.fighters.filter((fighter) => fighter !== owner && fighter.id !== owner.id);
  }

  clearProjectiles() {
    for (const projectile of this.projectiles) projectile.destroy();
    this.projectiles = [];
  }

  destroy() {
    this.clearProjectiles();
    this.fighters = [];
  }
}
