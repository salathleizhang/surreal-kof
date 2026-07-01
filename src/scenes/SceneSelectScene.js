import Phaser from 'phaser';
import { getCharacter, DEFAULT_CHARACTER } from '../objects/roster.js';
import {
  STAGES, STAGE_ORDER, DEFAULT_STAGE,
} from '../data/stages.js';
import { PIXEL_FONT, PIXEL_FONT_CN } from '../fonts.js';
import { setVerticalGradient } from '../utils/text.js';
import { playUi, startMenuBgm } from '../audio.js';
import { SCENE_KEYS } from '../config/game.js';

const { JustDown } = Phaser.Input.Keyboard;
const { KeyCodes } = Phaser.Input.Keyboard;

const CN_FONT = PIXEL_FONT_CN;

// The stage is one shared choice. W/up flips to the previous stage, S/down to the
// next, and SPACE/ENTER locks it in; SHIFT/Backspace hops back to member select.

// This screen reuses the member-select art (select-scene.png), but a blue base
// can't be turned red by a multiply tint (it just goes dark), so instead we lay
// a translucent red "gel" over it — that reliably recolours any background red
// while keeping a hint of the underlying texture.
const RED_GEL = 0xc01818;
const RED_GEL_ALPHA = 0.55;

// The flip card (one large stage preview) and the decorative deck behind it.
const CARD_W = 600;
const CARD_H = 320;
const CARD_Y = 372;
const FLIP_MS = 140; // half a flip (collapse, then expand the next page)

export default class SceneSelectScene extends Phaser.Scene {
  constructor() {
    super(SCENE_KEYS.STAGE_SELECT);
  }

  create(data) {
    const { width, height } = this.scale;

    this.mode = (data && data.mode) || 'versus';
    this.selections = (data && data.selections) || [DEFAULT_CHARACTER, DEFAULT_CHARACTER];

    this.add
      .image(0, 0, 'select-scene')
      .setOrigin(0, 0)
      .setDisplaySize(width, height)
      .setDepth(0);
    // Red gel: a flat translucent red sheet that tints the whole screen red.
    this.add
      .rectangle(0, 0, width, height, RED_GEL, RED_GEL_ALPHA)
      .setOrigin(0, 0)
      .setDepth(0.5);

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
    setVerticalGradient(title, ['#fff0d6', '#ff7f7f', '#9c1f1f']);
    this.title = title;

    this.buildSideFigures();
    this.buildDeck();
    this.buildHints();

    this.sceneIndex = 0;
    this.flipping = false;
    this.starting = false;
    this.applyCard();

    this.keys = this.input.keyboard.addKeys({
      w: KeyCodes.W, s: KeyCodes.S, up: KeyCodes.UP, down: KeyCodes.DOWN,
      space: KeyCodes.SPACE, enter: KeyCodes.ENTER,
      shift: KeyCodes.SHIFT, backspace: KeyCodes.BACKSPACE,
    });

    this.playIntro();
    startMenuBgm(this);
  }

