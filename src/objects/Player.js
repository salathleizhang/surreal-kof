import Phaser from 'phaser';
import AiController from './AiController.js';
import {
  playHit, playAttackVoice, playHurtVoice, playDeathVoice, playSwing,
} from '../audio.js';

const { KeyCodes } = Phaser.Input.Keyboard;

// Per-player keyboard layouts (two players share one keyboard). attack2/special
// drive the generated fighters' second attack and 大招; Kyo simply has no such
// animation states, so those keys are inert for him.
const KEY_LAYOUTS = [
  {
    up: KeyCodes.W, left: KeyCodes.A, right: KeyCodes.D, attack: KeyCodes.SPACE,
    attack2: KeyCodes.F, special: KeyCodes.G,
  },
  {
    up: KeyCodes.UP, left: KeyCodes.LEFT, right: KeyCodes.RIGHT, attack: KeyCodes.ENTER,
    attack2: KeyCodes.PERIOD, special: KeyCodes.SLASH,
  },
];

// Finite-state machine states:
// 0: idle, 1: forward, 2: backward, 3: jump, 4: attack, 5: be hit, 6: death
// 7-9 are extra states only generated (AI) fighters use; Kyo never enters them,
// so his behaviour is unaffected.
export const STATUS = {
  IDLE: 0,
  MOVE: 1,
  BACKWARD: 2,
  JUMP: 3,
  ATTACK: 4,
  HIT: 5,
  DEATH: 6,
  ATTACK2: 7, // second attack (kick/elbow/etc.)
  SUPER: 8, // 大招 / desperation move
  INTRO: 9, // entrance / victory pose
};

// One-shot action states: they play their animation once and then drop back to
// idle (death is handled separately — it freezes on its last frame).
const ONE_SHOT_STATES = new Set([
  STATUS.ATTACK, STATUS.HIT, STATUS.ATTACK2, STATUS.SUPER, STATUS.INTRO,
]);

// Overall character size multiplier. The original art/hitboxes were tuned at
// 1.0 (sprite scale 2, 120x200 hitbox); bump this to make both fighters bigger
// while keeping art, hitboxes, punch reach and the floor line in proportion.
export const CHARACTER_SCALE = 1.6;

// Y coordinate of the floor the fighters stand on (bottom of the hitbox).
const FLOOR_Y = 650;

export default class Player {
  constructor(scene, info) {
    this.scene = scene;

    this.id = info.id;
    this.x = info.x; // logical top-left of the hitbox
    this.width = info.width * CHARACTER_SCALE;
    this.height = info.height * CHARACTER_SCALE;

    // Hitbox bottom rests on the floor, so taller fighters start higher up.
    this.groundY = FLOOR_Y - this.height;
    // Start planted on the floor (no drop-in): the fighters hold their idle
    // pose in place through the opening ceremony.
    this.y = this.groundY;

    this.direction = 1; // facing right = 1, facing left = -1

    // Current / initial velocities (px per second).
    this.vx = 0;
    this.vy = 0;
    this.speedx = 400;
    this.speedy = -1000; // jump impulse (upward, so negative)

    // Per-frame gravity step, matching the original ~60fps tuning.
    this.gravity = 50;

    // Stand idle on the floor; the round goes live (and animation begins) once
    // the opening ceremony ends.
    this.status = STATUS.IDLE;

    // status -> { frame_cnt, frame_rate, offset_y, scale }; filled by subclass.
    this.animations = new Map();
    this.texturePrefix = info.texturePrefix;

    this.frame_current_cnt = 0; // counts frames the current status has lasted

    // hp drives the death check; hpGreen / hpRed drive the two-layer HUD bar.
    this.hp = 100;
    this.hpGreen = 100;
    this.hpRed = 100;

    // In single-player mode, player 2 is driven by the AI instead of a second
    // human, so it asks an AiController for its input rather than the keyboard.
    this.isAi = !!info.ai;
    if (this.isAi) {
      this.ai = new AiController(this);
    } else {
      this.keys = scene.input.keyboard.addKeys(KEY_LAYOUTS[this.id]);
    }

    // One sprite per player; texture is swapped every frame in render().
    // Textures are registered by the PreloadScene before players are created.
    this.sprite = scene.add.image(this.x, this.y, `${this.texturePrefix}-0-0`);
    this.sprite.setOrigin(0, 0);
    this.sprite.setDepth(10);

    this.timedelta = 0;

    this.flashFrames = 0; // counts down a white hit-flash on the sprite
    this.ghostTick = 0; // throttles motion afterimages
  }

