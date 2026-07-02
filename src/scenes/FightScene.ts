import Phaser from 'phaser';
import { FIGHTER_STATE, STATUS } from '../config/combat.ts';
import { getCharacter, DEFAULT_CHARACTER } from '../objects/roster.ts';
import { getStage } from '../data/stages.ts';
import { PIXEL_FONT, PIXEL_FONT_CN } from '../fonts.ts';
import { playUi, stopMenuBgm } from '../audio.ts';
import { SCENE_KEYS } from '../config/game.ts';
import CollisionWorld from '../combat/CollisionWorld.ts';
import EffectSystem from '../combat/effects/EffectSystem.ts';
import CombatDebugOverlay from '../combat/debug/CombatDebugOverlay.ts';

const ROUND_TIME_MS = 60000;
// Pre-fight ceremony: hold the action while the "Round 1, Fight!" announcer
// plays (~4s) before the round goes live.
const INTRO_MS = 4000;

// HUD geometry (mirrors the old CSS header layout).
const BAR_Y = 20;
const BAR_HEIGHT = 40;
const BAR_MARGIN = 20;
const TIMER_WIDTH = 80;
const BORDER = 5;

export default class FightScene extends Phaser.Scene {
  // Runtime combat/UI handles are attached during create().
  [key: string]: any;
  constructor() {
    super(SCENE_KEYS.FIGHT);
  }

