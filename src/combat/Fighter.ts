import Phaser from 'phaser';
import AiController from '../objects/AiController.ts';
import SkillRunner from './SkillRunner.ts';
import { localBoxToWorld } from './collision/geometry.ts';
import { isGuardInput, resolveDamage } from './guard.ts';
import {
  playHit, playHurtVoice, playDeathVoice,
} from '../audio.ts';
import {
  CHARACTER_SCALE, DEFAULT_MAX_RAGE, DEFAULT_RAGE_GAIN_PER_HIT, FIGHTER_STATE, STATUS,
} from '../config/combat.ts';
import type {
  AnimationDefinition, AnimationState, Box, CombatDefinition, FighterBody,
  FighterStats, HitData, SkillDefinition,
} from '../types/combat.ts';

export interface FighterCreateInfo {
  id: number;
  x: number;
  width: number;
  height: number;
  texturePrefix: string;
  combat?: CombatDefinition;
  ai?: boolean;
  charKey?: string;
}

const { KeyCodes } = Phaser.Input.Keyboard;

const KEY_LAYOUTS = [
  {
    up: KeyCodes.W, down: KeyCodes.S, left: KeyCodes.A, right: KeyCodes.D, attack: KeyCodes.G,
    attack2: KeyCodes.H, special: KeyCodes.J,
  },
  {
    up: KeyCodes.UP, down: KeyCodes.DOWN, left: KeyCodes.LEFT, right: KeyCodes.RIGHT, attack: KeyCodes.COMMA,
    attack2: KeyCodes.PERIOD, special: KeyCodes.FORWARD_SLASH,
  },
];

const ONE_SHOT_STATES = new Set<AnimationState>([
  STATUS.ATTACK, STATUS.HIT, STATUS.ATTACK2, STATUS.SUPER, STATUS.INTRO,
]);
const FLOOR_Y = 650;

// Shared fighter runtime. Character subclasses provide animation metadata and a
// combat definition; skill-specific collision/movement/effects are delegated to
// SkillRunner and CollisionWorld instead of branching here.
export default class Fighter {
  scene: any;
  id: number;
  combat: CombatDefinition;
  stats: FighterStats;
  body: FighterBody;
  width: number;
  height: number;
  x: number;
  y: number;
  groundY: number;
  direction: number;
  vx: number;
  vy: number;
  speedx: number;
  speedy: number;
  gravity: number;
  status: AnimationState;
  combatState: string;
  animations: Map<AnimationState, AnimationDefinition>;
  texturePrefix: string;
  charKey: string;
  frame_current_cnt: number;
  maxHp: number;
  hp: number;
  hpGreen: number;
  hpRed: number;
  maxRage: number;
  rage: number;
  isAi: boolean;
  ai?: AiController;
  keys?: Record<string, Phaser.Input.Keyboard.Key>;
  sprite: Phaser.GameObjects.Image;
  backgroundSprite: Phaser.GameObjects.Image | null;
  timedelta: number;
  flashFrames: number;
  ghostTick: number;
  skillRunner: SkillRunner;

  constructor(scene: any, info: FighterCreateInfo) {
    this.scene = scene;
    this.id = info.id;
    this.combat = info.combat || {};
    this.stats = this.combat.stats || {};
    this.body = this.combat.body || {};

    this.width = this.body.width ?? info.width * CHARACTER_SCALE;
    this.height = this.body.height ?? info.height * CHARACTER_SCALE;
    this.x = info.x;
    this.groundY = (this.stats.floorY ?? FLOOR_Y) - this.height;
    this.y = this.groundY;
    this.direction = 1;

    this.vx = 0;
    this.vy = 0;
    this.speedx = this.stats.moveSpeed ?? 400;
    this.speedy = this.stats.jumpSpeed ?? -1000;
    this.gravity = this.stats.gravity ?? 50;

    this.status = STATUS.IDLE;
    this.combatState = FIGHTER_STATE.NEUTRAL;
    this.animations = new Map<AnimationState, AnimationDefinition>();
    this.texturePrefix = info.texturePrefix;
    this.charKey = info.charKey || info.texturePrefix;
    this.frame_current_cnt = 0;

    this.maxHp = this.stats.maxHp ?? 100;
    this.hp = this.maxHp;
    this.hpGreen = this.maxHp;
    this.hpRed = this.maxHp;
    this.maxRage = this.stats.maxRage ?? DEFAULT_MAX_RAGE;
    this.rage = 0;

    this.isAi = !!info.ai;
    if (this.isAi) this.ai = new AiController(this);
    else this.keys = scene.input.keyboard.addKeys(KEY_LAYOUTS[this.id]);

    this.sprite = scene.add.image(this.x, this.y, `${this.texturePrefix}-0-0`);
    this.sprite.setOrigin(0, 0);
    this.sprite.setDepth(10);
    this.backgroundSprite = null;

    this.timedelta = 0;
    this.flashFrames = 0;
    this.ghostTick = 0;
    this.skillRunner = new SkillRunner(this, this.combat.skills);
    scene.combatWorld?.registerFighter(this);
  }

