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
): number {
  if (guarding) return 0;
  if (damage === 'all') return hp;
  return Math.max(0, Number(damage ?? 20));
}
