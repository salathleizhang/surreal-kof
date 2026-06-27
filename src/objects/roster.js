import Kyo from './Kyo.js';

// The playable roster. Each entry maps a roster key to its display name, the
// Player subclass that implements it, and the texture used for portraits on the
// select screen (the first idle frame, registered by the PreloadScene).
//
// Only Kyo ships with art today; adding a fighter is just another entry here
// plus its GIFs in the PreloadScene.
export const CHARACTERS = {
  kyo: { name: 'KYO KUSANAGI', cn: '草薙京', cls: Kyo, portrait: 'kyo-0-0' },
};

// The grid shown on the MEMBER SELECT screen, laid out row by row. Every cell
// references a key in CHARACTERS; with a single fighter the grid is all Kyo,
// which still gives the screen its King-of-Fighters look.
export const SELECT_GRID = {
  cols: 5,
  rows: 2,
  cells: [
    'kyo', 'kyo', 'kyo', 'kyo', 'kyo',
    'kyo', 'kyo', 'kyo', 'kyo', 'kyo',
  ],
};

export const DEFAULT_CHARACTER = 'kyo';

// The selectable fight stages. Each entry maps a scene key to its display name,
// the background texture prefix used by the FightScene (frames are `${bgPrefix}-0`,
// `${bgPrefix}-1`, ...), the registry key holding that animation's frame count,
// and the texture used as its thumbnail on the STAGE SELECT screen.
//
// Only one stage (the looping street GIF) ships today; adding a stage is just
// another entry here plus its GIF registered in the PreloadScene.
export const SCENES = {
  street: {
    name: 'STREET', cn: '街道', bgPrefix: 'bg', frameCountKey: 'bgFrameCount', thumb: 'bg-0',
  },
};

// Display order for the STAGE SELECT screen's flip-deck. Each entry is a key in
// SCENES; the screen flips through them one at a time with W/S (or up/down).
export const SCENE_ORDER = ['street'];

export const DEFAULT_SCENE = 'street';
