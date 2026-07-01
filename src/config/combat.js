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

// Scales fighter art, hitboxes, reach and floor placement as one unit.
export const CHARACTER_SCALE = 1.6;
