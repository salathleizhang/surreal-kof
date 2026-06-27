import Player, { CHARACTER_SCALE } from './Player.js';

// Kyo Kusanagi — the one playable character. Each of the seven FSM states has
// its frames pre-registered as textures (`kyo-<state>-<frame>`) by the
// PreloadScene; here we just describe how each state should be rendered.
export default class Kyo extends Player {
  constructor(scene, info) {
    super(scene, { ...info, texturePrefix: 'kyo' });
    this.init_animations();
  }

  init_animations() {
    // Vertical render offset per state (jump art sits much higher, etc.).
    const offsets = [0, -22, -22, -140, 0, 0, 0];
    const frameCounts = this.scene.registry.get('kyoFrameCounts');

    for (let i = 0; i < 7; i += 1) {
      this.animations.set(i, {
        frame_cnt: frameCounts[i],
        // Advance to the next image every `frame_rate` game frames.
        // Jump (state 3) is a touch faster so it reads more smoothly.
        frame_rate: i === 3 ? 4 : 5,
        offset_y: offsets[i] * CHARACTER_SCALE,
        scale: 2 * CHARACTER_SCALE,
      });
    }
  }
}
