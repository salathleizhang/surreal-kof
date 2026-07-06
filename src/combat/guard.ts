import { COMBO_DECAY, DEFAULT_DAMAGE } from '../config/combat.ts';
import type { HitData } from '../types/combat.ts';

export function isGuardInput(
  input: Record<string, boolean>,
  direction: number,
): boolean {
  const backward = direction > 0 ? input.left : input.right;
  return !!input.down && !!backward;
}

export function resolveDamage(
  damage: HitData['damage'],
  hp: number,
  guarding: boolean,
  comboHits = 1,
): number {
  if (guarding) return 0;
  // 'all' is an instant-kill primitive kept for potential future finisher
  // moves; no shipped skill currently sets damage: 'all'.
  if (damage === 'all') return hp;
  const base = Math.max(0, Number(damage ?? DEFAULT_DAMAGE.attack1));
  const { multipliers, floor } = COMBO_DECAY;
  const multiplier = multipliers[comboHits - 1] ?? floor;
  return Math.round(base * multiplier);
}
