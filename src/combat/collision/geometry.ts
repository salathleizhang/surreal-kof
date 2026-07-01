import type { Box, LocalBox } from '../../types/combat.ts';

type PositionedFighter = Pick<Box, 'x' | 'y' | 'width' | 'height'> & { direction: number };

export function intersectsAabb(a: Box, b: Box): boolean {
  return a.x < b.x + b.width
    && a.x + a.width > b.x
    && a.y < b.y + b.height
    && a.y + a.height > b.y;
}

// Convert a box authored in fighter-local coordinates into world space.
// Local x is measured from the fighter's left edge while facing right. Facing
// left mirrors the box around the fighter body, which keeps skill data readable.
export function localBoxToWorld(fighter: PositionedFighter, box: LocalBox): Box {
  const width = box.width ?? fighter.width;
  const height = box.height ?? fighter.height;
  const localX = box.x ?? 0;
  const localY = box.y ?? 0;
  const x = fighter.direction >= 0
    ? fighter.x + localX
    : fighter.x + fighter.width - localX - width;
  return {
    x,
    y: fighter.y + localY,
    width,
    height,
  };
}

export function overlapAmount(a: Box, b: Box): { x: number; y: number } {
  return {
    x: Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
    y: Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y),
  };
}
