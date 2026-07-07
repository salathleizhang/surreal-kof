import type { AnimationDefinition, AnimationLayerDefinition } from '../types/combat.ts';

type AnimationTiming = Pick<AnimationDefinition | AnimationLayerDefinition, 'frame_cnt' | 'frame_rate' | 'playback'>;

export function playbackForFrame(
  animation: AnimationTiming,
  frameCurrent: number,
  forceLoop = false,
): { frame: number; finished: boolean } {
  const frameCount = Math.max(1, animation.frame_cnt);
  const frameRate = Math.max(1, animation.frame_rate);
  const playback = animation.playback;
  const step = Math.floor(frameCurrent / frameRate);

  if (forceLoop) {
    if (playback === 'yoyo') {
      const span = Math.max(1, 2 * (frameCount - 1));
      const cycleStep = step % span;
      const frame = cycleStep <= frameCount - 1
        ? cycleStep
        : Math.max(0, span - cycleStep);
      return { frame, finished: false };
    }
    return { frame: step % frameCount, finished: false };
  }

  if (!playback || playback === 'loop') {
    return { frame: step % frameCount, finished: false };
  }
  if (playback === 'forward' || playback === 'hold') {
    const frame = Math.min(step, frameCount - 1);
    return { frame, finished: step >= frameCount - 1 };
  }
  if (playback === 'yoyo') {
    const span = Math.max(1, 2 * (frameCount - 1));
    const cycleStep = Math.min(step, span);
    const frame = cycleStep <= frameCount - 1
      ? cycleStep
      : Math.max(0, span - cycleStep);
    return { frame, finished: step >= span };
  }
  return { frame: step % frameCount, finished: false };
}
