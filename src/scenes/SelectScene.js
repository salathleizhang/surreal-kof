import Phaser from 'phaser';
import { CHARACTERS, SELECT_GRID } from '../objects/roster.js';

const { JustDown } = Phaser.Input.Keyboard;
const { KeyCodes } = Phaser.Input.Keyboard;

// Per-player select-screen controls (mirrors the in-fight layouts, plus a down
// key for grid navigation and a cancel key to un-confirm).
const KEY_LAYOUTS = [
  {
    up: KeyCodes.W, down: KeyCodes.S, left: KeyCodes.A, right: KeyCodes.D,
    confirm: KeyCodes.SPACE, cancel: KeyCodes.SHIFT,
  },
  {
    up: KeyCodes.UP, down: KeyCodes.DOWN, left: KeyCodes.LEFT, right: KeyCodes.RIGHT,
    confirm: KeyCodes.ENTER, cancel: KeyCodes.BACKSPACE,
  },
];

const CURSOR_COLORS = [0xff3030, 0x3399ff]; // 1P red, 2P blue
const CN_FONT = '"PingFang SC", "Microsoft YaHei", sans-serif';

// Compact center grid (the big standing art lives on the screen edges instead
// of in bottom panels).
const CELL = 88;
const GAP = 12;

export default class SelectScene extends Phaser.Scene {
  constructor() {
    super('select');
  }

  create() {
    const { width, height } = this.scale;

    this.add
      .image(0, 0, 'bg-0')
      .setOrigin(0, 0)
      .setDisplaySize(width, height)
      .setDepth(0)
      .setTint(0x335577);

    this.add
      .text(width / 2, 36, '角色选择', {
        fontFamily: CN_FONT,
        fontSize: '52px',
        fontStyle: 'bold',
        color: '#7fffd4',
        stroke: '#10324a',
        strokeThickness: 8,
      })
      .setOrigin(0.5, 0)
      .setDepth(5);

    this.buildSideFigures();
    this.buildGrid();
    this.buildHints();

    // Per-player cursor state: position in the grid + whether locked in.
    this.starting = false;
    this.p = KEY_LAYOUTS.map((layout, id) => ({
      keys: this.input.keyboard.addKeys(layout),
      col: id === 0 ? 0 : SELECT_GRID.cols - 1, // 1P starts left, 2P right
      row: 0,
      confirmed: false,
    }));

    this.cursorGfx = this.add.graphics().setDepth(15);

    // Small "1P"/"2P" tab that rides above each cursor.
    this.cursorTags = this.p.map((_, id) => this.add
      .text(0, 0, `${id + 1}P`, {
        fontFamily: 'Impact, monospace',
        fontSize: '20px',
        fontStyle: 'bold',
        color: '#ffffff',
        backgroundColor: id === 0 ? '#ff3030' : '#3399ff',
        padding: { x: 5, y: 1 },
      })
      .setOrigin(id === 0 ? 0 : 1, 1)
      .setDepth(16));

    this.p.forEach((_, id) => this.refreshFigure(id));
    this.drawCursors();
  }

  buildGrid() {
    const { cols } = SELECT_GRID;
    const gridW = cols * CELL + (cols - 1) * GAP;
    this.gridX = (this.scale.width - gridW) / 2;
    this.gridY = 210;

    this.cells = SELECT_GRID.cells.map((charKey, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = this.gridX + col * (CELL + GAP);
      const y = this.gridY + row * (CELL + GAP);

      this.add
        .rectangle(x, y, CELL, CELL, 0x0a1430, 0.85)
        .setOrigin(0, 0)
        .setStrokeStyle(2, 0x4466aa)
        .setDepth(4);

      this.addFittedPortrait(CHARACTERS[charKey].portrait, x + 5, y + 5, CELL - 10, CELL - 10, 5);

      return { charKey, x, y };
    });
  }

  // Big full-body standing art on the far left (1P) and far right (2P), plus the
  // corner name plate for each side. No bordered panel — the figure stands free.
  buildSideFigures() {
    const { width } = this.scale;
    const boxW = 360;
    const boxH = 560;
    const boxY = 130;

    this.figures = [
      { boxX: 0, side: 0 },
      { boxX: width - boxW, side: 1 },
    ].map((cfg, id) => {
      const flip = id === 1; // right-side figure faces left
      const figure = this.add
        .image(cfg.boxX + boxW / 2, boxY + boxH, 'kyo-0-0')
        .setOrigin(0.5, 1)
        .setDepth(3);

      const name = this.add
        .text(id === 0 ? 30 : width - 30, 64, '', {
          fontFamily: CN_FONT,
          fontSize: '46px',
          fontStyle: 'bold',
          color: '#eaf2ff',
          stroke: '#16335c',
          strokeThickness: 7,
        })
        .setOrigin(id === 0 ? 0 : 1, 0)
        .setDepth(8);

      const status = this.add
        .text(cfg.boxX + boxW / 2, boxY + 30, '', {
          fontFamily: 'Impact, monospace',
          fontSize: '54px',
          fontStyle: 'bold',
          color: '#39ff6a',
          stroke: '#003311',
          strokeThickness: 6,
        })
        .setOrigin(0.5)
        .setDepth(9);

      return {
        figure, name, status, boxW, boxH, flip,
      };
    });
  }

