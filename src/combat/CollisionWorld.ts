import Projectile from './entities/Projectile.ts';
import { intersectsAabb, localBoxToWorld, overlapAmount } from './collision/geometry.ts';
import type EffectSystem from './effects/EffectSystem.ts';
import type {
  ActiveHitbox, Box, FighterLike, HitboxEvent, HitData, ProjectileDefinition,
} from '../types/combat.ts';

// The shared collision engine knows how boxes intersect, but owns no character
// or skill tuning. Body sizes live on character definitions; attack boxes and
// projectiles live on skill definitions.
export default class CollisionWorld {
  scene: any;
  effects?: EffectSystem;
  fighters: FighterLike[];
  projectiles: Projectile[];
  activeHitboxes: ActiveHitbox[];

  constructor(scene: any, effects?: EffectSystem) {
    this.scene = scene;
    this.effects = effects;
    this.fighters = [];
    this.projectiles = [];
    this.activeHitboxes = [];
  }

  beginFrame(): void {
    this.activeHitboxes = [];
  }

  registerFighter(fighter: FighterLike): void {
    if (!this.fighters.includes(fighter)) this.fighters.push(fighter);
  }

  unregisterFighter(fighter: FighterLike): void {
    this.fighters = this.fighters.filter((entry) => entry !== fighter);
  }

  activateHitbox(
    owner: FighterLike,
    event: HitboxEvent,
    hitTargets = new Set<FighterLike>(),
  ): number {
    const attackBox = localBoxToWorld(owner, event.box || {});
    this.activeHitboxes.push({ owner, event, box: attackBox });
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

  hitOpponentDirectly(owner: FighterLike, hit: HitData): number {
    let hits = 0;
    for (const target of this.opponentsOf(owner)) {
      if (target.isDead()) continue;
      this.applyHit(owner, target, hit, target.getPushbox());
      hits += 1;
    }
    return hits;
  }

  applyHit(owner: FighterLike, target: FighterLike, hit: HitData, contactBox: Box): void {
    target.receiveHit({ ...hit, attacker: owner });
    const x = contactBox.x + contactBox.width / 2;
    const y = contactBox.y + contactBox.height / 2;
    this.effects?.emit(hit.effect || 'hit-spark', {
      fighter: owner, target, hit, x, y,
    });
  }

  spawnProjectile(owner: FighterLike, definition: ProjectileDefinition): Projectile {
    const projectile = new Projectile(this, owner, definition);
    this.projectiles.push(projectile);
    this.effects?.emit(definition.spawnEffect, { fighter: owner, projectile });
    return projectile;
  }

  update(delta: number): void {
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

  resolvePushboxes(): void {
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

  opponentsOf(owner: FighterLike): FighterLike[] {
    return this.fighters.filter((fighter) => fighter !== owner && fighter.id !== owner.id);
  }

  clearProjectiles(): void {
    for (const projectile of this.projectiles) projectile.destroy();
    this.projectiles = [];
  }

  destroy(): void {
    this.clearProjectiles();
    this.activeHitboxes = [];
    this.fighters = [];
  }
}