  update(timedelta) {
    this.timedelta = timedelta;
    this.update_control();
    this.update_move();
    this.update_direction();
    this.update_attack();
    this.render();
  }

  // Abstract the input source so the FSM below is identical for human and AI
  // players: both produce a {up, left, right, attack} boolean snapshot.
  read_input() {
    if (this.isAi) {
      return { attack2: false, special: false, ...this.ai.getInput() };
    }
    const {
      up, left, right, attack, attack2, special,
    } = this.keys;
    return {
      up: up.isDown,
      left: left.isDown,
      right: right.isDown,
      attack: attack.isDown,
      attack2: !!attack2 && attack2.isDown,
      special: !!special && special.isDown,
    };
  }

  update_control() {
    // Controls are locked through the opening ceremony and once the round has
    // been decided (KO): ignore all input so fighters hold their pose.
    if (this.scene.introActive || this.scene.gameOver) return;

    const input = this.read_input();
    const w = input.up;
    const a = input.left;
    const d = input.right;
    const space = input.attack;

    // State transitions are only allowed from idle / moving.
    if (this.status === STATUS.IDLE || this.status === STATUS.MOVE) {
      if (input.special && this.animations.has(STATUS.SUPER)) {
        // 大招: only generated fighters have this state.
        this.status = STATUS.SUPER;
        this.vx = 0;
        this.frame_current_cnt = 0;
        playAttackVoice(this.scene);
      } else if (input.attack2 && this.animations.has(STATUS.ATTACK2)) {
        this.status = STATUS.ATTACK2;
        this.vx = 0;
        this.frame_current_cnt = 0;
        playAttackVoice(this.scene);
      } else if (space) {
        this.status = STATUS.ATTACK;
        this.vx = 0;
        this.frame_current_cnt = 0;
        playAttackVoice(this.scene); // Kyo's "哈!" on swinging
      } else if (w) {
        if (d) this.vx = this.speedx; // 45-degree forward jump
        else if (a) this.vx = -this.speedx;
        else this.vx = 0;
        this.vy = this.speedy;
        this.status = STATUS.JUMP;
        this.frame_current_cnt = 0;
        this.scene.spawnDust(this.x + this.width / 2, this.y + this.height); // kick up takeoff dust
      } else if (d) {
        this.vx = this.speedx;
        this.status = STATUS.MOVE;
      } else if (a) {
        this.vx = -this.speedx;
        this.status = STATUS.MOVE; // backward is also status 1 (rendered as 2)
      } else {
        this.vx = 0;
        this.status = STATUS.IDLE;
      }
    }
  }

  update_move() {
    this.vy += this.gravity;

    this.x += (this.vx * this.timedelta) / 1000;
    this.y += (this.vy * this.timedelta) / 1000;

    let [a, b] = this.scene.players;
    if (a !== this) [a, b] = [b, a]; // a pushes b

    const r1 = { x1: a.x, y1: a.y, x2: a.x + a.width, y2: a.y + a.height };
    const r2 = { x1: b.x, y1: b.y, x2: b.x + b.width, y2: b.y + b.height };

    // Mutual push on collision (no push while the opponent is dead).
    if (this.is_collision(r1, r2) && b.status !== STATUS.DEATH) {
      b.x += (this.vx * this.timedelta) / 1000 / 2;
      b.y += (this.vy * this.timedelta) / 1000 / 2;
      a.x -= (this.vx * this.timedelta) / 1000 / 2;
      a.y -= (this.vy * this.timedelta) / 1000 / 2;

      // Landing on the opponent should not leave us stuck mid-air.
      if (this.status === STATUS.JUMP) this.status = STATUS.IDLE;
    }

    // Land on the ground.
    if (this.y > this.groundY) {
      const wasAirborne = this.status === STATUS.JUMP;
      this.y = this.groundY;
      this.vy = 0;
      // Hit / death animations keep playing after landing; only jump resets.
      if (wasAirborne) {
        this.status = STATUS.IDLE;
        this.scene.spawnDust(this.x + this.width / 2, this.y + this.height); // landing puff
      }
    }

    // Keep the character inside the stage.
    const stageWidth = this.scene.scale.width;
    if (this.x < 0) this.x = 0;
    else if (this.x + this.width > stageWidth) this.x = stageWidth - this.width;
  }