  // KOF-style entrance, mirroring the member select screen: the title + flip deck
  // drop in from the top, the two side figures slide in from the edges, and the
  // control hints rise up from the bottom. Input is locked until it finishes.
  playIntro() {
    this.introActive = true;
    const { width, height } = this.scale;

    const topTargets = [this.title, ...this.deckObjects];
    topTargets.forEach((o) => { o.y -= height; });
    this.tweens.add({
      targets: topTargets,
      y: `+=${height}`,
      duration: 600,
      ease: 'Back.out',
      onComplete: () => { this.introActive = false; },
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

  // The flip deck: a couple of decorative "pages" peeking out behind the top
  // card (receding upward, like a stack), then the live card itself — a framed
  // stage preview with the stage name and a page indicator beneath it.
  buildDeck() {
    const { width } = this.scale;
    const cx = width / 2;
    this.cardHomeY = CARD_Y;
    this.deckObjects = [];

    // Back pages of the stack (purely decorative), kept in the red/white palette.
    [2, 1].forEach((i) => {
      const r = this.add
        .rectangle(cx, CARD_Y - i * 26, CARD_W - i * 64, CARD_H, 0x240808, 0.85)
        .setStrokeStyle(2, 0x9a3a3a)
        .setDepth(4 - i * 0.1);
      this.deckObjects.push(r);
    });

    // The live card is a container so the whole thing flips as one unit.
    const frame = this.add
      .rectangle(0, 0, CARD_W, CARD_H, 0x300a0a, 0.92)
      .setStrokeStyle(3, 0xffffff);
    this.cardThumb = this.add.image(0, 0, STAGES[DEFAULT_STAGE].texture).setOrigin(0.5);
    this.cardName = this.add
      .text(0, CARD_H / 2 + 14, '', {
        fontFamily: CN_FONT,
        fontSize: '34px',
        fontStyle: 'bold',
        color: '#ffeaea',
        stroke: '#5c1616',
        strokeThickness: 6,
      })
      .setOrigin(0.5, 0);
    this.card = this.add
      .container(cx, CARD_Y, [frame, this.cardThumb, this.cardName])
      .setDepth(5);
    this.deckObjects.push(this.card);

    // Page indicator sits below the deck and doesn't flip with the card.
    this.pageText = this.add
      .text(cx, CARD_Y + CARD_H / 2 + 64, '', {
        fontFamily: PIXEL_FONT,
        fontSize: '22px',
        color: '#ffd0d0',
        stroke: '#000000',
        strokeThickness: 3,
      })
      .setOrigin(0.5, 0)
      .setDepth(5);
    this.deckObjects.push(this.pageText);
  }

  // The two fighters picked on the member screen stand on the far edges, keeping
  // the visual language consistent across both select steps.
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
      const char = getCharacter(this.selections[id]) || getCharacter(DEFAULT_CHARACTER);

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
        'W S / ↑ ↓ 翻页切换场景      SPACE / ENTER 确定      SHIFT 返回', {
          fontFamily: CN_FONT,
          fontSize: '22px',
          color: '#ffe2e2',
          stroke: '#000000',
          strokeThickness: 3,
        })
      .setOrigin(0.5, 1)
      .setDepth(8);
  }

  // Paint the current stage onto the live card: fit its thumbnail inside the
  // frame, set its name, and update the page indicator.
  applyCard() {
    const scene = STAGES[STAGE_ORDER[this.sceneIndex]];
    this.cardThumb.setTexture(scene.texture);
    const src = this.textures.get(scene.texture).getSourceImage();
    const s = Math.min((CARD_W - 24) / src.width, (CARD_H - 24) / src.height);
    this.cardThumb.setScale(s);
    this.cardName.setText(scene.cn);
    this.pageText.setText(`${this.sceneIndex + 1} / ${STAGE_ORDER.length}`);
    this.game.canvas.setAttribute(
      'aria-label', `场景选择：${scene.cn}（${this.sceneIndex + 1}/${STAGE_ORDER.length}）`,
    );
  }

  // Page-flip: collapse the card vertically (scaleY → 0) while nudging it in the
  // flip direction, swap in the next stage at the fold, then expand back open.
  flipTo(delta) {
    if (this.flipping) return;
    this.flipping = true;
    const n = STAGE_ORDER.length;

    this.tweens.add({
      targets: this.card,
      scaleY: 0,
      y: this.cardHomeY - delta * 36,
      duration: FLIP_MS,
      ease: 'Quad.in',
      onComplete: () => {
        this.sceneIndex = (this.sceneIndex + delta + n) % n;
        this.applyCard();
        this.card.y = this.cardHomeY + delta * 36;
        this.tweens.add({
          targets: this.card,
          scaleY: 1,
          y: this.cardHomeY,
          duration: FLIP_MS,
          ease: 'Quad.out',
          onComplete: () => { this.flipping = false; },
        });
      },
    });

    playUi(this, 'cursor');
  }

  update() {
    if (this.starting || this.introActive || this.flipping) return;

    const k = this.keys;
    const up = JustDown(k.w) || JustDown(k.up);
    const down = JustDown(k.s) || JustDown(k.down);
    const confirm = JustDown(k.space) || JustDown(k.enter);
    const cancel = JustDown(k.shift) || JustDown(k.backspace);

    if (cancel) {
      playUi(this, 'cancel');
      this.scene.start(SCENE_KEYS.CHARACTER_SELECT, { mode: this.mode });
    } else if (confirm) {
      this.startFight();
    } else if (up) {
      this.flipTo(-1);
    } else if (down) {
      this.flipTo(1);
    }
  }

  startFight() {
    this.starting = true;
    const sceneKey = STAGE_ORDER[this.sceneIndex] || DEFAULT_STAGE;

    playUi(this, 'select');

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

    this.time.delayedCall(700, () => this.scene.start(SCENE_KEYS.FIGHT, {
      selections: this.selections,
      mode: this.mode,
      scene: sceneKey,
    }));
  }
}
