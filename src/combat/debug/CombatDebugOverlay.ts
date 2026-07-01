import Phaser from 'phaser';
import { PIXEL_FONT_CN } from '../../fonts.ts';
import type CollisionWorld from '../CollisionWorld.ts';
import type { Box } from '../../types/combat.ts';

const COLORS = Object.freeze({
  pushbox: 0xffd84d,
  hurtbox: 0x42ff8b,
  hitbox: 0xff3b4f,
  projectile: 0x42d9ff,
});

// Canvas debug view for the live combat geometry. It is intentionally separate
// from collision resolution: turning it on never changes simulation behavior.
export default class CombatDebugOverlay {
  scene: any;
  world: CollisionWorld;
  graphics: Phaser.GameObjects.Graphics;
  enabled: boolean;
  legend: Phaser.GameObjects.Text;
  button: Phaser.GameObjects.Text;
  key: Phaser.Input.Keyboard.Key;
  handleToggle: () => void;
  handleKey: (key: Phaser.Input.Keyboard.Key, event?: KeyboardEvent) => void;

  constructor(scene: any, world: CollisionWorld) {
    this.scene = scene;
    this.world = world;
    this.graphics = scene.add.graphics().setDepth(90);

    const params = new URLSearchParams(globalThis.location?.search || '');
    const requested = ['1', 'true', 'hitboxes'].includes(params.get('debug'));
    this.enabled = requested || !!scene.registry.get('combatDebugEnabled');

    this.legend = scene.add
      .text(14, scene.scale.height - 14,
        '黄色 PUSH   绿色 HURT   红色 HIT   蓝色 PROJECTILE', {
          fontFamily: PIXEL_FONT_CN,
          fontSize: '13px',
          color: '#ffffff',
          backgroundColor: '#05070b',
          padding: { x: 8, y: 6 },
        })
      .setOrigin(0, 1)
      .setDepth(91);

    this.button = scene.add
      .text(scene.scale.width - 14, scene.scale.height - 14, '', {
        fontFamily: PIXEL_FONT_CN,
        fontSize: '15px',
        color: '#cbd5e1',
        backgroundColor: '#111827',
        padding: { x: 10, y: 7 },
      })
      .setOrigin(1, 1)
      .setDepth(92)
      .setInteractive({ useHandCursor: true });

    this.handleToggle = () => this.toggle();
    this.handleKey = (_key: Phaser.Input.Keyboard.Key, event?: KeyboardEvent) => {
      if (!event?.repeat) this.toggle();
    };
    this.button.on('pointerdown', this.handleToggle);
    this.key = scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.F2);
    this.key.on('down', this.handleKey);
    this.refreshUi();
    this.update();
  }

  toggle(): void {
    this.enabled = !this.enabled;
    this.scene.registry.set('combatDebugEnabled', this.enabled);
    this.refreshUi();
    this.update();
  }

  refreshUi(): void {
    this.button
      .setText(`开发模式：${this.enabled ? '开' : '关'}  [F2]`)
      .setColor(this.enabled ? '#ffffff' : '#cbd5e1')
      .setBackgroundColor(this.enabled ? '#9f1d2f' : '#111827');
    this.legend.setVisible(this.enabled);
  }

  update(): void {
    this.graphics.clear();
    if (!this.enabled) return;

    for (const fighter of this.world.fighters) {
      this.drawBox(fighter.getPushbox(), COLORS.pushbox, 0.04, 3);
      for (const box of fighter.getHurtboxes()) {
        this.drawBox(box, COLORS.hurtbox, 0.08, 1);
      }
    }

    for (const active of this.world.activeHitboxes) {
      this.drawBox(active.box, COLORS.hitbox, 0.18, 2);
    }

    for (const projectile of this.world.projectiles) {
      if (!projectile.destroyed) {
        this.drawBox(projectile.getBounds(), COLORS.projectile, 0.15, 2);
      }
    }
  }

  drawBox(box: Box, color: number, fillAlpha: number, lineWidth: number): void {
    if (!box || !Number.isFinite(box.x) || !Number.isFinite(box.y)
      || !Number.isFinite(box.width) || !Number.isFinite(box.height)
      || box.width <= 0 || box.height <= 0) return;
    this.graphics.fillStyle(color, fillAlpha);
    this.graphics.fillRect(box.x, box.y, box.width, box.height);
    this.graphics.lineStyle(lineWidth, color, 1);
    this.graphics.strokeRect(box.x, box.y, box.width, box.height);
  }

  destroy(): void {
    this.button.off('pointerdown', this.handleToggle);
    this.key.off('down', this.handleKey);
    this.graphics.destroy();
    this.legend.destroy();
    this.button.destroy();
  }
}