  // Keep both players facing each other.
  update_direction() {
    if (this.status === STATUS.DEATH) return;
    const you = this.scene.players[1 - this.id];
    if (!you) return;
    this.direction = this.x < you.x ? 1 : -1;
  }

  // Axis-Aligned Bounding Box overlap test.
  is_collision(r1, r2) {
    if (Math.max(r1.x1, r2.x1) > Math.min(r1.x2, r2.x2)) return false;
    if (Math.max(r1.y1, r2.y1) > Math.min(r1.y2, r2.y2)) return false;
    return true;
  }

  // The fist is extended around frame 18 of the attack GIF (image index 3).
  // attack2 / super (generated fighters only) land their blow at their own
  // animation apex with a wider reach and more damage.
  update_attack() {
    const S = CHARACTER_SCALE;
    if (this.status === STATUS.ATTACK && this.frame_current_cnt === 18) {
      this.tryStrike({ reach: 100 * S, topOff: 40 * S, heightPx: 20 * S, damage: 20 });
    } else if (this.status === STATUS.ATTACK2 && this.frame_current_cnt === this.actionApex()) {
      this.tryStrike({ reach: 130 * S, topOff: 20 * S, heightPx: 70 * S, damage: 24 });
    } else if (this.status === STATUS.SUPER && this.frame_current_cnt === this.actionApex()) {
      const dmg = (this.moveData && this.moveData.super && this.moveData.super.damage) || 40;
      this.tryStrike({ reach: 220 * S, topOff: 0, heightPx: 150 * S, damage: dmg });
    }
  }

  // The game-frame at which the current action's blow connects: the extension
  // point for an out-and-back (yoyo) move, or the midpoint of a forward one.
  actionApex() {
    const obj = this.animations.get(this.status);
    if (!obj) return 18;
    if (obj.playback === 'forward') {
      return obj.frame_rate * Math.floor((obj.frame_cnt - 1) / 2);
    }
    return obj.frame_rate * (obj.frame_cnt - 1);
  }

  // Project a strike box in front of the fighter; hit the opponent if it lands.
  tryStrike({ reach, topOff, heightPx, damage }) {
    const you = this.scene.players[1 - this.id];
    if (!you) return;
    const top = this.y + topOff;
    const bottom = top + heightPx;

    let r1;
    if (this.direction > 0) {
      r1 = { x1: this.x + this.width, y1: top, x2: this.x + this.width + reach, y2: bottom };
    } else {
      r1 = { x1: this.x - reach, y1: top, x2: this.x, y2: bottom };
    }
    const r2 = { x1: you.x, y1: you.y, x2: you.x + you.width, y2: you.y + you.height };

    // Hit: the victim's is_attack() handles impact + hurt/death audio.
    // Whiff: only the air "whoosh".
    if (this.is_collision(r1, r2)) you.is_attack(damage);
    else playSwing(this.scene);
  }

  // Called on the player that just got hit. `damage` defaults to Kyo's 20.
  is_attack(damage = 20) {
    if (this.status === STATUS.DEATH) return;

    this.status = STATUS.HIT;
    this.frame_current_cnt = 0;
    this.hp = Math.max(this.hp - damage, 0);

    // Hit feedback (pure presentation — the 20 damage above is unchanged):
    // flash the victim solid white and freeze the action for a few frames so the
    // blow lands with weight. setTintFill here guarantees the flash shows on the
    // frozen frame regardless of player update order; render() counts it down.
    this.flashFrames = 4;
    this.sprite.setTintFill(0xffffff);
    this.scene.startHitstop(4);
    playHit(this.scene); // random KOF '97 impact sound

    // Two-layer HP bar: the green layer drops quickly, the red layer trails it.
    this.scene.tweens.add({ targets: this, hpGreen: this.hp, duration: 300 });
    this.scene.tweens.add({ targets: this, hpRed: this.hp, duration: 600 });

    if (this.hp <= 0) {
      this.status = STATUS.DEATH;
      this.frame_current_cnt = 0;
      this.vx = 0;
      playDeathVoice(this.scene); // Kyo's death cry on the killing blow
    } else {
      playHurtVoice(this.scene); // Kyo's "哦!" on a non-fatal hit
    }
  }

