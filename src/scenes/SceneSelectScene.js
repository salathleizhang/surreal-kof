import Phaser from 'phaser';
import {
  CHARACTERS, DEFAULT_CHARACTER, SCENES, SCENE_GRID, DEFAULT_SCENE,
} from '../objects/roster.js';
import { PIXEL_FONT, PIXEL_FONT_CN } from '../fonts.js';
import { setVerticalGradient } from '../utils/text.js';
import { playUi, startMenuBgm } from '../audio.js';

const { JustDown } = Phaser.Input.Keyboard;
const { KeyCodes } = Phaser.Input.Keyboard;

// The stage is a single shared choice, so both players' movement keys drive the
// one cursor and either confirm key locks it in. Cancel hops back to the member
// select screen.
const NAV_KEYS = {
  up: [KeyCodes.W, KeyCodes.UP],
  down: [KeyCodes.S, KeyCodes.DOWN],
  left: [KeyCodes.A, KeyCodes.LEFT],
  right: [KeyCodes.D, KeyCodes.RIGHT],
  confirm: [KeyCodes.SPACE, KeyCodes.ENTER],
  cancel: [KeyCodes.SHIFT, KeyCodes.BACKSPACE],
};

const CURSOR_BORDER = 0xffffff; // white selection border (KOF-style)
const CURSOR_FILL = 0xff3030; // red wash once a stage is locked in
const CN_FONT = PIXEL_FONT_CN;

// This screen reuses the member-select background art (select-scene.png) but
// recolours it red at runtime with an RGB multiply tint, so the stage-select
// step reads as its own distinct phase without needing a second painted asset.
const SCENE_BG_TINT = 0xff5a5a;

// Landscape thumbnails (stages are wide), laid out in a centered grid.
const CELL_W = 176;
const CELL_H = 104;
const GAP = 16;

export default class SceneSelectScene extends Phaser.Scene {
  constructor() {
    super('scene-select');
  }

  create(data) {
    const { width, height } = this.scale;

    this.mode = (data && data.mode) || 'versus';
    // The fighters chosen on the member select screen, carried through so we can
    // keep showing them on the sides (and hand them to the fight scene).
    this.selections = (data && data.selections) || [DEFAULT_CHARACTER, DEFAULT_CHARACTER];

    const bg = this.add
      .image(0, 0, 'select-scene')
      .setOrigin(0, 0)
      .setDisplaySize(width, height)
      .setDepth(0);
    bg.setTint(SCENE_BG_TINT);

    const title = this.add
      .text(width / 2, 36, '场景选择', {
        fontFamily: CN_FONT,
        fontSize: '52px',
        fontStyle: 'bold',
        stroke: '#4a1010',
        strokeThickness: 8,
      })
      .setOrigin(0.5, 0)
      .setDepth(5);
    // Hot white fading into a deep crimson, to match the red stage.
    setVerticalGradient(title, ['#fff0d6', '#ff7f7f', '#9c1f1f']);
    this.title = title;

    this.buildSideFigures();
    this.buildGrid();
    this.buildHints();

    this.col = 0;
    this.row = 0;
    this.confirmed = false;
    this.starting = false;

    this.keys = this.input.keyboard.addKeys({
      w: KeyCodes.W, s: KeyCodes.S, a: KeyCodes.A, d: KeyCodes.D,
      up: KeyCodes.UP, down: KeyCodes.DOWN, left: KeyCodes.LEFT, right: KeyCodes.RIGHT,
      space: KeyCodes.SPACE, enter: KeyCodes.ENTER,
      shift: KeyCodes.SHIFT, backspace: KeyCodes.BACKSPACE,
    });

    this.cursorGfx = this.add.graphics().setDepth(15);
    this.drawCursor();

    this.playIntro();
    startMenuBgm(this);
  }