  update(timedelta: number): void {
    this.timedelta = timedelta;
    this.updateControl();
    this.skillRunner.update();
    this.updateMove();
    this.updateDirection();
    this.render();
  }

  readInput(): Record<string, boolean> {
    if (this.isAi) return { attack2: false, special: false, ...this.ai!.getInput() };
    const {
      up, down, left, right, attack, attack2, special,
    } = this.keys!;
    return {
      up: up.isDown,
      down: down.isDown,
      left: left.isDown,
      right: right.isDown,
      attack: attack.isDown,
      attack2: !!attack2 && attack2.isDown,
      special: !!special && special.isDown,
    };
  }

  updateControl(): void {
    if (this.scene.introActive || this.scene.gameOver || this.isDead()) return;
    // Hit reactions own the fighter until their animation finishes. Do not
    // even sample buffered player/AI input while stunned; any movement during
    // this state must come from authored knockback, not character controls.
    if (this.combatState === FIGHTER_STATE.HITSTUN) return;
    const input = this.readInput();

    // Crouch-back is guard: down plus the direction away from the opponent.
    // Guard owns the fighter for as long as the chord is held, then releases
    // immediately back to neutral so movement or an attack can start.
    const wantsGuard = isGuardInput(input, this.direction);
    if (this.combatState === FIGHTER_STATE.GUARDING) {
      if (wantsGuard) {
        this.vx = 0;
        return;
      }
      this.status = STATUS.IDLE;
      this.combatState = FIGHTER_STATE.NEUTRAL;
      this.frame_current_cnt = 0;
    }
    if (wantsGuard && this.canStartSkill()) {
      this.status = STATUS.GUARD;
      this.combatState = FIGHTER_STATE.GUARDING;
      this.frame_current_cnt = 0;
      this.vx = 0;
      return;
    }

    if (this.skillRunner.tryStartFromInput(input)) return;
    if (!this.canStartSkill()) return;

    if (input.up) {
      if (input.right) this.vx = this.speedx;
      else if (input.left) this.vx = -this.speedx;
      else this.vx = 0;
      this.vy = this.speedy;
      this.status = STATUS.JUMP;
      this.combatState = FIGHTER_STATE.AIRBORNE;
      this.frame_current_cnt = 0;
      this.scene.spawnDust(this.x + this.width / 2, this.y + this.height);
    } else if (input.right) {
      this.vx = this.speedx;
      this.status = STATUS.MOVE;
    } else if (input.left) {
      this.vx = -this.speedx;
      this.status = STATUS.MOVE;
    } else {
      this.vx = 0;
      this.status = STATUS.IDLE;
    }
  }

  canStartSkill(): boolean {
    return this.combatState === FIGHTER_STATE.NEUTRAL
      && (this.status === STATUS.IDLE || this.status === STATUS.MOVE);
  }

  canUseSkill(skill: SkillDefinition): boolean {
    if (skill.rageCost === 'all') return this.isRageFull();
    return this.rage >= (skill.rageCost || 0);
  }

  gainRage(amount = this.stats.rageGainPerHit ?? DEFAULT_RAGE_GAIN_PER_HIT): void {
    this.rage = Phaser.Math.Clamp(this.rage + Math.max(0, amount), 0, this.maxRage);
  }

  isRageFull(): boolean {
    return this.rage >= this.maxRage;
  }

