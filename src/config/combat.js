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
});

// High-level combat state. Animation states above remain numeric because they
// are part of the existing texture keys, while gameplay code uses these values
// to decide whether a fighter can act, is airborne, or has been defeated.
export const FIGHTER_STATE = Object.freeze({
  NEUTRAL: 'neutral',
  AIRBORNE: 'airborne',
  ATTACKING: 'attacking',
  HITSTUN: 'hitstun',
  DEAD: 'dead',
});

// Scales fighter art, hitboxes, reach and floor placement as one unit.
export const CHARACTER_SCALE = 1.6;