  // KOF-style entrance, mirroring the member select screen: the title + grid
  // drop in from the top, the two side figures slide in from the edges, and the
  // control hints rise up from the bottom. Input is locked until it finishes.
  playIntro() {
    this.introActive = true;
    const { width, height } = this.scale;

    this.cursorGfx.setAlpha(0);

    const topTargets = [this.title, ...this.gridObjects];
    topTargets.forEach((o) => { o.y -= height; });
    this.tweens.add({
      targets: topTargets,
      y: `+=${height}`,
      duration: 600,
      ease: 'Back.out',
      onComplete: () => {
        this.tweens.add({ targets: this.cursorGfx, alpha: 1, duration: 200 });
        this.introActive = false;
      },
    });

    this.figures.forEach((fig, id) => {
      const dir = id === 0 ? -1 : 1;
      const targets = [fig.figure, fig.name];
      targets.forEach((o) => { o.x += dir * width; });
      this.tweens.add({
        targets,
        x: `+=${-dir * width}`,
        duration: 600,
        ease: 'Back.out',
        delay: 120,
        onComplete: () => { fig.figure.x = fig.homeX; },
      });
    });

    this.hints.y += 120;
    this.tweens.add({
      targets: this.hints,
      y: '-=120',
      duration: 600,
      ease: 'Back.out',
      delay: 240,
    });
  }

  buildGrid() {
    const { cols } = SCENE_GRID;
    const gridW = cols * CELL_W + (cols - 1) * GAP;
    this.gridX = (this.scale.width - gridW) / 2;
    this.gridY = 230;

    this.gridObjects = [];

    this.cells = SCENE_GRID.cells.map((sceneKey, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = this.gridX + col * (CELL_W + GAP);
      const y = this.gridY + row * (CELL_H + GAP);

      const rect = this.add
        .rectangle(x, y, CELL_W, CELL_H, 0x300a0a, 0.85)
        .setOrigin(0, 0)
        .setStrokeStyle(2, 0xaa4444)
        .setDepth(4);

      const thumb = this.addFittedThumb(
        SCENES[sceneKey].thumb, x + 4, y + 4, CELL_W - 8, CELL_H - 8, 5,
      );

      const label = this.add
        .text(x + CELL_W / 2, y + CELL_H - 4, SCENES[sceneKey].cn, {
          fontFamily: CN_FONT,
          fontSize: '18px',
          fontStyle: 'bold',
          color: '#ffe9e9',
          stroke: '#000000',
          strokeThickness: 3,
        })
        .setOrigin(0.5, 1)
        .setDepth(6);

      this.gridObjects.push(rect, thumb, label);

      return { sceneKey, x, y };
    });
  }

  // The two fighters picked on the member screen stand on the far edges, exactly
  // as they did there, keeping the visual language consistent across both steps.
  buildSideFigures() {
    const { width } = this.scale;
    const boxW = 360;
    const boxH = 560;
    const boxY = 130;

    this.figures = [
      { boxX: 0, side: 0 },
      { boxX: width - boxW, side: 1 },
    ].map((cfg, id) => {
      const flip = id === 1;
      const homeX = cfg.boxX + boxW / 2;
      const char = CHARACTERS[this.selections[id]] || CHARACTERS[DEFAULT_CHARACTER];

      const figure = this.add
        .image(homeX, boxY + boxH, char.portrait)
        .setOrigin(0.5, 1)
        .setDepth(3);
      const src = this.textures.get(char.portrait).getSourceImage();
      const scale = Math.min(boxW / src.width, boxH / src.height);
      figure.setScale(flip ? -scale : scale, scale);

      const name = this.add
        .text(id === 0 ? 30 : width - 30, 64, char.cn || char.name, {
          fontFamily: CN_FONT,
          fontSize: '46px',
          fontStyle: 'bold',
          color: '#ffeaea',
          stroke: '#5c1616',
          strokeThickness: 7,
        })
        .setOrigin(id === 0 ? 0 : 1, 0)
        .setDepth(8);

      return {
        figure, name, boxW, boxH, flip, homeX,
      };
    });
  }

  buildHints() {
    const { width, height } = this.scale;
    this.hints = this.add
      .text(width / 2, height - 26,
        'W S A D / ↑ ↓ ← → 选择场景      SPACE / ENTER 确定      SHIFT 返回', {
          fontFamily: CN_FONT,
          fontSize: '22px',
          color: '#ffe2e2',
          stroke: '#000000',
          strokeThickness: 3,
        })
      .setOrigin(0.5, 1)
      .setDepth(8);
  }