  buildHints() {
    const { width, height } = this.scale;
    this.add
      .text(width / 2, height - 26,
        '1P:  W S A D 选择   SPACE 确定        2P:  ↑ ↓ ← → 选择   ENTER 确定', {
          fontFamily: CN_FONT,
          fontSize: '22px',
          color: '#dfe8ff',
          stroke: '#000000',
          strokeThickness: 3,
        })
      .setOrigin(0.5, 1)
      .setDepth(8);
  }

  // Draw a texture scaled to fit (contain) inside a box, anchored to its bottom
  // so portraits "stand" on the floor of the cell like in KOF.
  addFittedPortrait(key, x, y, w, h, depth) {
    const img = this.add.image(x + w / 2, y + h, key).setOrigin(0.5, 1).setDepth(depth);
    const src = this.textures.get(key).getSourceImage();
    const scale = Math.min(w / src.width, h / src.height);
    img.setScale(scale);
    return img;
  }

  cellIndex(player) {
    return player.row * SELECT_GRID.cols + player.col;
  }

  // Update a side figure to the fighter the player is hovering / has locked in.
  refreshFigure(id) {
    const player = this.p[id];
    const fig = this.figures[id];
    const char = CHARACTERS[this.cells[this.cellIndex(player)].charKey];

    fig.figure.setTexture(char.portrait);
    const src = this.textures.get(char.portrait).getSourceImage();
    const scale = Math.min(fig.boxW / src.width, fig.boxH / src.height);
    fig.figure.setScale(fig.flip ? -scale : scale, scale);

    fig.name.setText(char.cn || char.name);
    fig.status.setText(player.confirmed ? 'OK!' : '');
  }

  drawCursors() {
    const g = this.cursorGfx;
    g.clear();

    this.p.forEach((player, id) => {
      const cell = this.cells[this.cellIndex(player)];
      // Confirmed cursors draw inset so both players' borders stay visible when
      // they hover the same cell.
      const inset = id === 0 ? 0 : 4;
      const alpha = player.confirmed ? 1 : 0.9;
      g.lineStyle(4, CURSOR_COLORS[id], alpha);
      g.strokeRect(cell.x - inset, cell.y - inset, CELL + inset * 2, CELL + inset * 2);

      if (player.confirmed) {
        g.fillStyle(CURSOR_COLORS[id], 0.25);
        g.fillRect(cell.x, cell.y, CELL, CELL);
      }

      // Park 1P's tab on the cell's top-left, 2P's on the top-right.
      const tag = this.cursorTags[id];
      tag.x = id === 0 ? cell.x - inset : cell.x + CELL + inset;
      tag.y = cell.y - inset + 1;
    });
  }

  update() {
    if (this.starting) return;

    let changed = false;
    this.p.forEach((player, id) => {
      changed = this.handlePlayer(player, id) || changed;
    });

    if (changed) this.drawCursors();

    if (this.p.every((player) => player.confirmed)) this.startFight();
  }

  handlePlayer(player, id) {
    const k = player.keys;
    let changed = false;

    if (player.confirmed) {
      if (JustDown(k.cancel)) {
        player.confirmed = false;
        this.refreshFigure(id);
        changed = true;
      }
      return changed;
    }

    const { cols, rows } = SELECT_GRID;
    if (JustDown(k.left) && player.col > 0) { player.col -= 1; changed = true; }
    if (JustDown(k.right) && player.col < cols - 1) { player.col += 1; changed = true; }
    if (JustDown(k.up) && player.row > 0) { player.row -= 1; changed = true; }
    if (JustDown(k.down) && player.row < rows - 1) { player.row += 1; changed = true; }

    if (JustDown(k.confirm)) {
      player.confirmed = true;
      changed = true;
    }

    if (changed) this.refreshFigure(id);
    return changed;
  }

  startFight() {
    this.starting = true;

    const selections = this.p.map((player) => this.cells[this.cellIndex(player)].charKey);

    const flash = this.add
      .text(this.scale.width / 2, this.scale.height / 2, 'FIGHT!', {
        fontFamily: 'Impact, monospace',
        fontSize: '120px',
        fontStyle: 'bold',
        color: '#ffffff',
        stroke: '#c01b1b',
        strokeThickness: 14,
      })
      .setOrigin(0.5)
      .setDepth(30);
    flash.setScale(0.5);
    this.tweens.add({ targets: flash, scale: 1, duration: 350, ease: 'Back.out' });

    this.time.delayedCall(700, () => this.scene.start('fight', { selections }));
  }
}