  create(data) {
    const { width, height } = this.scale;

    // The stage chosen on the scene-select screen; falls back
    // to the configured default if the fight is launched directly in development.
    const scene = getStage(data && data.scene);
    this.game.canvas.setAttribute('aria-label', `战斗场景：${scene.cn}`);
    this.createBackground(width, height, scene);
    this.combatEffects = new EffectSystem(this);
    this.combatWorld = new CollisionWorld(this, this.combatEffects);

    // Characters chosen on the select screen (default to Kyo if launched
    // directly, e.g. during development).
    const selections = (data && data.selections) || [DEFAULT_CHARACTER, DEFAULT_CHARACTER];
    // In single-player mode, player 2 is controlled by the AI (1P is the human).
    const mode = (data && data.mode) || 'versus';
    this.mode = mode;
    // Fighters stand on the floor from the start (their y is derived from the
    // floor line in Player), so only the horizontal spawn position matters here.
    const spawns = [
      { id: 0, x: 200, width: 120, height: 200 },
      { id: 1, x: 900, width: 120, height: 200 },
    ];

    this.players = spawns.map((spawn) => {
      const charKey = selections[spawn.id];
      const char = getCharacter(charKey) || getCharacter(DEFAULT_CHARACTER);
      const ai = mode === 'single' && spawn.id === 1;
      return new char.cls(this, { ...spawn, ai, charKey });
    });

    this.timeLeft = ROUND_TIME_MS;
    this.hitstop = 0; // frames left to freeze the action after a hit
    this.gameOver = false; // set once a fighter is KO'd; freezes input + clock
    this.koShown = false; // becomes true once the "K.O." has been revealed
    this.koWait = 0; // ms waited (post-KO) for the HP trails to finish draining
    this.createDustTexture();
    this.createHud();
    this.combatDebug = new CombatDebugOverlay(this, this.combatWorld);

    // Hand off from the menu music to the fight. A development-only fixed-state
    // preview makes generated animation layers inspectable without racing the
    // live game clock (e.g. ?dev=fight&previewState=super).
    stopMenuBgm();
    const params = new URLSearchParams(globalThis.location?.search || '');
    this.devPreviewState = import.meta.env.DEV ? params.get('previewState') : null;
    if (this.devPreviewState) this.applyDevPreviewState(this.devPreviewState);
    else this.startIntro();

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.combatDebug.destroy();
      this.combatWorld.destroy();
      this.combatEffects.destroy();
    });
  }

  applyDevPreviewState(state) {
    this.introActive = false;
    const player = this.players[0];
    if (!player) return;
    if (state === 'jump') {
      player.status = STATUS.JUMP;
      player.combatState = FIGHTER_STATE.AIRBORNE;
      player.y = player.groundY - 180;
      this.devPreviewFrame = 12;
    } else if (state === 'super') {
      player.status = STATUS.IDLE;
      player.combatState = FIGHTER_STATE.NEUTRAL;
      player.frame_current_cnt = 0;
      player.skillRunner.start('super');
      this.devPreviewFrame = 20;
    } else {
      this.devPreviewState = null;
    }
  }

  createBackground(width, height, scene) {
    const bg = this.add.image(width / 2, height, scene.texture).setOrigin(0.5, 1).setDepth(0);
    const scale = Math.max(width / bg.width, height / bg.height);
    bg.setScale(scale);
  }

  // The opening ceremony: freeze the action while the announcer plays, flashing
  // "Round 1" then "Fight!" in the centre of the screen. After INTRO_MS the
  // round goes live.
  startIntro() {
    const { width, height } = this.scale;
    this.introActive = true;

    // The "Round 1, Fight!" announcer plays only here, as the fight opens —
    // never on the title or select screens.
    playUi(this, 'start');

    const flash = (text, delay, holdMs) => {
      this.time.delayedCall(delay, () => {
        const label = this.add
          .text(width / 2, height / 2, text, {
            fontFamily: PIXEL_FONT,
            fontSize: '72px',
            fontStyle: 'bold',
            color: '#ffffff',
            stroke: '#000000',
            strokeThickness: 8,
            align: 'center',
          })
          .setOrigin(0.5)
          .setDepth(30)
          .setScale(0.3)
          .setAlpha(0);

        // Top-to-bottom gold gradient fill over the (stroked) glyphs.
        const grad = label.context.createLinearGradient(0, 0, 0, label.height);
        grad.addColorStop(0, '#fff7b0');
        grad.addColorStop(0.5, '#ffcc33');
        grad.addColorStop(1, '#ff8800');
        label.setFill(grad);

        // Pop in...
        this.tweens.add({
          targets: label,
          scale: 1,
          alpha: 1,
          duration: 250,
          ease: 'Back.easeOut',
        });
        // ...hold, then fade away.
        this.tweens.add({
          targets: label,
          alpha: 0,
          duration: 300,
          delay: holdMs,
          onComplete: () => label.destroy(),
        });
      });
    };

    // "Round 1", then "Ready" and "Go" in sequence, then the round begins.
    flash('Round 1', 0, 1100);
    flash('Ready', 1400, 700);
    flash('Go', 2600, 1100);
    this.time.delayedCall(INTRO_MS, () => {
      this.introActive = false;
    });
  }

  // Freeze the whole fight for a few frames so hits land with weight. Stacking
  // hits take the longer of the two freezes rather than adding up.
  startHitstop(frames = 4) {
    this.hitstop = Math.max(this.hitstop, frames);
  }

  // A soft white dot reused for every dust puff (generated once).
  createDustTexture() {
    const g = this.add.graphics();
    g.fillStyle(0xffffff, 1);
    g.fillCircle(8, 8, 8);
    g.generateTexture('dust', 16, 16);
    g.destroy();
  }

  // Scatter a handful of dust puffs from a point (feet), drifting up and out.
  spawnDust(x, y) {
    const n = 5;
    for (let i = 0; i < n; i += 1) {
      const scale = 0.4 + Math.random() * 0.5;
      const puff = this.add.image(x, y, 'dust').setDepth(8);
      puff.setTint(0xccbb99).setScale(scale).setAlpha(0.7);
      const dir = (i / (n - 1) - 0.5) * 2; // spread -1..1 across the feet
      this.tweens.add({
        targets: puff,
        x: x + dir * (40 + Math.random() * 30),
        y: y - (10 + Math.random() * 25),
        scale: scale * 1.8,
        alpha: 0,
        duration: 350 + Math.random() * 150,
        ease: 'Quad.easeOut',
        onComplete: () => puff.destroy(),
      });
    }
  }

  showMoveName(player, name) {
    if (!name) return;
    const { width } = this.scale;
    const y = player && player.id === 0 ? 118 : 166;
    const label = this.add
      .text(width / 2, y, name, {
        fontFamily: PIXEL_FONT_CN,
        fontSize: '34px',
        fontStyle: 'bold',
        color: '#fff7b0',
        stroke: '#5a0000',
        strokeThickness: 8,
        align: 'center',
      })
      .setOrigin(0.5)
      .setDepth(31)
      .setScale(0.7)
      .setAlpha(0);

    this.tweens.add({
      targets: label,
      scale: 1,
      alpha: 1,
      duration: 160,
      ease: 'Back.easeOut',
    });
    this.tweens.add({
      targets: label,
      y: y - 18,
      alpha: 0,
      duration: 450,
      delay: 900,
      ease: 'Quad.easeIn',
      onComplete: () => label.destroy(),
    });
  }

  createHud() {
    const { width } = this.scale;
    const half = (width - TIMER_WIDTH) / 2;

    // Left bar fills from the right edge inward; right bar from the left edge.
    this.barLayout = [
      { x: BAR_MARGIN, width: half - BAR_MARGIN, anchorRight: true },
      { x: half + TIMER_WIDTH, width: half - BAR_MARGIN, anchorRight: false },
    ];

    this.hudGfx = this.add.graphics().setDepth(20);

    this.timerText = this.add
      .text(width / 2, BAR_Y + BAR_HEIGHT / 2, '60', {
        fontFamily: PIXEL_FONT,
        fontSize: '22px',
        fontStyle: 'bold',
        color: '#ffffff',
        backgroundColor: '#ffa500',
        align: 'center',
        fixedWidth: TIMER_WIDTH,
        padding: { y: 8 },
      })
      .setOrigin(0.5)
      .setDepth(21);

    this.updateHud();
  }

  updateHud() {
    const g = this.hudGfx;
    g.clear();

    this.barLayout.forEach((bar, i) => {
      const player = this.players[i];

      // White border + black backing.
      g.lineStyle(BORDER, 0xffffff, 1);
      g.fillStyle(0x000000, 1);
      g.fillRect(bar.x, BAR_Y, bar.width, BAR_HEIGHT);
      g.strokeRect(bar.x, BAR_Y, bar.width, BAR_HEIGHT);

      this.drawHpLayer(bar, player.hpRed, player.maxHp, 0xff0000);
      this.drawHpLayer(bar, player.hpGreen, player.maxHp, 0x90ee90);
    });

    this.timerText.setText(`${Math.floor(this.timeLeft / 1000)}`);
  }

  drawHpLayer(bar, hp, maxHp, color) {
    const inner = bar.width - BORDER * 2;
    const w = (inner * Math.max(hp, 0)) / maxHp;
    const y = BAR_Y + BORDER;
    const h = BAR_HEIGHT - BORDER * 2;
    const x = bar.anchorRight ? bar.x + bar.width - BORDER - w : bar.x + BORDER;

    this.hudGfx.fillStyle(color, 1);
    this.hudGfx.fillRect(x, y, w, h);
  }

  update(_time, delta) {
    // Guard against huge steps after a tab switch / first frame.
    const timedelta = Math.min(delta, 100);

    if (this.devPreviewState) {
      const player = this.players[0];
      player.frame_current_cnt = this.devPreviewFrame;
      player.render();
      this.players[1]?.render();
      this.updateHud();
      return;
    }

    // Opening ceremony: the fighters hold their idle pose in place — the idle
    // animation keeps playing, but input (see Player.update_control) and the
    // round clock stay frozen until the announcer finishes.
    if (this.introActive) {
      for (const player of this.players) player.update(timedelta);
      this.combatDebug.update();
      return;
    }

    // Round decided: keep the fighters' animations ticking (death pose / idle)
    // and keep redrawing the HUD so the HP bar's red trail finishes draining to
    // zero. Only the clock and input stay frozen while the KO plays out.
    if (this.gameOver) {
      for (const player of this.players) player.update(timedelta);
      this.updateHud();
      this.updateKoReveal(timedelta);
      this.combatDebug.update();
      return;
    }

    // Hitstop: hold the action (and the frame on screen) frozen for a beat so
    // the hit reads as impact. Tween-driven FX/HP bars keep animating.
    if (this.hitstop > 0) {
      this.hitstop -= 1;
      this.combatDebug.update();
      return;
    }

    this.combatWorld.beginFrame();
    this.updateTimer(timedelta);
    for (const player of this.players) player.update(timedelta);
    this.combatWorld.resolvePushboxes();
    this.combatWorld.update(timedelta);
    this.combatDebug.update();
    this.updateHud();
    this.checkKo();
  }

  // Freeze the fight the moment either fighter drops. The "K.O." itself is held
  // back (see updateKoReveal) until the HP bars have visibly drained.
  checkKo() {
    if (this.gameOver) return;
    if (!this.players.some((player) => player.isDead())) return;

    this.gameOver = true;
    this.koWait = 0;
    this.combatWorld.clearProjectiles();
    for (const player of this.players) {
      player.vx = 0; // stop the winner mid-stride
      // The winner strikes its entrance/victory pose, if it has one (generated
      // fighters do); the loser is already in its death animation.
      if (!player.isDead()) player.playState(STATUS.INTRO);
    }
  }

  // Reveal the "K.O." only once both HP bars (the fast green layer and the
  // trailing red layer) have caught up to the real hp — otherwise the round
  // reads as ending while a fighter still appears to have health left. A safety
  // cap guarantees it shows even if a tween never quite settles.
  updateKoReveal(timedelta) {
    if (this.koShown) return;

    this.koWait += timedelta;
    const settled = this.players.every(
      (p) => Math.abs(p.hpRed - p.hp) < 0.5 && Math.abs(p.hpGreen - p.hp) < 0.5,
    );
    if (!settled && this.koWait < 1500) return;

    this.koShown = true;
    this.showKo();
  }

  // The big "K.O." slam, followed by the "press any key" prompt that returns to
  // the title screen.
  showKo() {
    const { width, height } = this.scale;

    // "K.O.!" announcer, synced to the word slamming onto the screen, then the
    // result call right after: "Winner!" normally, or "Game Over" when the human
    // player loses (1P down in single-player) or it's a draw / double-KO.
    playUi(this, 'ko');
    const p1Dead = this.players[0].isDead();
    const p2Dead = this.players[1].isDead();
    const lose = (p1Dead && p2Dead) || (this.mode === 'single' && p1Dead);
    this.time.delayedCall(1000, () => playUi(this, lose ? 'gameover' : 'winner'));

    const ko = this.add
      .text(width / 2, height / 2, 'K.O.', {
        fontFamily: PIXEL_FONT,
        fontSize: '120px',
        fontStyle: 'bold',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 12,
        align: 'center',
      })
      .setOrigin(0.5)
      .setDepth(30)
      .setScale(2)
      .setAlpha(0);

    // Slam the word onto the screen.
    this.tweens.add({
      targets: ko,
      scale: 1,
      alpha: 1,
      duration: 350,
      ease: 'Back.easeOut',
    });

    // After a beat, offer the "press any key" prompt and arm the return.
    this.time.delayedCall(800, () => {
      const hint = this.add
        .text(width / 2, height / 2 + 120, 'PRESS ANY KEY', {
          fontFamily: PIXEL_FONT,
          fontSize: '28px',
          color: '#ffcc33',
          stroke: '#000000',
          strokeThickness: 6,
          align: 'center',
        })
        .setOrigin(0.5)
        .setDepth(30);

      // Blink the prompt so it reads as interactive.
      this.tweens.add({
        targets: hint,
        alpha: 0.2,
        duration: 500,
        yoyo: true,
        repeat: -1,
      });

      // Any key (or tap) returns to the title screen, which restarts the menu BGM.
      const toTitle = () => this.scene.start(SCENE_KEYS.TITLE);
      this.input.keyboard.once('keydown', toTitle);
      this.input.once('pointerdown', toTitle);
    });
  }

  updateTimer(timedelta) {
    this.timeLeft -= timedelta;
    if (this.timeLeft < 0) {
      this.timeLeft = 0;

      // Time up with no KO: double knockout.
      const [a, b] = this.players;
      if (!a.isDead() && !b.isDead()) {
        a.defeat();
        b.defeat();
      }
    }
  }
}
