import type {
  FighterLike, FramePoint, HitboxEvent, MovementEvent, SkillDefinition, SkillEvent,
} from '../types/combat.ts';

interface RunningSkill {
  skill: SkillDefinition;
  fired: Set<string>;
  windowTargets: Map<string, Set<FighterLike>>;
  windowHitCounts: Map<string, number>;
}

// Executes declarative, frame-timed skills. A skill owns its animation, hitbox,
// movement, projectile and presentation events; Fighter only asks the runner to
// start/update it and does not need skill-specific branches.
export default class SkillRunner {
  fighter: FighterLike;
  skills: Map<string, SkillDefinition>;
  inputSkills: SkillDefinition[];
  current: RunningSkill | null;

  constructor(fighter: FighterLike, skills: Record<string, SkillDefinition> = {}) {
    this.fighter = fighter;
    this.setSkills(skills);
    this.current = null;
  }

  setSkills(skills: Record<string, SkillDefinition> = {}): void {
    this.skills = new Map<string, SkillDefinition>(Object.entries(skills));
    this.inputSkills = [...this.skills.values()]
      .filter((skill) => skill.input)
      .sort((a, b) => (b.priority || 0) - (a.priority || 0));
  }

  get isActive(): boolean {
    return !!this.current;
  }

  get activeSkill(): SkillDefinition | null {
    return this.current && this.current.skill;
  }

  getSkill(id: string): SkillDefinition | null {
    return this.skills.get(id) || null;
  }

  getSkillByInput(input: string): SkillDefinition | null {
    return this.inputSkills.find((skill) => skill.input === input) || null;
  }

  tryStartFromInput(input: Record<string, boolean>): boolean {
    if (this.current || !this.fighter.canStartSkill()) return false;
    const skill = this.inputSkills.find(
      (candidate) => input[candidate.input]
        && this.fighter.hasAnimation(candidate.animation)
        && this.fighter.canUseSkill?.(candidate) !== false,
    );
    return skill ? this.start(skill.id) : false;
  }

  start(id: string): boolean {
    const skill = this.getSkill(id);
    if (!skill || this.current || !this.fighter.canStartSkill()) return false;
    if (!this.fighter.hasAnimation(skill.animation)) return false;
    if (this.fighter.canUseSkill?.(skill) === false) return false;

    this.current = {
      skill,
      fired: new Set(),
      windowTargets: new Map(),
      windowHitCounts: new Map(),
    };
    this.fighter.beginSkill(skill);
    this.emitEffects(skill.startEffects, { skill });
    this.processFrame(0);
    return true;
  }

  update(): void {
    if (!this.current) return;
    const { skill } = this.current;
    if (this.fighter.status !== skill.animation || this.fighter.isDead()) {
      this.finish();
      return;
    }
    this.processFrame(this.fighter.frame_current_cnt);
  }

  processFrame(frame: number): void {
    if (!this.current) return;
    const {
      skill, fired, windowTargets, windowHitCounts,
    } = this.current;

    for (const [index, event] of (skill.events || []).entries()) {
      if (event.type === 'movement') {
        const from = this.resolveFrame(event.from ?? event.frame ?? 0, skill);
        const to = this.resolveFrame(event.to ?? from, skill);
        if (frame >= from && frame <= to) this.applyMovement(event);
        continue;
      }

      const at = this.resolveFrame(event.frame ?? 0, skill);
      const key = event.id || `${event.type}:${at}:${index}`;

      // A hitbox may stay active for several combat frames. It can overlap the
      // target on every frame but damages each target only once per event.
      if (event.type === 'hitbox' && (event.from !== undefined || event.to !== undefined)) {
        const from = this.resolveFrame(event.from ?? event.frame ?? 0, skill);
        const to = this.resolveFrame(event.to ?? from, skill);
        if (frame >= from && frame <= to) {
          if (!windowTargets.has(key)) windowTargets.set(key, new Set());
          const hits = this.dispatch(event, skill, {
            hitTargets: windowTargets.get(key), suppressWhiff: true,
          });
          windowHitCounts.set(key, (windowHitCounts.get(key) || 0) + hits);
          if (frame === to && !windowHitCounts.get(key) && event.onWhiff) {
            this.fighter.scene.combatEffects?.emit(event.onWhiff, {
              fighter: this.fighter, skill, event,
            });
          }
        }
        continue;
      }

      if (frame < at || fired.has(key)) continue;
      fired.add(key);
      this.dispatch(event, skill);
    }
  }

  resolveFrame(value: FramePoint, skill: SkillDefinition): number {
    if (value === 'apex') return this.fighter.animationApex(skill.animation);
    if (value === 'end') return this.fighter.animationDuration(skill.animation);
    return Number(value) || 0;
  }

  applyMovement(event: MovementEvent): void {
    const facing = event.relative === false ? 1 : this.fighter.direction;
    if (event.velocityX !== undefined) this.fighter.vx = event.velocityX * facing;
    if (event.velocityY !== undefined) this.fighter.vy = event.velocityY;
  }

  dispatch(
    event: SkillEvent,
    skill: SkillDefinition,
    options: { hitTargets?: Set<FighterLike>; suppressWhiff?: boolean } = {},
  ): number {
    const world = this.fighter.scene.combatWorld;
    const effects = this.fighter.scene.combatEffects;
    const context = { fighter: this.fighter, skill, event };

    if (event.type === 'hitbox') {
      const hits = world
        ? world.activateHitbox(this.fighter, event, options.hitTargets)
        : 0;
      if (!hits && event.onWhiff && !options.suppressWhiff) effects?.emit(event.onWhiff, context);
      return hits;
    } else if (event.type === 'projectile') {
      world?.spawnProjectile(this.fighter, event.projectile || {});
    } else if (event.type === 'direct-hit') {
      world?.hitOpponentDirectly(this.fighter, event.hit || event);
    } else if (event.type === 'effect') {
      effects?.emit(event.effect, context);
    } else if (event.type === 'velocity') {
      this.applyMovement(event);
    } else if (event.type === 'pause' || event.type === 'cinematic-pause') {
      this.fighter.pauseAnimation?.(event.duration);
    }
    return 0;
  }

  emitEffects(
    names: string | string[] | undefined,
    context: Record<string, unknown>,
  ): void {
    if (!names) return;
    const effects = this.fighter.scene.combatEffects;
    for (const name of Array.isArray(names) ? names : [names]) {
      effects?.emit(name, { fighter: this.fighter, ...context });
    }
  }

  finish(): void {
    if (!this.current) return;
    const { skill } = this.current;
    this.current = null;
    this.emitEffects(skill.endEffects, { skill });
    this.fighter.onSkillFinished?.(skill);
  }

  cancel(): void {
    const skill = this.current && this.current.skill;
    this.current = null;
    if (skill) this.fighter.onSkillCancelled?.(skill);
  }
}