  beginSkill(skill: SkillDefinition): void {
    const rageCost = skill.rageCost === 'all' ? this.maxRage : (skill.rageCost || 0);
    this.rage = Math.max(0, this.rage - rageCost);
    this.status = skill.animation;
    this.combatState = FIGHTER_STATE.ATTACKING;
    this.frame_current_cnt = 0;
    if (skill.stopOnStart !== false) this.vx = 0;
  }

  onSkillFinished(skill: SkillDefinition): void {
    if (skill.stopOnEnd !== false) this.vx = 0;
    if (this.isDead() || this.combatState === FIGHTER_STATE.HITSTUN) return;
    this.status = STATUS.IDLE;
    this.combatState = FIGHTER_STATE.NEUTRAL;
    this.frame_current_cnt = 0;
  }

  onSkillCancelled(skill: SkillDefinition): void {
    if (skill.stopOnEnd !== false) this.vx = 0;
  }

  hasAnimation(state: AnimationState): boolean {
    return this.animations.has(state);
  }

  playState(state: AnimationState, combatState = FIGHTER_STATE.ATTACKING): boolean {
    if (!this.hasAnimation(state) || this.isDead()) return false;
    this.skillRunner.cancel();
    this.status = state;
    this.combatState = combatState;
    this.frame_current_cnt = 0;
    this.vx = 0;
    return true;
  }

  updateMove(): void {
    this.vy += this.gravity;
    this.x += (this.vx * this.timedelta) / 1000;
    this.y += (this.vy * this.timedelta) / 1000;

    if (this.y > this.groundY) {
      const wasAirborne = this.combatState === FIGHTER_STATE.AIRBORNE;
      this.y = this.groundY;
      this.vy = 0;
      if (wasAirborne) {
        this.status = STATUS.IDLE;
        this.combatState = FIGHTER_STATE.NEUTRAL;
        this.frame_current_cnt = 0;
        this.scene.spawnDust(this.x + this.width / 2, this.y + this.height);
      }
    }
    this.clampToStage();
  }

  clampToStage(): void {
    const stageWidth = this.scene.scale.width;
    if (this.x < 0) this.x = 0;
    else if (this.x + this.width > stageWidth) this.x = stageWidth - this.width;
  }

  updateDirection(): void {
    if (this.isDead()) return;
    const opponent = this.scene.players && this.scene.players.find((entry) => entry !== this);
    if (opponent) this.direction = this.x < opponent.x ? 1 : -1;
  }

  getPushbox(): Box {
    const skillBox = this.skillRunner.activeSkill?.pushbox;
    return localBoxToWorld(this, skillBox || this.body.pushbox || {
      x: 0, y: 0, width: this.width, height: this.height,
    });
  }

  getHurtboxes(): Box[] {
    const skillBoxes = this.skillRunner.activeSkill?.hurtboxes;
    const boxes = skillBoxes || this.body.hurtboxes || [{
      x: 0, y: 0, width: this.width, height: this.height,
    }];
    return boxes.map((box) => localBoxToWorld(this, box));
  }

  animationApex(state: AnimationState): number {
    const animation = this.animations.get(state);
    if (!animation) return 18;
    if (animation.playback === 'forward') {
      return animation.frame_rate * Math.floor((animation.frame_cnt - 1) / 2);
    }
    return animation.frame_rate * (animation.frame_cnt - 1);
  }

  animationDuration(state: AnimationState): number {
    const animation = this.animations.get(state);
    if (!animation) return 0;
    const steps = animation.playback === 'yoyo'
      ? 2 * (animation.frame_cnt - 1)
      : animation.frame_cnt - 1;
    return animation.frame_rate * steps;
  }

  getSkillRange(input = 'attack'): number {
    const skill = this.skillRunner.getSkillByInput(input);
    if (!skill) return 0;
    if (skill.ai?.range) return skill.ai.range;
    const hitbox = (skill.events || []).find((event) => event.type === 'hitbox');
    return hitbox?.box?.width || 0;
  }

