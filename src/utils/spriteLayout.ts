import type { SpriteBounds } from '../types/generatedCharacter.ts';

export function fitVisibleSprite(
  sourceWidth: number,
  sourceHeight: number,
  bounds: SpriteBounds | undefined,
  maxWidth: number,
  maxHeight: number,
) {
  const visible = bounds || {
    x: 0,
    y: 0,
    width: sourceWidth,
    height: sourceHeight,
    sourceWidth,
    sourceHeight,
  };
  return {
    originX: (visible.x + visible.width / 2) / sourceWidth,
    originY: (visible.y + visible.height) / sourceHeight,
    scale: Math.min(maxWidth / visible.width, maxHeight / visible.height),
  };
}
