export function intersectsAabb(a, b) {
  return a.x < b.x + b.width
    && a.x + a.width > b.x
    && a.y < b.y + b.height
    && a.y + a.height > b.y;
}

// Convert a box authored in fighter-local coordinates into world space.
// Local x is measured from the fighter's left edge while facing right. Facing
// left mirrors the box around the fighter body, which keeps skill data readable.
export function localBoxToWorld(fighter, box) {
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

export function overlapAmount(a, b) {
  return {
    x: Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
    y: Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y),
  };
}
