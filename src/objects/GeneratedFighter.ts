import Fighter from '../combat/Fighter.ts';
import { STATUS } from '../config/combat.ts';
import { getGeneratedCharacter } from '../state/generatedCharacters.ts';
import { createGeneratedCombatDefinition } from '../characters/generated/createCombatDefinition.ts';
import type { FighterCreateInfo } from '../combat/Fighter.ts';
import type { GeneratedCharacterEntry, GeneratedMove } from '../types/generatedCharacter.ts';
import type { AnimationDefinition } from '../types/combat.ts';

type GeneratedFighterInfo = Omit<FighterCreateInfo, 'texturePrefix' | 'combat'> & { charKey: string };

// A data-driven fighter built from an AI-generated manifest. All of its art and
// per-state animation metadata come from the generated-character registry (populated by
// services/generatedCharacters.loadGeneratedCharacter); this class wires that metadata
// into the Player FSM and computes how the full-body sprite sits on the hitbox.
export default class GeneratedFighter extends Fighter {
  entry: GeneratedCharacterEntry | null;
  moveData: Record<string, GeneratedMove>;

  constructor(scene: any, info: GeneratedFighterInfo) {
    const id = info.charKey;
    const entry = getGeneratedCharacter(id);
    const combat = createGeneratedCombatDefinition(entry || {});
    super(scene, {
      ...info, texturePrefix: id, combat,
    });
    this.entry = entry;
    this.moveData = this.entry ? this.entry.moves : {};
    this.init_animations();

    // Play the entrance pose once on spawn; it self-terminates back to idle.
    if (this.animations.has(STATUS.INTRO)) {
      this.playState(STATUS.INTRO);
    }
  }

  init_animations(): void {
    const entry = this.entry;
    if (!entry) return;

    // Fit the complete authored frame, including its transparent margins, to the
    // shared fighter height. The generation pipeline owns character framing.
    const displayH = this.height * 1.4;

    for (const [stateStr, meta] of Object.entries(entry.animMeta)) {
      const numericState = Number(stateStr);
      const state = Number.isNaN(numericState) ? stateStr : numericState;
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
      const sourceWidth = meta.srcW || entry.srcW;
      const sourceHeight = meta.srcH || entry.srcH;
      const scale = displayH / Math.max(1, sourceHeight);
      const offsetY = this.height - sourceHeight * scale;
      const offsetX = (this.width - sourceWidth * scale) / 2;
      const animation: AnimationDefinition = {
        frame_cnt: meta.frame_cnt,
        frame_rate: meta.frame_rate,
        // The entrance owns the pre-fight ceremony: play into the authored pose
        // and hold its last frame until FightScene releases both fighters on Go.
        playback: state === STATUS.INTRO ? 'hold' : meta.playback,
        offset_y: offsetY,
        offset_x: offsetX,
        scale,
      };
      if (state === STATUS.SUPER && entry.superBackground) {
        animation.background = { ...entry.superBackground };
      }
      if (meta.dash) animation.dash = meta.dash;
      this.animations.set(state, animation);
    }
  }
}
