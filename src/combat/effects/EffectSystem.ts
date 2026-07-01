import {
  playAttackVoice, playExplosion, playSwing,
} from '../../audio.ts';
import type Phaser from 'phaser';
import type Projectile from '../entities/Projectile.ts';
import type { EffectContext, ProjectileVisual } from '../../types/combat.ts';

// Presentation registry for skill events. New character-specific effects can be
// registered without adding conditionals to Fighter, SkillRunner or collision.
export default class EffectSystem {
  scene: any;
  handlers: Map<string, (context: EffectContext) => void>;

  constructor(scene: any) {
    this.scene = scene;
    this.handlers = new Map<string, (context: EffectContext) => void>();
    this.registerBuiltIns();
    this.createFallbackTextures();
  }

  register(name: string, handler: (context: EffectContext) => void): void {
    if (name && handler) this.handlers.set(name, handler);
  }

  emit(name: string | undefined, context: EffectContext = {}): void {
    if (!name) return;
    const handler = this.handlers.get(name);
    if (handler) handler(context);
  }

  registerBuiltIns(): void {
    this.register('attack-voice', () => playAttackVoice(this.scene));
    this.register('swing', () => playSwing(this.scene));
    this.register('explosion', () => playExplosion(this.scene));
    this.register('move-name', ({ fighter, skill }) => {
      this.scene.showMoveName?.(fighter, skill && skill.name);
    });
    this.register('hit-spark', ({ x, y }) => this.spawnHitSpark(x, y, 0xfff0a0));
    this.register('projectile-hit', ({ projectile, target }) => {
      const x = projectile ? projectile.x + projectile.width / 2 : target.x;
      const y = projectile ? projectile.y + projectile.height / 2 : target.y;
      this.spawnHitSpark(x, y, 0x66ccff);
      playExplosion(this.scene, { volume: 0.45 });
    });
  }

  createFallbackTextures(): void {
    if (!this.scene.textures.exists('combat-projectile')) {
      const g = this.scene.add.graphics();
      g.fillStyle(0xffffff, 1);
      g.fillCircle(16, 16, 16);
      g.generateTexture('combat-projectile', 32, 32);
      g.destroy();
    }
  }

  createProjectileVisual(
    projectile: Projectile,
    visual: ProjectileVisual = {},
  ): Phaser.GameObjects.Image {
    const sprite = this.scene.add
      .image(
        projectile.x + projectile.width / 2,
        projectile.y + projectile.height / 2,
        visual.texture || 'combat-projectile',
      )
      .setDepth(11)
      .setTint(visual.tint || 0x66ccff)
      .setScale(visual.scale || 1);
    return sprite;
  }

  spawnHitSpark(x: number, y: number, color: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const spark = this.scene.add.image(x, y, 'combat-projectile')
      .setDepth(18)
      .setTint(color)
      .setScale(0.35)
      .setAlpha(0.95);
    this.scene.tweens.add({
      targets: spark,
      scale: 1.6,
      alpha: 0,
      duration: 160,
      ease: 'Quad.easeOut',
      onComplete: () => spark.destroy(),
    });
  }

  destroy(): void {
    this.handlers.clear();
  }
}
