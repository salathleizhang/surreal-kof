import Phaser from 'phaser';
import { getCharacter, SELECT_GRID } from '../objects/roster.ts';
import { loadGeneratedCharacter } from '../services/generatedCharacters.ts';
import { listGeneratedCharacters } from '../state/generatedCharacters.ts';
import { PIXEL_FONT, PIXEL_FONT_CN } from '../fonts.ts';
import { setVerticalGradient } from '../utils/text.ts';
import { playUi, startMenuBgm } from '../audio.ts';
import { SCENE_KEYS } from '../config/game.ts';

// The grid cell that opens the "create custom fighter" modal instead of being a
// selectable character.
const ADD_KEY = '__add__';

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

const CURSOR_COLORS = [0xff3030, 0x3399ff]; // 1P red, 2P blue — used for tags/fill
const CURSOR_BORDER = 0xffffff; // white selection border (KOF-style)
const CN_FONT = PIXEL_FONT_CN; // pixel font for Latin/digits, CJK fallback for Chinese

// Compact center grid (the big standing art lives on the screen edges instead
// of in bottom panels).
const CELL = 88;
const GAP = 12;

export default class SelectScene extends Phaser.Scene {
  // Scene-local UI handles are created dynamically in create().
  [key: string]: any;
  constructor() {
    super(SCENE_KEYS.CHARACTER_SELECT);
  }

