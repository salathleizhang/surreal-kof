import Phaser from 'phaser';
import { PIXEL_FONT } from '../fonts.js';
import { setVerticalGradient } from '../utils/text.js';
import { playUi } from '../audio.js';

const { JustDown, KeyCodes } = Phaser.Input.Keyboard;

// Start screen: the stage art behind a KOF-style logo and a play-mode menu.
// 1 PLAYER pits 1P against a CPU; 2 PLAYERS is the original human-vs-human mode.
const MENU = [
  { label: '1  PLAYER', mode: 'single' },
  { label: '2  PLAYERS', mode: 'versus' },
];

export default class TitleScene extends Phaser.Scene {
  constructor() {
    super('title');
  }

  create() {
    const { width, height } = this.scale;

    this.add
      .image(0, 0, 'bg-0')
      .setOrigin(0, 0)
      .setDisplaySize(width, height)
      .setDepth(0)
      .setTint(0x556699); // darken/cool the stage so the logo reads

    const kingOf = this.add
      .text(width / 2, height / 2 - 110, 'THE KING OF', {
        fontFamily: PIXEL_FONT,
        fontSize: '48px',
        stroke: '#7a1f1f',
        strokeThickness: 8,
      })
      .setOrigin(0.5);
    // Metallic gold: bright highlight at top fading to a dark amber base.
    setVerticalGradient(kingOf, ['#fff7c0', '#ffd23f', '#b8741a']);

    const fighters = this.add
      .text(width / 2, height / 2 - 20, 'FIGHTERS  AI', {
        fontFamily: PIXEL_FONT,
        fontSize: '72px',
        fontStyle: 'bold',
        stroke: '#c01b1b',
        strokeThickness: 12,
      })
      .setOrigin(0.5);
    // Chrome white fading into a cool steel blue.
    setVerticalGradient(fighters, ['#ffffff', '#e6f0ff', '#7fb0e0']);

    // Play-mode menu (navigate with W/S or ↑/↓, confirm with Enter/Space).
    this.selected = 0;
    this.menuItems = MENU.map((item, i) => this.add
      .text(width / 2, height / 2 + 70 + i * 56, item.label, {
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
    // audio context, so this is the earliest a sound can actually be heard.
    playUi(this, 'start');
    this.scene.start('select', { mode: MENU[this.selected].mode });
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
