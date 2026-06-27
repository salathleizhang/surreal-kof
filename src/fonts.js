// Shared font families for the whole game.
//
// "Press Start 2P" is an arcade-style pixel/bitmap font that matches the classic
// Neo Geo / King of Fighters select-screen look. It only ships Latin (plus a few
// extended) glyphs and has no CJK characters, so any string that contains Chinese
// must stack a CJK system font after it as a fallback.

// Latin-only arcade text (logo, 1P/2P tags, FIGHT!, timers, hints).
export const PIXEL_FONT = '"Press Start 2P", monospace';

// Strings that mix Chinese with Latin/digits: the Latin parts render in the
// pixel font, the Chinese characters fall back to a system CJK font.
export const PIXEL_FONT_CN = '"Press Start 2P", "PingFang SC", "Microsoft YaHei", sans-serif';

// Family string passed to the CSS Font Loading API to make sure the webfont is
// decoded before Phaser starts drawing text to its canvas.
export const PIXEL_FONT_FAMILY = '"Press Start 2P"';
