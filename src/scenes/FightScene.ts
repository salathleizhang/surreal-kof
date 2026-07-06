import Phaser from 'phaser';
import { DEFAULT_RAGE_GAIN_PER_HIT, FIGHTER_STATE, STATUS } from '../config/combat.ts';
import { getCharacter, DEFAULT_CHARACTER } from '../objects/roster.ts';
import { getStage } from '../data/stages.ts';
import { getWinnerQuote } from '../data/winnerQuotes.ts';
import { PIXEL_FONT, PIXEL_FONT_CN } from '../fonts.ts';
import { setVerticalGradient } from '../utils/text.ts';
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
const RAGE_BAR_Y = BAR_Y + BAR_HEIGHT + 8;
const RAGE_BAR_HEIGHT = 16;
const RAGE_BORDER = 3;

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
    this.resultShown = false; // reset when the same scene instance starts a rematch
    this.createDustTexture();
    this.createHud();
    this.combatDebug = new CombatDebugOverlay(this, this.combatWorld);

    // Hand off from the menu music to the fight. A development-only fixed-state
    // preview makes generated animation layers inspectable without racing the
    // live game clock (e.g. ?dev=fight&previewState=super).
    stopMenuBgm();
    const params = new URLSearchParams(globalThis.location?.search || '');
    this.devPreviewState = import.meta.env.DEV ? params.get('previewState') : null;
    this.devPreviewWinner = import.meta.env.DEV ? params.get('previewWinner') : null;
    if (this.devPreviewWinner) this.applyDevWinnerPreview(this.devPreviewWinner);
    else if (this.devPreviewState) this.applyDevPreviewState(this.devPreviewState);
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
    } else if (state === 'hit') {
      player.status = STATUS.HIT;
      player.combatState = FIGHTER_STATE.HITSTUN;
      this.devPreviewFrame = 10;
    } else if (state === 'super') {
      player.status = STATUS.IDLE;
      player.combatState = FIGHTER_STATE.NEUTRAL;
      player.frame_current_cnt = 0;
      player.rage = player.maxRage;
      player.skillRunner.start('super');
      this.devPreviewFrame = 20;
    } else if (state === 'rage') {
      player.rage = player.maxRage;
      this.devPreviewFrame = 0;
    } else {
      this.devPreviewState = null;
    }
  }

  // Development-only shortcut for reviewing the post-fight composition without
  // having to play through an entire round. `previewWinner=2` selects player 2;
  // every other truthy value selects player 1.
  applyDevWinnerPreview(value) {
    this.introActive = false;
    const winnerIndex = value === '2' ? 1 : 0;
    const loser = this.players[winnerIndex === 0 ? 1 : 0];
    loser.defeat();
    loser.hpGreen = 0;
    loser.hpRed = 0;
    this.checkKo();
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
      for (const player of this.players) {
        if (!player.isDead() && player.status === STATUS.INTRO) {
          player.status = STATUS.IDLE;
          player.combatState = FIGHTER_STATE.NEUTRAL;
          player.frame_current_cnt = 0;
          player.vx = 0;
        }
      }
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

    this.rageTexts = this.barLayout.map((bar) => this.add
      .text(bar.x + bar.width / 2, RAGE_BAR_Y + RAGE_BAR_HEIGHT / 2, '', {
        fontFamily: PIXEL_FONT_CN,
        fontSize: '11px',
        fontStyle: 'bold',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 3,
        align: 'center',
      })
      .setOrigin(0.5)
      .setDepth(21));

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
      this.drawRageBar(bar, player);

      const full = player.rage >= player.maxRage;
      this.rageTexts[i]
        .setText(`怒气 ${Math.floor(player.rage)} / ${player.maxRage}`)
        .setColor(full ? '#fff36a' : '#ffffff');
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

  drawRageBar(bar, player) {
    const g = this.hudGfx;
    g.lineStyle(RAGE_BORDER, 0xffffff, 1);
    g.fillStyle(0x180703, 0.95);
    g.fillRect(bar.x, RAGE_BAR_Y, bar.width, RAGE_BAR_HEIGHT);
    g.strokeRect(bar.x, RAGE_BAR_Y, bar.width, RAGE_BAR_HEIGHT);

    const inner = bar.width - RAGE_BORDER * 2;
    const ratio = Phaser.Math.Clamp(player.rage / player.maxRage, 0, 1);
    const w = inner * ratio;
    const x = bar.anchorRight
      ? bar.x + bar.width - RAGE_BORDER - w
      : bar.x + RAGE_BORDER;
    g.fillStyle(ratio >= 1 ? 0xffe34f : 0xff7a00, 1);
    g.fillRect(x, RAGE_BAR_Y + RAGE_BORDER, w, RAGE_BAR_HEIGHT - RAGE_BORDER * 2);

    g.lineStyle(1, 0x522000, 0.9);
    const segmentCount = Math.max(
      1,
      Math.ceil(player.maxRage / (player.stats.rageGainPerHit ?? DEFAULT_RAGE_GAIN_PER_HIT)),
    );
    for (let segment = 1; segment < segmentCount; segment += 1) {
      const segmentX = bar.x + RAGE_BORDER + (inner * segment) / segmentCount;
      g.lineBetween(
        segmentX,
        RAGE_BAR_Y + RAGE_BORDER,
        segmentX,
        RAGE_BAR_Y + RAGE_BAR_HEIGHT - RAGE_BORDER,
      );
    }
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

  // The big "K.O." slam, followed by the dedicated winner screen.
  showKo() {
    const { width, height } = this.scale;

    // "K.O.!" announcer, synced to the word slamming onto the screen, then the
    // result call right after: "Winner!" normally, or "Game Over" when the human
    // player loses (1P down in single-player) or it's a draw / double-KO.
    playUi(this, 'ko');
    const p1Dead = this.players[0].isDead();
    const p2Dead = this.players[1].isDead();
    const lose = (p1Dead && p2Dead) || (this.mode === 'single' && p1Dead);
    const winner = p1Dead === p2Dead ? null : this.players[p1Dead ? 1 : 0];
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

    // Let the KO land, then clear it out before presenting the winner's pose.
    this.time.delayedCall(900, () => {
      this.tweens.add({
        targets: ko,
        scale: 1.15,
        alpha: 0,
        duration: 260,
        ease: 'Quad.easeIn',
        onComplete: () => ko.destroy(),
      });
    });
    this.time.delayedCall(1200, () => this.showWinnerScreen(winner));
  }

  showWinnerScreen(winner) {
    if (this.resultShown) return;
    this.resultShown = true;

    const { width, height } = this.scale;
    const result = this.add.container(0, 0).setDepth(40).setAlpha(0);
    const backdrop = this.add.graphics();
    backdrop.fillStyle(0x050307, 0.98);
    backdrop.fillRect(0, 0, width, height);
    backdrop.fillStyle(winner ? 0x8f071f : 0x242132, 1);
    backdrop.beginPath();
    backdrop.moveTo(0, 0);
    backdrop.lineTo(width * 0.5, 0);
    backdrop.lineTo(width * 0.38, height);
    backdrop.lineTo(0, height);
    backdrop.closePath();
    backdrop.fillPath();
    backdrop.fillStyle(0xffc928, 1);
    backdrop.fillRect(0, 0, width, 10);
    backdrop.fillRect(0, height - 10, width, 10);
    result.add(backdrop);

    if (winner) {
      const character = getCharacter(winner.charKey);
      const characterName = character?.cn || character?.name || winner.charKey;
      const quote = getWinnerQuote(winner.charKey);
      const intro = winner.animations.get(STATUS.INTRO);
      const poseState = intro ? STATUS.INTRO : STATUS.IDLE;
      const poseAnimation = intro || winner.animations.get(STATUS.IDLE);
      const poseFrame = Math.max(0, (poseAnimation?.frame_cnt || 1) - 1);
      const poseKey = `${winner.texturePrefix}-${poseState}-${poseFrame}`;
      const pose = this.add.image(-80, height + 8, poseKey).setOrigin(0.5, 1).setAlpha(0);
      const poseScale = Math.min((height * 0.91) / pose.height, (width * 0.47) / pose.width);
      pose.setScale(poseScale * 0.82);
      result.add(pose);

      const eyebrow = this.add
        .text(width * 0.58, 94, 'THE KING OF FIGHTERS', {
          fontFamily: PIXEL_FONT,
          fontSize: '18px',
          color: '#ffcc33',
        })
        .setAlpha(0);
      const winnerLabel = this.add
        .text(width * 0.58, 130, 'WINNER', {
          fontFamily: PIXEL_FONT,
          fontSize: '70px',
          stroke: '#7d0016',
          strokeThickness: 10,
        })
        .setAlpha(0);
      setVerticalGradient(winnerLabel, ['#fff7c0', '#ffd23f', '#b8741a']);
      const name = this.add
        .text(width * 0.58, 250, characterName, {
          fontFamily: PIXEL_FONT_CN,
          fontSize: '34px',
          fontStyle: 'bold',
          stroke: '#000000',
          strokeThickness: 6,
        })
        .setAlpha(0);
      setVerticalGradient(name, ['#fff4d6', '#ffcc33', '#a86a00']);
      const rule = this.add.rectangle(width * 0.58, 312, width * 0.34, 6, 0xffcc33)
        .setOrigin(0, 0.5)
        .setAlpha(0);
      const quoteLabel = this.add
        .text(width * 0.58, 354, quote, {
          fontFamily: PIXEL_FONT_CN,
          fontSize: '42px',
          fontStyle: 'bold',
          stroke: '#3a0d00',
          strokeThickness: 8,
          lineSpacing: 16,
          wordWrap: { width: width * 0.37, useAdvancedWrap: true },
        })
        .setScale(1.35)
        .setAlpha(0);
      setVerticalGradient(quoteLabel, ['#fff7c0', '#ffcc33', '#ff5a1f']);
      result.add([eyebrow, winnerLabel, name, rule, quoteLabel]);

      this.tweens.add({
        targets: pose,
        x: width * 0.27,
        scaleX: poseScale,
        scaleY: poseScale,
        alpha: 1,
        duration: 420,
        ease: 'Back.easeOut',
      });
      this.tweens.add({
        targets: [eyebrow, winnerLabel, name, rule],
        x: '+=28',
        alpha: 1,
        duration: 300,
        delay: this.tweens.stagger(75, { start: 120 }),
        ease: 'Quad.easeOut',
      });
      // The quote gets its own punchier reveal (scale pop + afterglow) since
      // it's the line the player actually reads and remembers.
      this.tweens.add({
        targets: quoteLabel,
        x: '+=28',
        scaleX: 1,
        scaleY: 1,
        alpha: 1,
        duration: 380,
        delay: 420,
        ease: 'Back.easeOut',
        onComplete: () => this.pulseQuoteGlow(quoteLabel),
      });
      this.game.canvas.setAttribute('aria-label', `胜者界面：${characterName}，${quote}`);
    } else {
      const drawLabel = this.add
        .text(width / 2, height / 2 - 38, 'DRAW', {
          fontFamily: PIXEL_FONT,
          fontSize: '96px',
          color: '#ffffff',
          stroke: '#000000',
          strokeThickness: 12,
        })
        .setOrigin(0.5);
      const drawSub = this.add
        .text(width / 2, height / 2 + 70, '胜负未分', {
          fontFamily: PIXEL_FONT_CN,
          fontSize: '36px',
          color: '#ffcc33',
          stroke: '#000000',
          strokeThickness: 6,
        })
        .setOrigin(0.5);
      result.add([drawLabel, drawSub]);
      this.game.canvas.setAttribute('aria-label', '平局界面：胜负未分');
    }

    this.tweens.add({ targets: result, alpha: 1, duration: 240, ease: 'Quad.easeOut' });
    this.time.delayedCall(520, () => this.armResultExit(result));
  }

  // Warm breathing glow behind the winner's quote. Only WebGL supports the FX
  // pipeline the glow relies on, so canvas fallback just skips it.
  pulseQuoteGlow(quoteLabel) {
    if (this.game.renderer.type !== Phaser.WEBGL) return;
    const glow = quoteLabel.postFX.addGlow(0xff9a2e, 0, 0, false, 0.15, 12);
    this.tweens.add({
      targets: glow,
      outerStrength: 2.4,
      duration: 700,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }

  armResultExit(result) {
    const { width, height } = this.scale;
    const hint = this.add
      .text(width * 0.77, height - 54, 'PRESS ANY KEY', {
        fontFamily: PIXEL_FONT,
        fontSize: '18px',
        color: '#ffcc33',
        stroke: '#000000',
        strokeThickness: 5,
      })
      .setOrigin(0.5)
      .setAlpha(0);
    result.add(hint);
    this.tweens.add({
      targets: hint,
      alpha: 1,
      duration: 350,
      yoyo: true,
      repeat: -1,
    });

    // Any key (or tap) returns to the title screen, which restarts the menu BGM.
    const toTitle = () => this.scene.start(SCENE_KEYS.TITLE);
    this.input.keyboard.once('keydown', toTitle);
    this.input.once('pointerdown', toTitle);
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