  render() {
    let status = this.status;
    // Forward and backward share status 1 but use different art.
    if (this.status === STATUS.MOVE && this.direction * this.vx < 0) status = STATUS.BACKWARD;

    const obj = this.animations.get(status);
    if (obj && obj.frame_cnt > 0) {
      // Playback drives how the frame index walks: data-driven fighters set a
      // mode (loop / forward / yoyo / hold); Kyo leaves it undefined and keeps
      // the original wrap-around behaviour exactly.
      const playback = this.playbackFor(obj);
      const k = playback.frame;
      const key = `${this.texturePrefix}-${status}-${k}`;

      this.sprite.setVisible(true);
      this.sprite.setTexture(key);
      this.sprite.y = this.y + obj.offset_y;

      // offset_x (default 0) centres an oversized sprite over the hitbox; it is
      // mirrored along with the art when the fighter faces left.
      const ox = obj.offset_x || 0;
      if (this.direction > 0) {
        this.sprite.setScale(obj.scale, obj.scale);
        this.sprite.x = this.x + ox;
      } else {
        // Mirror around the right edge of the hitbox (origin stays top-left, so
        // a negative x-scale draws the art leftward from the hitbox's right side).
        this.sprite.setScale(-obj.scale, obj.scale);
        this.sprite.x = this.x + this.width - ox;
      }

      // Motion afterimages: drop a fading ghost while attacking or moving so
      // fast actions read as a streak instead of a teleport.
      this.ghostTick += 1;
      const moving = Math.abs(this.vx) > 1;
      if ((this.status === STATUS.ATTACK || moving) && this.ghostTick % 4 === 0) {
        this.spawnGhost();
      }

      // Count the white hit-flash down here (skipped during hitstop, so the
      // flash stays lit through the freeze).
      if (this.flashFrames > 0) {
        this.sprite.setTintFill(0xffffff);
        this.flashFrames -= 1;
      } else {
        this.sprite.clearTint();
      }

      // Attack / hit / death play once, then idle (death freezes on last frame).
      if (obj.playback) {
        // Data-driven fighters: termination is decided by the playback walk.
        if (playback.finished) {
          if (status === STATUS.DEATH || obj.playback === 'hold') {
            this.frame_current_cnt -= 1; // freeze on the last frame
          } else if (ONE_SHOT_STATES.has(status)) {
            this.status = STATUS.IDLE;
          }
        }
      } else if (status === STATUS.ATTACK || status === STATUS.HIT || status === STATUS.DEATH) {
        if (this.frame_current_cnt === obj.frame_rate * (obj.frame_cnt - 1)) {
          if (status === STATUS.DEATH) this.frame_current_cnt -= 1;
          else this.status = STATUS.IDLE;
        }
      }
    }

    this.frame_current_cnt += 1;
  }

  // Resolve the current frame index + whether the action has finished, honouring
  // the animation's playback mode. Kyo (no playback set) always uses the legacy
  // wrap-around so his timing is untouched.
  playbackFor(obj) {
    const N = obj.frame_cnt;
    const step = Math.floor(this.frame_current_cnt / obj.frame_rate);
    if (!obj.playback || obj.playback === 'loop') {
      return { frame: step % N, finished: false };
    }
    if (obj.playback === 'forward' || obj.playback === 'hold') {
      const frame = Math.min(step, N - 1);
      return { frame, finished: step >= N - 1 };
    }
    if (obj.playback === 'yoyo') {
      const span = Math.max(1, 2 * (N - 1)); // out (0..N-1) then back (N-1..0)
      const frame = step <= N - 1 ? step : Math.max(0, span - step);
      return { frame, finished: step >= span };
    }
    return { frame: step % N, finished: false };
  }

  // A single fading copy of the current sprite frame, drawn just behind the live
  // sprite, tinted blue to read as a speed trail.
  spawnGhost() {
    const s = this.sprite;
    const ghost = this.scene.add.image(s.x, s.y, s.texture.key);
    ghost.setOrigin(0, 0);
    ghost.setScale(s.scaleX, s.scaleY);
    ghost.setDepth(9); // just behind the live sprite (depth 10)
    ghost.setTint(0x66ccff);
    ghost.setAlpha(0.28);
    this.scene.tweens.add({
      targets: ghost,
      alpha: 0,
      duration: 160,
      onComplete: () => ghost.destroy(),
    });
  }
}
