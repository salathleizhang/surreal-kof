import { STATUS, CHARACTER_SCALE } from './Player.js';

// Difficulty profile. Tuned to feel like a real fighting-game opponent: it keeps
// spacing, walks in, strikes when you're in range, baits, and hops back out of
// the way of your attacks — but with a human-like reaction delay so it is beatable.
const NORMAL = {
  reactionMs: 420, // how often the AI re-evaluates the situation (higher = slower reflexes)
  attackCooldownMs: 900, // minimum gap between attack attempts (anti-spam)
  aggression: 0.4, // chance to swing when the opponent is in range
  defense: 0.4, // chance to evade an attack it has read
  jumpInChance: 0.1, // chance to hop in while closing distance
  spacingChance: 0.35, // chance to step back in range to bait a whiff
};

// Drives a Player the way a second human would: instead of reading the keyboard,
// the Player asks this controller for a {up,left,right,attack} input each frame.
export default class AiController {
  constructor(player, profile = NORMAL) {
    this.player = player;
    this.scene = player.scene;
    this.cfg = profile;

    this.input = { up: false, left: false, right: false, attack: false };
    this.sinceDecision = profile.reactionMs; // decide on the very first frame
    this.sinceAttack = profile.attackCooldownMs;
  }

  opponent() {
    return this.scene.players[1 - this.player.id];
  }

  // Called by the Player every frame; only re-thinks after the reaction delay so
  // the CPU isn't frame-perfect.
  getInput() {
    const dt = this.player.timedelta || 0;
    this.sinceDecision += dt;
    this.sinceAttack += dt;

    if (this.sinceDecision >= this.cfg.reactionMs) {
      this.sinceDecision = 0;
      this.decide();
    }
    return this.input;
  }

  // Horizontal gap between the two hitboxes (negative if overlapping) and which
  // side the opponent is on.
  geometry() {
    const me = this.player;
    const opp = this.opponent();
    const oppOnRight = opp.x >= me.x;
    const gap = oppOnRight
      ? opp.x - (me.x + me.width)
      : me.x - (opp.x + opp.width);
    return { opp, oppOnRight, gap };
  }

  setMove(toward, oppOnRight) {
    const goRight = toward ? oppOnRight : !oppOnRight;
    this.input.left = !goRight;
    this.input.right = goRight;
  }

  clearMove() {
    this.input.left = false;
    this.input.right = false;
  }

  decide() {
    const me = this.player;

    // Fresh inputs each decision; movement is re-asserted below as needed.
    this.input.up = false;
    this.input.attack = false;
    this.clearMove();

    // Nothing useful to do while stunned, dead, or against a downed opponent.
    if (me.status === STATUS.HIT || me.status === STATUS.DEATH) return;
    const { opp, oppOnRight, gap } = this.geometry();
    if (opp.status === STATUS.DEATH) return;

    // How far the fist reaches past the hitbox (mirrors Player.update_attack());
    // commit a touch inside max reach.
    const attackRange = 100 * CHARACTER_SCALE * 0.9;
    const r = Math.random;

    // Read the opponent's swing: if they're attacking and we're inside their
    // range, hop/step back out of the way most of the time.
    if (opp.status === STATUS.ATTACK && gap < attackRange + 40 && r() < this.cfg.defense) {
      this.setMove(false, oppOnRight);
      if (r() < 0.4) this.input.up = true; // jump back
      return;
    }

    if (gap <= attackRange) {
      if (this.sinceAttack >= this.cfg.attackCooldownMs && r() < this.cfg.aggression) {
        this.input.attack = true;
        this.sinceAttack = 0;
      } else if (r() < this.cfg.spacingChance) {
        this.setMove(false, oppOnRight); // back off to reset spacing / bait
      }
      return; // otherwise hold ground
    }

    if (gap <= attackRange + 220) {
      // Mid range: close in, sometimes leap in to mix up the approach.
      this.setMove(true, oppOnRight);
      if (r() < this.cfg.jumpInChance) this.input.up = true;
      return;
    }

    // Far: walk in, with the occasional jump to cover ground faster.
    this.setMove(true, oppOnRight);
    if (r() < this.cfg.jumpInChance * 0.5) this.input.up = true;
  }
}
