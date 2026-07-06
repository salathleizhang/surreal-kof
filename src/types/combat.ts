export type AnimationState = number | string;
export type FramePoint = number | 'apex' | 'end';
export type SkillInputName = 'attack' | 'attack2' | 'special' | string;

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type LocalBox = Partial<Box>;

export interface Knockback {
  x?: number;
  y?: number;
}

export interface HitData {
  damage?: number | 'all';
  hitstop?: number;
  effect?: string;
  knockback?: Knockback;
  rageGain?: number;
  attacker?: FighterLike;
}

export interface ProjectileVisual {
  texture?: string;
  tint?: number;
  scale?: number;
}

export interface ProjectileDefinition extends HitData {
  forward?: number;
  y?: number;
  width?: number;
  height?: number;
  speed?: number;
  speedY?: number;
  lifeMs?: number;
  pierce?: boolean;
  hit?: HitData;
  visual?: ProjectileVisual;
  spawnEffect?: string;
  hitEffect?: string;
}

interface SkillEventBase {
  id?: string;
  frame?: FramePoint;
}

export interface HitboxEvent extends SkillEventBase, HitData {
  type: 'hitbox';
  from?: FramePoint;
  to?: FramePoint;
  box?: LocalBox;
  hit?: HitData;
  onWhiff?: string;
}

export interface MovementEvent extends SkillEventBase {
  type: 'movement' | 'velocity';
  from?: FramePoint;
  to?: FramePoint;
  velocityX?: number;
  velocityY?: number;
  relative?: boolean;
}

export interface ProjectileEvent extends SkillEventBase {
  type: 'projectile';
  projectile?: ProjectileDefinition;
}

export interface DirectHitEvent extends SkillEventBase, HitData {
  type: 'direct-hit';
  hit?: HitData;
}

export interface EffectEvent extends SkillEventBase {
  type: 'effect';
  effect: string;
}

export type SkillEvent = HitboxEvent | MovementEvent | ProjectileEvent | DirectHitEvent | EffectEvent;

export interface SkillDefinition {
  id: string;
  input?: SkillInputName;
  priority?: number;
  rageCost?: number | 'all';
  animation: AnimationState;
  name?: string;
  stopOnStart?: boolean;
  stopOnEnd?: boolean;
  trail?: boolean;
  ai?: { range?: number };
  pushbox?: LocalBox;
  hurtboxes?: LocalBox[];
  startEffects?: string | string[];
  endEffects?: string | string[];
  events?: SkillEvent[];
}

export interface FighterStats {
  maxHp?: number;
  maxRage?: number;
  rageGainPerHit?: number;
  moveSpeed?: number;
  jumpSpeed?: number;
  gravity?: number;
  floorY?: number;
}

export interface FighterBody {
  width?: number;
  height?: number;
  pushbox?: LocalBox;
  hurtboxes?: LocalBox[];
}

export interface CombatDefinition {
  stats?: FighterStats;
  body?: FighterBody;
  skills?: Record<string, SkillDefinition>;
}

export interface DashDefinition {
  fromFrame: number;
  toFrame: number;
  standoff?: number;
}

export interface AnimationDefinition {
  frame_cnt: number;
  frame_rate: number;
  playback?: 'loop' | 'forward' | 'yoyo' | 'hold';
  fullscreen?: boolean;
  srcW?: number;
  srcH?: number;
  offset_x?: number;
  offset_y?: number;
  scale?: number;
  background?: AnimationLayerDefinition;
  // Slides the non-fullscreen sprite from the fighter's own stance toward the
  // opponent between two sprite-frame indices, then holds there. Lets a cinematic
  // super (foreground art authored in-place) close the distance without the
  // combat/AI system actually moving the fighter.
  dash?: DashDefinition;
}

export interface AnimationLayerDefinition {
  texturePrefix: string;
  frame_cnt: number;
  frame_rate: number;
  playback?: 'loop' | 'forward' | 'yoyo' | 'hold';
  fullscreen?: boolean;
  srcW?: number;
  srcH?: number;
}

export interface FighterLike {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
  direction: number;
  vx: number;
  vy: number;
  status: AnimationState;
  frame_current_cnt: number;
  scene: any;
  isDead(): boolean;
  canStartSkill(): boolean;
  canUseSkill?(skill: SkillDefinition): boolean;
  gainRage?(amount?: number): void;
  hasAnimation(state: AnimationState): boolean;
  beginSkill(skill: SkillDefinition): void;
  animationApex(state: AnimationState): number;
  animationDuration(state: AnimationState): number;
  getPushbox(): Box;
  getHurtboxes(): Box[];
  receiveHit(hit: HitData): void;
  clampToStage(): void;
  onSkillFinished?(skill: SkillDefinition): void;
  onSkillCancelled?(skill: SkillDefinition): void;
}

export interface ActiveHitbox {
  owner: FighterLike;
  event: HitboxEvent;
  box: Box;
}

export type EffectContext = Record<string, any>;