  create(data) {
    const { width, height } = this.scale;
    this.game.canvas.setAttribute('aria-label', '角色选择界面');

    // 'single' = 1P vs CPU, 'versus' = two humans (the original mode).
    this.mode = (data && data.mode) || 'versus';

    this.add
      .image(0, 0, 'select-bg')
      .setOrigin(0, 0)
      .setDisplaySize(width, height)
      .setDepth(0);

    const title = this.add
      .text(width / 2, 36, '角色选择', {
        fontFamily: CN_FONT,
        fontSize: '52px',
        fontStyle: 'bold',
        stroke: '#10324a',
        strokeThickness: 8,
      })
      .setOrigin(0.5, 0)
      .setDepth(5);
    // Bright aqua fading into a deeper teal.
    setVerticalGradient(title, ['#d6fff4', '#7fffd4', '#1f9c84']);
    this.title = title;

    this.initCellChars();
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
      isCpu: false,
    }));

    // In single-player mode 2P is the CPU. Instead of snapping straight to a
    // fighter, it pretends to be a human picking: once the intro finishes it
    // wanders the grid for a few random hops (see maybeStartCpuSelection) and
    // then locks in whatever it landed on.
    if (this.mode === 'single') {
      const cpu = this.p[1];
      cpu.isCpu = true;
      cpu.confirmed = false;
      cpu.col = Phaser.Math.Between(0, SELECT_GRID.cols - 1);
      cpu.row = Phaser.Math.Between(0, SELECT_GRID.rows - 1);
    }

    this.cursorGfx = this.add.graphics().setDepth(15);

    // Small "1P"/"2P"/"CPU" tab that rides above each cursor.
    this.cursorTags = this.p.map((player, id) => this.add
      .text(0, 0, player.isCpu ? 'CPU' : `${id + 1}P`, {
        fontFamily: PIXEL_FONT,
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

    // Slide everything in from off-screen before handing control to the players.
    this.playIntro();

    // Keep the menu theme going (no-op if it's already playing from the title).
    startMenuBgm(this);

    // Browser QA can enter the DOM wizard directly while still exercising the
    // real scene integration. Both flags are development-only.
    const params = new URLSearchParams(globalThis.location?.search || '');
    if (import.meta.env.DEV && params.get('openCreator') === '1') {
      this.time.delayedCall(900, () => this.openCreateModal());
    }
  }

  // KOF-style entrance: the title + grid drop in from the top, the two side
  // figures (with their name plates) slide in from the left and right, and the
  // control hints rise up from the bottom. Input is locked until it finishes.
  playIntro() {
    this.introActive = true;
    const { width, height } = this.scale;

    // Cursors and tags stay hidden until the grid has landed.
    this.cursorGfx.setAlpha(0);
    this.cursorTags.forEach((tag) => tag.setAlpha(0));

    // Top: title + every grid cell/portrait drop down into place.
    const topTargets = [this.title, ...this.gridObjects];
    topTargets.forEach((o) => { o.y -= height; });
    this.tweens.add({
      targets: topTargets,
      y: `+=${height}`,
      duration: 600,
      ease: 'Back.out',
      onComplete: () => {
        this.tweens.add({
          targets: [this.cursorGfx, ...this.cursorTags],
          alpha: 1,
          duration: 200,
        });
        this.introActive = false;
        this.maybeStartCpuSelection();
      },
    });

    // Sides: each figure + its name plate + status slide in horizontally.
    this.figures.forEach((fig, id) => {
      const dir = id === 0 ? -1 : 1; // 1P from the left, 2P from the right
      const targets = [fig.figure, fig.name, fig.status];
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

    // Bottom: the control hints rise up into view.
    this.hints.y += 120;
    this.tweens.add({
      targets: this.hints,
      y: `-=120`,
      duration: 600,
      ease: 'Back.out',
      delay: 240,
    });
  }

  // Lay out which character (or the "+" add button) sits in each grid cell. The
  // bottom-right cell is always the add button; generated fighters fill the
  // slots after Kyo, the rest stay Kyo so the screen keeps its full KOF look.
  initCellChars() {
    const total = SELECT_GRID.cols * SELECT_GRID.rows;
    this.cellChars = new Array(total).fill('kyo');
    this.addIndex = total - 1;
    this.cellChars[this.addIndex] = ADD_KEY;
    this.nextSlot = 1; // first free slot for a generated fighter
    // Seed any fighters already loaded this session (e.g. from the preloader).
    for (const entry of listGeneratedCharacters()) this.assignSlot(entry.id);
  }

  // Claim the next free cell for a generated fighter id; returns its index or -1
  // when the grid is full. Only mutates the data array — cells are painted later.
  assignSlot(id) {
    const existing = this.cellChars.indexOf(id);
    if (existing >= 0) return existing;
    if (this.nextSlot >= this.addIndex) return -1;
    const slot = this.nextSlot;
    this.cellChars[slot] = id;
    this.nextSlot += 1;
    return slot;
  }

  buildGrid() {
    const { cols } = SELECT_GRID;
    const gridW = cols * CELL + (cols - 1) * GAP;
    this.gridX = (this.scale.width - gridW) / 2;
    this.gridY = 210;

    // Collected so the intro can slide every cell/portrait in together.
    this.gridObjects = [];

    this.cells = this.cellChars.map((charKey, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = this.gridX + col * (CELL + GAP);
      const y = this.gridY + row * (CELL + GAP);

      const rect = this.add
        .rectangle(x, y, CELL, CELL, 0x0a1430, 0.85)
        .setOrigin(0, 0)
        .setStrokeStyle(2, 0x4466aa)
        .setDepth(4);

      const cell = {
        charKey, x, y, rect, portrait: null,
      };
      this.paintCell(cell);
      this.gridObjects.push(rect);
      if (cell.portrait) this.gridObjects.push(cell.portrait);
      return cell;
    });
  }

  // (Re)draw a cell's contents: a "+" for the add button, otherwise the
  // character's portrait (if its texture is loaded).
  paintCell(cell) {
    if (cell.portrait) { cell.portrait.destroy(); cell.portrait = null; }

    if (cell.charKey === ADD_KEY) {
      cell.portrait = this.add
        .text(cell.x + CELL / 2, cell.y + CELL / 2, '＋', {
          fontFamily: PIXEL_FONT, fontSize: '46px', color: '#7fffd4',
        })
        .setOrigin(0.5)
        .setDepth(5);
      return;
    }

    const ch = getCharacter(cell.charKey);
    if (ch && this.textures.exists(ch.portrait)) {
      cell.portrait = this.addFittedPortrait(
        ch.portrait, cell.x + 5, cell.y + 5, CELL - 10, CELL - 10, 5,
      );
    }
  }

  // Called after a fighter finishes generating: drop it into the next free cell
  // and repaint that cell with its fresh portrait.
  addGeneratedCharacter(entry) {
    const slot = this.assignSlot(entry.id);
    if (slot < 0) return;
    const cell = this.cells[slot];
    cell.charKey = entry.id;
    this.paintCell(cell);
    this.drawCursors();
  }

  // Open the DOM modal that drives the generation pipeline. Disabled while one is
  // already open so a player can't stack modals.
  async openCreateModal() {
    if (this.modalOpen) return;
    this.modalOpen = true;
    playUi(this, 'select');
    try {
      const { openCreateCharacterModal } = await import('../ui/CreateCharacterModal.ts');
      const params = new URLSearchParams(globalThis.location?.search || '');
      openCreateCharacterModal({
        // Development-only end-to-end switch: exercises the exact modal/API/
        // asset-loading flow without invoking paid generation models.
        mock: import.meta.env.DEV && params.get('mockCharacter') === '1',
        onComplete: async (manifest) => {
          try {
            const entry = await loadGeneratedCharacter(this, manifest);
            this.addGeneratedCharacter(entry);
          } catch (e) {
            console.error('Failed to load generated character', e);
          }
        },
        onClose: () => { this.modalOpen = false; },
      });
    } catch (error) {
      this.modalOpen = false;
      console.error('Failed to open character creator', error);
    }
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
      const homeX = cfg.boxX + boxW / 2;
      const figure = this.add
        .image(homeX, boxY + boxH, 'kyo-0-0')
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
          fontFamily: PIXEL_FONT,
          fontSize: '54px',
          fontStyle: 'bold',
          stroke: '#003311',
          strokeThickness: 6,
        })
        .setOrigin(0.5)
        .setDepth(9);
      // Empty until confirmed; the gradient is keyed off the font size so it
      // survives the later setText('OK!').
      setVerticalGradient(status, ['#c6ffd6', '#39ff6a', '#11a83f']);

      return {
        figure, name, status, boxW, boxH, flip, homeX,
      };
    });
  }

  buildHints() {
    const { width, height } = this.scale;
    this.hints = this.add
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

  // Snap a side figure to the hovered fighter (texture, scale, name) with no
  // animation — used on first paint and after a confirm/cancel.
  refreshFigure(id) {
    const fig = this.figures[id];
    this.tweens.killTweensOf(fig.figure);
    fig.figure.x = fig.homeX;
    this.applyFigureTexture(id);
    fig.status.setText(this.p[id].confirmed ? 'OK!' : '');
  }

  // Make the CPU look like a human at the select screen: hop around the grid a
  // random number of times (each hop animates + clicks just like a real cursor)
  // and then confirm whatever fighter it ended up on.
  maybeStartCpuSelection() {
    if (this.mode !== 'single') return;
    const id = 1;
    const cpu = this.p[id];
    let movesLeft = Phaser.Math.Between(4, 9);

    const step = () => {
      if (this.starting || cpu.confirmed) return;
      if (movesLeft > 0) {
        movesLeft -= 1;
        this.cpuRandomMove(id);
        this.time.delayedCall(Phaser.Math.Between(220, 440), step);
      } else {
        // Settle on the current pick — same lock-in as a human pressing confirm.
        cpu.confirmed = true;
        this.refreshFigure(id);
        this.drawCursors();
        playUi(this, 'select');
      }
    };

    // A beat of "thinking" before the first move.
    this.time.delayedCall(Phaser.Math.Between(350, 650), step);
  }

  // Step the CPU cursor one cell in a random valid direction, avoiding an
  // immediate reversal so it reads as deliberate browsing rather than jitter.
  cpuRandomMove(id) {
    const player = this.p[id];
    const { cols, rows } = SELECT_GRID;
    let moves = [];
    if (player.col > 0) moves.push(['col', -1]);
    if (player.col < cols - 1) moves.push(['col', 1]);
    if (player.row > 0) moves.push(['row', -1]);
    if (player.row < rows - 1) moves.push(['row', 1]);

    if (this.cpuLastMove) {
      const [lastAxis, lastDelta] = this.cpuLastMove;
      const noReverse = moves.filter(
        ([axis, delta]) => !(axis === lastAxis && delta === -lastDelta),
      );
      if (noReverse.length) moves = noReverse;
    }
    if (!moves.length) return;

    const move = Phaser.Utils.Array.GetRandom(moves);
    const [axis, delta] = move;
    player[axis] += delta;
    this.cpuLastMove = move;

    this.swapFigure(id);
    playUi(this, 'cursor');
    this.drawCursors();
  }

  applyFigureTexture(id) {
    const fig = this.figures[id];
    const key = this.cells[this.cellIndex(this.p[id])].charKey;

    // The "+" cell has no fighter art — show a prompt instead.
    if (key === ADD_KEY) {
      fig.figure.setVisible(false);
      fig.name.setText('新建角色');
      return;
    }

    const char = getCharacter(key);
    const figureTexture = char?.figure || char?.portrait;
    if (!char || !figureTexture || !this.textures.exists(figureTexture)) {
      fig.figure.setVisible(false);
      fig.name.setText(char ? char.cn || char.name : '');
      return;
    }

    fig.figure.setVisible(true);
    fig.figure.setTexture(figureTexture);
    const src = this.textures.get(figureTexture).getSourceImage();
    const scale = Math.min(fig.boxW / src.width, fig.boxH / src.height);
    fig.figure.setOrigin(0.5, 1);
    fig.figure.setScale(fig.flip ? -scale : scale, scale);
    fig.name.setText(char.cn || char.name);
  }

  // Switching characters: slide the figure left, swap to the newly hovered
  // fighter at the far point, then slide back to its home position.
  swapFigure(id) {
    const fig = this.figures[id];
    this.tweens.killTweensOf(fig.figure);
    fig.figure.x = fig.homeX;
    const dir = id === 0 ? -1 : 1; // 1P slides left, 2P slides right
    this.tweens.add({
      targets: fig.figure,
      x: fig.homeX + dir * 240,
      duration: 150,
      yoyo: true,
      ease: 'Quad.inOut',
      onYoyo: () => this.applyFigureTexture(id),
      onComplete: () => { fig.figure.x = fig.homeX; },
    });
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
      g.lineStyle(4, CURSOR_BORDER, alpha);
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
    if (this.starting || this.introActive) return;

    let changed = false;
    this.p.forEach((player, id) => {
      changed = this.handlePlayer(player, id) || changed;
    });

    if (changed) this.drawCursors();

    if (this.p.every((player) => player.confirmed)) this.startFight();
  }

  handlePlayer(player, id) {
    // The CPU slot in single-player mode takes no input.
    if (player.isCpu) return false;

    const k = player.keys;
    let changed = false;

    if (player.confirmed) {
      if (JustDown(k.cancel)) {
        player.confirmed = false;
        this.refreshFigure(id);
        playUi(this, 'cancel');
        changed = true;
      }
      return changed;
    }

    const { cols, rows } = SELECT_GRID;
    let moved = false;
    if (JustDown(k.left) && player.col > 0) { player.col -= 1; moved = true; }
    if (JustDown(k.right) && player.col < cols - 1) { player.col += 1; moved = true; }
    if (JustDown(k.up) && player.row > 0) { player.row -= 1; moved = true; }
    if (JustDown(k.down) && player.row < rows - 1) { player.row += 1; moved = true; }

    // Switching to a new fighter plays the slide-swap animation.
    if (moved) { this.swapFigure(id); playUi(this, 'cursor'); changed = true; }

    if (JustDown(k.confirm)) {
      const key = this.cells[this.cellIndex(player)].charKey;
      if (key === ADD_KEY) {
        // The "+" cell launches the creation flow instead of locking a pick.
        this.openCreateModal();
      } else {
        player.confirmed = true;
        this.refreshFigure(id); // snap home + show OK!
        playUi(this, 'select');
      }
      changed = true;
    }

    return changed;
  }

  startFight() {
    this.starting = true;
    // Both fighters are locked in; carry the picks to the stage-select screen,
    // which then runs its own FIGHT! flash before handing off to the fight. (No
    // announcer here — the "Round 1, Fight!" cue belongs to the fight scene.)
    const selections = this.p.map((player) => {
      const key = this.cells[this.cellIndex(player)].charKey;
      return key === ADD_KEY ? 'kyo' : key; // the CPU may land on the "+" cell
    });

    this.scene.start(SCENE_KEYS.STAGE_SELECT, { selections, mode: this.mode });
  }
}
