export default class Projectile {
  constructor(world, owner, definition) {
    this.world = world;
    this.scene = world.scene;
    this.owner = owner;
    this.definition = definition;
    this.direction = owner.direction;

    const width = definition.width || 48;
    const height = definition.height || 32;
    const forward = definition.forward || 0;
    this.width = width;
    this.height = height;
    this.x = this.direction > 0
      ? owner.x + owner.width + forward
      : owner.x - forward - width;
    this.y = owner.y + (definition.y || owner.height * 0.4);
    this.vx = (definition.speed || 500) * this.direction;
    this.vy = definition.speedY || 0;
    this.lifeMs = definition.lifeMs || 1800;
    this.hitTargets = new Set();
    this.destroyed = false;
    this.sprite = world.effects?.createProjectileVisual(this, definition.visual);
  }

  getBounds() {
    return { x: this.x, y: this.y, width: this.width, height: this.height };
  }

  update(delta) {
    if (this.destroyed) return;
    this.x += (this.vx * delta) / 1000;
    this.y += (this.vy * delta) / 1000;
    this.lifeMs -= delta;
    if (this.sprite) this.sprite.setPosition(this.x + this.width / 2, this.y + this.height / 2);

    const margin = 200;
    if (this.lifeMs <= 0 || this.x < -margin || this.x > this.scene.scale.width + margin) {
      this.destroy();
    }
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.sprite) this.sprite.destroy();
  }
}
