import Phaser from 'phaser';
import { STATUS } from '../objects/Player.js';
import { CHARACTERS, DEFAULT_CHARACTER } from '../objects/roster.js';
import { PIXEL_FONT } from '../fonts.js';

const ROUND_TIME_MS = 60000;

// HUD geometry (mirrors the old CSS header layout).
const BAR_Y = 20;
const BAR_HEIGHT = 40;
const BAR_MARGIN = 20;
const TIMER_WIDTH = 80;
const BORDER = 5;

export default class FightScene extends Phaser.Scene {
  constructor() {
    super('fight');
  }

  create(data) {
    const { width, height } = this.scale;

    // Background: first decoded frame of the stage GIF, stretched to fill.
    this.add.image(0, 0, 'bg-0').setOrigin(0, 0).setDisplaySize(width, height).setDepth(0);

    // Characters chosen on the select screen (default to Kyo if launched
    // directly, e.g. during development).
    const selections = (data && data.selections) || [DEFAULT_CHARACTER, DEFAULT_CHARACTER];
    const spawns = [
      { id: 0, x: 200, y: 0, width: 120, height: 200 },
      { id: 1, x: 900, y: 0, width: 120, height: 200 },
    ];

    this.players = spawns.map((spawn) => {
      const CharCls = (CHARACTERS[selections[spawn.id]] || CHARACTERS[DEFAULT_CHARACTER]).cls;
      return new CharCls(this, spawn);
    });

    this.timeLeft = ROUND_TIME_MS;
    this.createHud();
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

      this.drawHpLayer(bar, player.hpRed, 0xff0000);
      this.drawHpLayer(bar, player.hpGreen, 0x90ee90);
    });

    this.timerText.setText(`${Math.floor(this.timeLeft / 1000)}`);
  }

  drawHpLayer(bar, hp, color) {
    const inner = bar.width - BORDER * 2;
    const w = (inner * Math.max(hp, 0)) / 100;
    const y = BAR_Y + BORDER;
    const h = BAR_HEIGHT - BORDER * 2;
    const x = bar.anchorRight ? bar.x + bar.width - BORDER - w : bar.x + BORDER;

    this.hudGfx.fillStyle(color, 1);
    this.hudGfx.fillRect(x, y, w, h);
  }

  update(_time, delta) {
    // Guard against huge steps after a tab switch / first frame.
    const timedelta = Math.min(delta, 100);

    this.updateTimer(timedelta);
    for (const player of this.players) player.update(timedelta);
    this.updateHud();
  }

  updateTimer(timedelta) {
    this.timeLeft -= timedelta;
    if (this.timeLeft < 0) {
      this.timeLeft = 0;

      // Time up with no KO: double knockout.
      const [a, b] = this.players;
      if (a.status !== STATUS.DEATH && b.status !== STATUS.DEATH) {
        a.status = b.status = STATUS.DEATH;
        a.frame_current_cnt = b.frame_current_cnt = 0;
        a.vx = b.vx = 0;
      }
    }
  }
}