  receiveHit(hit: HitData = {}): void {
    if (this.isDead()) return;
    const guarding = this.combatState === FIGHTER_STATE.GUARDING && this.status === STATUS.GUARD;
    const damage = resolveDamage(hit.damage, this.hp, guarding);
    if (guarding) {
      // A held guard absorbs the hit without damage, hitstun, knockback or a
      // hurt voice. Short hitstop/flash still gives the attacker clear contact
      // feedback while the guard pose remains in control.
      this.vx = 0;
      this.flashFrames = 2;
      this.sprite.setTintFill(0xffffff);
      this.scene.startHitstop(hit.hitstop ?? 3);
      playHit(this.scene);
      return;
    }
    this.skillRunner.cancel();

    this.status = STATUS.HIT;
    this.combatState = FIGHTER_STATE.HITSTUN;
    this.frame_current_cnt = 0;
    this.hp = Math.max(this.hp - damage, 0);

    // Cancel momentum inherited from walking or an interrupted skill. A hit
    // may still move the victim when it explicitly defines knockback below.
    this.vx = 0;
    if (hit.knockback) {
      const direction = hit.attacker ? hit.attacker.direction : -this.direction;
      this.vx = (hit.knockback.x || 0) * direction;
      this.vy = hit.knockback.y || this.vy;
    }

    this.flashFrames = 4;
    this.sprite.setTintFill(0xffffff);
    this.scene.startHitstop(hit.hitstop ?? 4);
    playHit(this.scene);
    this.scene.tweens.add({ targets: this, hpGreen: this.hp, duration: 300 });
    this.scene.tweens.add({ targets: this, hpRed: this.hp, duration: 600 });

    if (this.hp <= 0) this.defeat();
    else playHurtVoice(this.scene);
  }

  defeat(): void {
    if (this.isDead()) return;
    this.skillRunner.cancel();
    this.hp = 0;
    this.status = STATUS.DEATH;
    this.combatState = FIGHTER_STATE.DEAD;
    this.frame_current_cnt = 0;
    this.vx = 0;
    playDeathVoice(this.scene);
  }

  isDead(): boolean {
    return this.combatState === FIGHTER_STATE.DEAD;
  }

  render(): void {
    let renderState = this.status;
    if (this.status === STATUS.MOVE && this.direction * this.vx < 0) {
      renderState = STATUS.BACKWARD;
    }

    // Legacy fighters/manifests have no authored guard animation. They still
    // get functional defense and render their idle art as a graceful fallback.
    if (renderState === STATUS.GUARD && !this.animations.has(renderState)) {
      renderState = STATUS.IDLE;
    }
    const animation = this.animations.get(renderState);
    if (animation?.background) this.renderAnimationBackground(animation.background);
    else if (this.backgroundSprite) this.backgroundSprite.setVisible(false);
    if (animation && animation.frame_cnt > 0) {
      const playback = this.playbackFor(animation);
      const key = `${this.texturePrefix}-${renderState}-${playback.frame}`;
      this.sprite.setVisible(true);
      this.sprite.setTexture(key);

      if (animation.fullscreen) {
        const stageWidth = this.scene.scale.width;
        const stageHeight = this.scene.scale.height;
        const cover = Math.max(
          stageWidth / (animation.srcW || stageWidth),
          stageHeight / (animation.srcH || stageHeight),
        );
        this.sprite.setScale(cover, cover);
        this.sprite.x = (stageWidth - (animation.srcW || stageWidth) * cover) / 2;
        this.sprite.y = (stageHeight - (animation.srcH || stageHeight) * cover) / 2;
        this.sprite.setDepth(5);
      } else {
        this.sprite.setDepth(10);
        this.sprite.y = this.y + (animation.offset_y || 0);
        const offsetX = animation.offset_x || 0;
        const anchorX = animation.dash ? this.dashAnchorX(animation.dash, playback.frame) : this.x;
        if (this.direction > 0) {
          this.sprite.setScale(animation.scale, animation.scale);
          this.sprite.x = anchorX + offsetX;
        } else {
          this.sprite.setScale(-animation.scale, animation.scale);
          this.sprite.x = anchorX + this.width - offsetX;
        }
      }

      this.ghostTick += 1;
      const moving = Math.abs(this.vx) > 1;
      const skillTrail = this.skillRunner.activeSkill?.trail;
      if ((skillTrail || moving) && this.ghostTick % 4 === 0) this.spawnGhost();

      if (this.flashFrames > 0) {
        this.sprite.setTintFill(0xffffff);
        this.flashFrames -= 1;
      } else {
        this.sprite.clearTint();
      }

      if (animation.playback) {
        if (playback.finished) {
          if (renderState === STATUS.DEATH || animation.playback === 'hold') {
            this.frame_current_cnt -= 1;
          } else if (ONE_SHOT_STATES.has(renderState)) {
            this.finishOneShot(renderState);
          }
        }
      } else if (
        renderState === STATUS.ATTACK
        || renderState === STATUS.HIT
        || renderState === STATUS.DEATH
      ) {
        if (this.frame_current_cnt === animation.frame_rate * (animation.frame_cnt - 1)) {
          if (renderState === STATUS.DEATH) this.frame_current_cnt -= 1;
          else this.finishOneShot(renderState);
        }
      }
    }
    this.frame_current_cnt += 1;
  }

