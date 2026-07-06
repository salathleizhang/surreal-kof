import { FIGHTER_STATE } from '../config/combat.ts';

// Difficulty profile. Tuned to feel like a real fighting-game opponent: it keeps
// spacing, walks in, strikes when you're in range, baits, and hops back out of
// the way of your attacks — but with a human-like reaction delay so it is beatable.
const NORMAL = {
  reactionMs: 320, // how often the AI re-evaluates the situation (higher = slower reflexes)
  attackCooldownMs: 750, // minimum gap between attack attempts (anti-spam)
  aggression: 0.5, // chance to swing when the opponent is in range
  defense: 0.55, // chance to guard or evade an attack it has read
  jumpInChance: 0.12, // chance to hop in while closing distance
  spacingChance: 0.3, // chance to step back in range to bait a whiff
  attack2Chance: 0.3, // chance to mix in the secondary attack instead of the primary
};

// Drives a Player the way a second human would: instead of reading the keyboard,
// the Player asks this controller for directional/action input each frame.
export default class AiController {
  player: Fighter;
  scene: any;
  cfg: AiProfile;
  input: FighterInput;
  sinceDecision: number;
  sinceAttack: number;
  oppWasAttacking: boolean;

  constructor(player: Fighter, profile: AiProfile = NORMAL) {
    this.player = player;
    this.scene = player.scene;
    this.cfg = profile;

    this.input = {
      up: false, down: false, left: false, right: false, attack: false, attack2: false, special: false,
    };
    this.sinceDecision = profile.reactionMs; // decide on the very first frame
    this.sinceAttack = profile.attackCooldownMs;
    this.oppWasAttacking = false;
  }

  opponent(): Fighter {
    return this.scene.players[1 - this.player.id] as Fighter;
  }

  // Called by the Player every frame; only re-thinks after the reaction delay so
  // the CPU isn't frame-perfect.
  getInput(): FighterInput {
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
  geometry(): { opp: Fighter; oppOnRight: boolean; gap: number } {
    const me = this.player;
    const opp = this.opponent();
    const myBox = me.getPushbox();
    const oppBox = opp.getPushbox();
    const oppOnRight = oppBox.x >= myBox.x;
    const gap = oppOnRight
      ? oppBox.x - (myBox.x + myBox.width)
      : myBox.x - (oppBox.x + oppBox.width);
    return { opp, oppOnRight, gap };
  }

  setMove(toward: boolean, oppOnRight: boolean): void {
    const goRight = toward ? oppOnRight : !oppOnRight;
    this.input.left = !goRight;
    this.input.right = goRight;
  }

  clearMove(): void {
    this.input.left = false;
    this.input.right = false;
  }

  decide(): void {
    const me = this.player;

    // Fresh inputs each decision; movement is re-asserted below as needed.
    this.input.up = false;
    this.input.down = false;
    this.input.attack = false;
    this.input.attack2 = false;
    this.input.special = false;
    this.clearMove();

    // Nothing useful to do while stunned, dead, or against a downed opponent.
    if (!me.canStartSkill()) return;
    const { opp, oppOnRight, gap } = this.geometry();
    if (opp.isDead()) return;

    // Ask the equipped primary skill for its preferred range, so a character's
    // AI spacing follows its own combat definition instead of a global fist box.
    const attackRange = Math.max(1, me.getSkillRange('attack') * 0.9);
    const r = Math.random;

    // Remember whether the opponent was mid-swing last time we looked, so a
    // swing that just ended (their recovery) can be told apart from one that
    // never started — that's what makes the whiff punish below possible.
    const oppAttackingNow = opp.skillRunner.isActive;
    const oppJustWhiffed = this.oppWasAttacking && !oppAttackingNow;
    this.oppWasAttacking = oppAttackingNow;

    // Read the opponent's swing: if they're attacking and we're inside their
    // range, usually crouch-back to guard; occasionally hop/step back instead.
    if (oppAttackingNow && gap < attackRange + 40 && r() < this.cfg.defense) {
      this.setMove(false, oppOnRight);
      if (r() < 0.65) this.input.down = true;
      else if (r() < 0.4) this.input.up = true; // jump back
      return;
    }

    // Punish: the opponent's attack just ended and we're already in range —
    // swing immediately instead of rolling the usual cooldown/aggression check.
    if (oppJustWhiffed && gap <= attackRange) {
      this.throwAttack(me);
      return;
    }

    // Anti-air: the opponent is jumping in and about to land in range while we
    // stay grounded — meet them with a hit instead of just walking forward.
    if (
      opp.combatState === FIGHTER_STATE.AIRBORNE
      && me.combatState !== FIGHTER_STATE.AIRBORNE
      && gap <= attackRange + 80
      && this.sinceAttack >= this.cfg.attackCooldownMs * 0.5
    ) {
      this.throwAttack(me);
      return;
    }

    if (gap <= attackRange) {
      if (this.sinceAttack >= this.cfg.attackCooldownMs && r() < this.cfg.aggression) {
        this.throwAttack(me);
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

  // Picks which button to press for an in-range swing: a fully charged rage
  // super takes priority, otherwise mix the primary and secondary attack so
  // the AI doesn't throw the exact same move every time.
  throwAttack(me: Fighter): void {
    const r = Math.random;
    const superSkill = me.skillRunner.getSkillByInput('special');
    const attack2Skill = me.skillRunner.getSkillByInput('attack2');
    if (superSkill && me.canUseSkill(superSkill) && me.isRageFull()) {
      this.input.special = true;
    } else if (attack2Skill && me.canUseSkill(attack2Skill) && r() < this.cfg.attack2Chance) {
      this.input.attack2 = true;
    } else {
      this.input.attack = true;
    }
    this.sinceAttack = 0;
  }
}
import type Fighter from '../combat/Fighter.ts';

interface AiProfile {
  reactionMs: number;
  attackCooldownMs: number;
  aggression: number;
  defense: number;
  jumpInChance: number;
  spacingChance: number;
  attack2Chance: number;
}

export interface FighterInput {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  attack: boolean;
  attack2: boolean;
  special: boolean;
}
