import Phaser from 'phaser';

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

    this.add
      .text(width / 2, height / 2 - 110, 'THE KING OF', {
        fontFamily: 'Impact, monospace',
        fontSize: '64px',
        color: '#ffd23f',
        stroke: '#7a1f1f',
        strokeThickness: 8,
      })
      .setOrigin(0.5);

    this.add
      .text(width / 2, height / 2 - 20, 'FIGHTERS  AI', {
        fontFamily: 'Impact, monospace',
        fontSize: '96px',
        fontStyle: 'bold',
        color: '#ffffff',
        stroke: '#c01b1b',
        strokeThickness: 12,
      })
      .setOrigin(0.5);

    const prompt = this.add
      .text(width / 2, height / 2 + 120, 'PRESS  ENTER  TO  START', {
        fontFamily: 'monospace',
        fontSize: '36px',
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
        fontFamily: 'monospace',
        fontSize: '20px',
        color: '#aabbcc',
      })
      .setOrigin(0.5);

    const start = () => this.scene.start('select');
    this.input.keyboard.once('keydown-ENTER', start);
    this.input.keyboard.once('keydown-SPACE', start);
    this.input.once('pointerdown', start);
  }
}