  // Draw a texture scaled to fit (contain) inside a box, centered.
  addFittedThumb(key, x, y, w, h, depth) {
    const img = this.add.image(x + w / 2, y + h / 2, key).setOrigin(0.5).setDepth(depth);
    const src = this.textures.get(key).getSourceImage();
    const scale = Math.min(w / src.width, h / src.height);
    img.setScale(scale);
    return img;
  }

  cellIndex() {
    return this.row * SCENE_GRID.cols + this.col;
  }

  drawCursor() {
    const g = this.cursorGfx;
    g.clear();

    const cell = this.cells[this.cellIndex()];
    const alpha = this.confirmed ? 1 : 0.9;
    g.lineStyle(4, CURSOR_BORDER, alpha);
    g.strokeRect(cell.x, cell.y, CELL_W, CELL_H);

    if (this.confirmed) {
      g.fillStyle(CURSOR_FILL, 0.25);
      g.fillRect(cell.x, cell.y, CELL_W, CELL_H);
    }
  }

  update() {
    if (this.starting || this.introActive) return;

    const k = this.keys;
    const pressed = (codes) => codes.some((c) => {
      const map = {
        [KeyCodes.W]: k.w,
        [KeyCodes.S]: k.s,
        [KeyCodes.A]: k.a,
        [KeyCodes.D]: k.d,
        [KeyCodes.UP]: k.up,
        [KeyCodes.DOWN]: k.down,
        [KeyCodes.LEFT]: k.left,
        [KeyCodes.RIGHT]: k.right,
        [KeyCodes.SPACE]: k.space,
        [KeyCodes.ENTER]: k.enter,
        [KeyCodes.SHIFT]: k.shift,
        [KeyCodes.BACKSPACE]: k.backspace,
      };
      return JustDown(map[c]);
    });

    if (this.confirmed) {
      if (pressed(NAV_KEYS.cancel)) {
        this.confirmed = false;
        playUi(this, 'cancel');
        this.drawCursor();
      } else if (pressed(NAV_KEYS.confirm)) {
        this.startFight();
      }
      return;
    }

    // Cancelling out of stage select returns to the member select screen.
    if (pressed(NAV_KEYS.cancel)) {
      playUi(this, 'cancel');
      this.scene.start('select', { mode: this.mode });
      return;
    }

    const { cols, rows } = SCENE_GRID;
    let moved = false;
    if (pressed(NAV_KEYS.left) && this.col > 0) { this.col -= 1; moved = true; }
    if (pressed(NAV_KEYS.right) && this.col < cols - 1) { this.col += 1; moved = true; }
    if (pressed(NAV_KEYS.up) && this.row > 0) { this.row -= 1; moved = true; }
    if (pressed(NAV_KEYS.down) && this.row < rows - 1) { this.row += 1; moved = true; }

    if (moved) { playUi(this, 'cursor'); this.drawCursor(); }

    if (pressed(NAV_KEYS.confirm)) {
      this.confirmed = true;
      playUi(this, 'select');
      this.drawCursor();
    }
  }

  startFight() {
    this.starting = true;
    const sceneKey = this.cells[this.cellIndex()].sceneKey || DEFAULT_SCENE;

    const flash = this.add
      .text(this.scale.width / 2, this.scale.height / 2, 'FIGHT!', {
        fontFamily: PIXEL_FONT,
        fontSize: '120px',
        fontStyle: 'bold',
        stroke: '#c01b1b',
        strokeThickness: 14,
      })
      .setOrigin(0.5)
      .setDepth(30);
    setVerticalGradient(flash, ['#ffffff', '#ffd23f', '#ff5a1f']);
    flash.setScale(0.5);
    this.tweens.add({ targets: flash, scale: 1, duration: 350, ease: 'Back.out' });

    this.time.delayedCall(700, () => this.scene.start('fight', {
      selections: this.selections,
      mode: this.mode,
      scene: sceneKey,
    }));
  }
}
