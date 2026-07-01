import Player from './Player.js';
import { STATUS } from '../config/combat.js';
import { getGeneratedCharacter } from '../state/generatedCharacters.js';

// A data-driven fighter built from an AI-generated manifest. All of its art and
// per-state animation metadata come from the generated-character registry (populated by
// services/generatedCharacters.loadGeneratedCharacter); this class wires that metadata
// into the Player FSM and computes how the full-body sprite sits on the hitbox.
export default class GeneratedFighter extends Player {
  constructor(scene, info) {
    const id = info.charKey;
    super(scene, { ...info, texturePrefix: id });
    this.entry = getGeneratedCharacter(id);
    this.moveData = this.entry ? this.entry.moves : {};
    this.init_animations();

    // Play the entrance pose once on spawn; it self-terminates back to idle.
    if (this.animations.has(STATUS.INTRO)) {
      this.status = STATUS.INTRO;
      this.frame_current_cnt = 0;
    }
  }

  init_animations() {
    const entry = this.entry;
    if (!entry) return;

    // Fit the full-body art so its feet rest on the hitbox bottom and it stands
    // a little taller than the hitbox (head/feet show above/below). Centre it
    // horizontally over the hitbox.
    const displayH = this.height * 1.4;
    const scale = displayH / entry.srcH;
    const offsetY = this.height - entry.srcH * scale; // negative: art rises above
    const offsetX = (this.width - entry.srcW * scale) / 2;

    for (const [stateStr, meta] of Object.entries(entry.animMeta)) {
      const state = Number(stateStr);
      // The super (大招) is a cinematic full-screen move: it is NOT scaled to the
      // hitbox or mirrored — Player.render() stretches it to cover the stage. We
      // just pass its own source size through for that cover-fit.
      if (meta.fullscreen) {
        this.animations.set(state, {
          frame_cnt: meta.frame_cnt,
          frame_rate: meta.frame_rate,
          playback: meta.playback,
          fullscreen: true,
          srcW: meta.srcW,
          srcH: meta.srcH,
        });
        continue;
      }
      this.animations.set(state, {
        frame_cnt: meta.frame_cnt,
        frame_rate: meta.frame_rate,
        playback: meta.playback,
        offset_y: offsetY,
        offset_x: offsetX,
        scale,
      });
    }
  }
}
