import Phaser from 'phaser';
import { PIXEL_FONT } from '../fonts.js';
import { setVerticalGradient } from '../utils/text.js';
import { playUi } from '../audio.js';

// Start screen: the stage art behind a KOF-style logo and a blinking prompt.
// Any of Enter / Space / click advances to the character select.
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

    const prompt = this.add
      .text(width / 2, height / 2 + 120, 'PRESS  ENTER  TO  START', {
        fontFamily: PIXEL_FONT,
        fontSize: '24px',
        fontStyle: 'bold',
        color: '#ffffff',
      })
      .setOrigin(0.5);

    // Blinking prompt.
    this.tweens.add({
      targets: prompt,
      alpha: 0,
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

    // The first keypress/click here is also the user gesture that unlocks the
    // browser's audio context, so this is the earliest a sound can be heard.
    const start = () => {
      playUi(this, 'start');
      this.scene.start('select');
    };
    this.input.keyboard.once('keydown-ENTER', start);
    this.input.keyboard.once('keydown-SPACE', start);
    this.input.once('pointerdown', start);
  }
}
