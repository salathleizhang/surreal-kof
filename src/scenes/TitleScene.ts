import Phaser from 'phaser';
import { PIXEL_FONT } from '../fonts.ts';
import { setVerticalGradient } from '../utils/text.ts';
import { playUi, startMenuBgm } from '../audio.ts';
import { SCENE_KEYS } from '../config/game.ts';

const { JustDown, KeyCodes } = Phaser.Input.Keyboard;
const BACKGROUND_FRAME_MS = 100;

// Start screen: the stage art behind a KOF-style logo and a play-mode menu.
// 1 PLAYER pits 1P against a CPU; 2 PLAYERS is the original human-vs-human mode.
const MENU = [
  { label: '1  PLAYER', mode: 'single' },
  { label: '2  PLAYERS', mode: 'versus' },
];

export default class TitleScene extends Phaser.Scene {
  // Scene-local UI handles are created dynamically in create().
  [key: string]: any;
  constructor() {
    super(SCENE_KEYS.TITLE);
  }

  create() {
    const { width, height } = this.scale;

    this.createBackground(width, height);

    this.add
      .image(width / 2, 150, 'title-logo')
      .setOrigin(0.5)
      .setDisplaySize(430, 430)
      .setDepth(2);

    const kingOf = this.add
      .text(width / 2, height / 2 + 18, 'THE KING OF', {
        fontFamily: PIXEL_FONT,
        fontSize: '24px',
        stroke: '#7a1f1f',
        strokeThickness: 5,
      })
      .setOrigin(0.5)
      .setDepth(3);
    // Metallic gold: bright highlight at top fading to a dark amber base.
    setVerticalGradient(kingOf, ['#fff7c0', '#ffd23f', '#b8741a']);

    const fighters = this.add
      .text(width / 2, height / 2 + 62, 'FIGHTERS  AI', {
        fontFamily: PIXEL_FONT,
        fontSize: '38px',
        fontStyle: 'bold',
        stroke: '#c01b1b',
        strokeThickness: 7,
      })
      .setOrigin(0.5)
      .setDepth(3);
    // Chrome white fading into a cool steel blue.
    setVerticalGradient(fighters, ['#ffffff', '#e6f0ff', '#7fb0e0']);

    // Play-mode menu (navigate with W/S or ↑/↓, confirm with Enter/Space).
    this.selected = 0;
    this.menuItems = MENU.map((item, i) => this.add
      .text(width / 2, height / 2 + 132 + i * 54, item.label, {
        fontFamily: PIXEL_FONT,
        fontSize: '30px',
        fontStyle: 'bold',
        color: '#ffffff',
      })
      .setOrigin(0.5));

    // Pulsing highlight on the active item (alpha is applied in update()).
    this.pulse = { v: 1 };
    this.tweens.add({
      targets: this.pulse,
      v: 0.4,
      duration: 500,
      yoyo: true,
      repeat: -1,
    });

    this.add
      .text(width / 2, height - 40, '1P:  W A S D  +  SPACE        2P:  ARROWS  +  ENTER', {
        fontFamily: PIXEL_FONT,
        fontSize: '14px',
        color: '#aabbcc',
      })
      .setOrigin(0.5);

    this.keys = this.input.keyboard.addKeys({
      up: KeyCodes.UP, w: KeyCodes.W,
      down: KeyCodes.DOWN, s: KeyCodes.S,
      enter: KeyCodes.ENTER, space: KeyCodes.SPACE,
    });

    this.locked = false;
    this.refreshMenu();

    // Menu theme: starts here and keeps playing through the select screen.
    startMenuBgm(this);
  }

  createBackground(width, height) {
    const bg = this.add
      .image(width / 2, height, 'bg-0')
      .setOrigin(0.5, 1)
      .setDepth(0)
      .setTint(0x556699); // darken/cool the stage so the logo reads

    const scale = Math.max(width / bg.width, height / bg.height);
    bg.setScale(scale);

    const frameCount = this.registry.get('bgFrameCount') || 1;
    if (frameCount <= 1) return;

    let frame = 0;
    this.time.addEvent({
      delay: BACKGROUND_FRAME_MS,
      loop: true,
      callback: () => {
        frame = (frame + 1) % frameCount;
        bg.setTexture(`bg-${frame}`);
      },
    });
  }

  refreshMenu() {
    this.menuItems.forEach((item, i) => {
      const active = i === this.selected;
      item.setColor(active ? '#ffd23f' : '#8a93a6');
      item.setScale(active ? 1.12 : 1);
    });
  }

  move(delta) {
    this.selected = (this.selected + delta + MENU.length) % MENU.length;
    this.refreshMenu();
    playUi(this, 'cursor');
  }

  confirm() {
    this.locked = true;
    // The first keypress here is also the gesture that unlocks the browser's
    // audio context. Just a crisp cursor blip on confirm — the "Round 1, Ready
    // Go!" announcer is saved for the fight scene, not the menus.
    playUi(this, 'cursor');
    this.scene.start(SCENE_KEYS.CHARACTER_SELECT, { mode: MENU[this.selected].mode });
  }

  update() {
    if (this.locked) return;
    const k = this.keys;
    if (JustDown(k.up) || JustDown(k.w)) this.move(-1);
    if (JustDown(k.down) || JustDown(k.s)) this.move(1);
    if (JustDown(k.enter) || JustDown(k.space)) this.confirm();

    // Pulse the active item; keep the rest fully opaque.
    this.menuItems.forEach((item, i) => item.setAlpha(i === this.selected ? this.pulse.v : 1));
  }
}
