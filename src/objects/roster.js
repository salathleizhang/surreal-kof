import Kyo from './Kyo.js';
import GeneratedFighter from './GeneratedFighter.js';
import {
  getGeneratedCharacter, listGeneratedCharacterIds,
} from '../state/generatedCharacters.js';

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

// Unified character lookup: built-in roster first, then any AI-generated fighter
// loaded at runtime. Returns a select-screen-shaped entry { name, cn, cls,
// portrait, generated? } or null. Generated fighters all share the
// GeneratedFighter class and are told which one to be via info.charKey.
export function getCharacter(key) {
  if (CHARACTERS[key]) return CHARACTERS[key];
  const g = getGeneratedCharacter(key);
  if (g) {
    return {
      name: g.name, cn: g.cn, cls: GeneratedFighter, portrait: g.portrait, generated: true,
    };
  }
  return null;
}

// Every selectable character key right now: the fixed roster plus generated ones.
export function allCharacterKeys() {
  const builtInKeys = Object.keys(CHARACTERS);
  const generatedKeys = listGeneratedCharacterIds()
    .filter((key) => !Object.prototype.hasOwnProperty.call(CHARACTERS, key));
  return [...builtInKeys, ...generatedKeys];
}
