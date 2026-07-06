// Finite-state machine states shared by fighters, AI and fight orchestration.
export const STATUS = Object.freeze({
  IDLE: 0,
  MOVE: 1,
  BACKWARD: 2,
  JUMP: 3,
  ATTACK: 4,
  HIT: 5,
  DEATH: 6,
  ATTACK2: 7,
  SUPER: 8,
  INTRO: 9,
  GUARD: 10,
});

// High-level combat state. Animation states above remain numeric because they
// are part of the existing texture keys, while gameplay code uses these values
// to decide whether a fighter can act, is airborne, or has been defeated.
export const FIGHTER_STATE = Object.freeze({
  NEUTRAL: 'neutral',
  AIRBORNE: 'airborne',
  ATTACKING: 'attacking',
  GUARDING: 'guarding',
  HITSTUN: 'hitstun',
  DEAD: 'dead',
});

export const DEFAULT_MAX_RAGE = 100;
export const DEFAULT_RAGE_GAIN_PER_HIT = 25;

// Baseline per-move damage used whenever a character's manifest doesn't
// override a move (manifest `moves.<id>.damage` always wins when present).
export const DEFAULT_DAMAGE = Object.freeze({
  attack1: 12,
  attack2: 16,
  super: 30,
});

// Consecutive-hit damage decay applied while a defender has not yet returned
// to NEUTRAL. Index 0 = 1st hit in the chain (no decay); multiplier floors
// out at the last array value for any hit count beyond the array length.
export const COMBO_DECAY = Object.freeze({
  multipliers: [1, 0.85, 0.7, 0.6, 0.5],
  floor: 0.5,
});

// Scales fighter art, hitboxes, reach and floor placement as one unit.
export const CHARACTER_SCALE = 1.6;
