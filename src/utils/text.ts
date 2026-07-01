// Helpers for styling Phaser Text objects.

// Apply a top-to-bottom (vertical) gradient fill to a Text object, KOF-logo
// style. Phaser fills text from a CanvasGradient built in the text canvas's own
// coordinate space, so the gradient is measured in pixels from the top of the
// glyphs downward.
//
// The gradient height is derived from the font size (not `text.height`) on
// purpose: texts that start empty or whose content changes later (timer, name,
// "OK!") would otherwise be measured at height 0 and render a flat color.
//
//   stops: array of CSS color strings, distributed evenly from top to bottom,
//          e.g. ['#fff7c0', '#ffd23f', '#b8741a'].
export function setVerticalGradient(text, stops) {
  const fontPx = parseInt(text.style.fontSize, 10) || 16;
  // A touch taller than the cap height so the bottom color reaches the descenders.
  const height = fontPx * 1.2;

  const grad = text.context.createLinearGradient(0, 0, 0, height);
  const last = Math.max(stops.length - 1, 1);
  stops.forEach((color, i) => grad.addColorStop(i / last, color));

  text.setFill(grad);
  return text;
}