  // Interpolates the sprite's x anchor from the fighter's own stance toward a
  // standoff distance beside the opponent, over [fromFrame, toFrame] of the
  // authored clip, then holds there. Before fromFrame (or with no opponent) it
  // stays at the fighter's own position, unchanged from the non-dash path.
  dashAnchorX(dash: NonNullable<AnimationDefinition['dash']>, frame: number): number {
    const opponent = this.scene.players && this.scene.players.find((entry: Fighter) => entry !== this);
    if (!opponent) return this.x;
    const { fromFrame, toFrame, standoff = 90 } = dash;
    const span = toFrame - fromFrame;
    const t = span > 0 ? Math.min(1, Math.max(0, (frame - fromFrame) / span)) : (frame >= fromFrame ? 1 : 0);
    const targetX = opponent.x - this.direction * standoff;
    return this.x + (targetX - this.x) * t;
  }

  renderAnimationBackground(background: NonNullable<AnimationDefinition['background']>): void {
    const playback = this.playbackFor(background);
    const key = `${background.texturePrefix}-${playback.frame}`;
    if (!this.backgroundSprite) {
      this.backgroundSprite = this.scene.add.image(0, 0, key).setOrigin(0, 0);
    }
    const stageWidth = this.scene.scale.width;
    const stageHeight = this.scene.scale.height;
    const cover = Math.max(
      stageWidth / (background.srcW || stageWidth),
      stageHeight / (background.srcH || stageHeight),
    );
    this.backgroundSprite
      .setVisible(true)
      .setTexture(key)
      .setScale(cover, cover)
      .setPosition(
        (stageWidth - (background.srcW || stageWidth) * cover) / 2,
        (stageHeight - (background.srcH || stageHeight) * cover) / 2,
      )
      .setDepth(5);
  }

  finishOneShot(state: AnimationState): void {
    if (this.skillRunner.isActive && this.skillRunner.activeSkill?.animation === state) {
      this.skillRunner.finish();
      return;
    }
    this.status = STATUS.IDLE;
    this.combatState = FIGHTER_STATE.NEUTRAL;
    this.frame_current_cnt = 0;
    this.vx = 0;
  }

  playbackFor(animation: AnimationDefinition): { frame: number; finished: boolean } {
    const frameCount = animation.frame_cnt;
    const step = Math.floor(this.frame_current_cnt / animation.frame_rate);
    if (!animation.playback || animation.playback === 'loop') {
      return { frame: step % frameCount, finished: false };
    }
    if (animation.playback === 'forward' || animation.playback === 'hold') {
      const frame = Math.min(step, frameCount - 1);
      return { frame, finished: step >= frameCount - 1 };
    }
    if (animation.playback === 'yoyo') {
      const span = Math.max(1, 2 * (frameCount - 1));
      const frame = step <= frameCount - 1 ? step : Math.max(0, span - step);
      return { frame, finished: step >= span };
    }
    return { frame: step % frameCount, finished: false };
  }

  spawnGhost(): void {
    const source = this.sprite;
    const ghost = this.scene.add.image(source.x, source.y, source.texture.key);
    ghost.setOrigin(0, 0);
    ghost.setScale(source.scaleX, source.scaleY);
    ghost.setDepth(9);
    ghost.setTint(0x66ccff);
    ghost.setAlpha(0.28);
    this.scene.tweens.add({
      targets: ghost,
      alpha: 0,
      duration: 160,
      onComplete: () => ghost.destroy(),
    });
  }

  destroy(): void {
    this.scene.combatWorld?.unregisterFighter(this);
    if (this.backgroundSprite) this.backgroundSprite.destroy();
    this.sprite.destroy();
  }
}
