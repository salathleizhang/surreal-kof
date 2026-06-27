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
