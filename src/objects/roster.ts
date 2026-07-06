import GeneratedFighter from './GeneratedFighter.ts';
import {
  getGeneratedCharacter, listGeneratedCharacterIds,
} from '../state/generatedCharacters.ts';

// The playable roster. Each entry maps a roster key to its display name, the
// Player subclass that implements it, and the texture used for portraits on the
// select screen (the first idle frame, registered by the PreloadScene).
//
// No fighter ships built-in anymore; every playable character comes from the
// generated-fighter pipeline (see state/generatedCharacters.ts).
export const CHARACTERS = {};

// The grid shown on the MEMBER SELECT screen.
export const SELECT_GRID = {
  cols: 5,
  rows: 2,
};

// Unified character lookup: built-in roster first, then any AI-generated fighter
// loaded at runtime. Returns a select-screen-shaped entry { name, cn, cls,
// portrait, generated? } or null. Generated fighters all share the
// GeneratedFighter class and are told which one to be via info.charKey.
export function getCharacter(key) {
  if (CHARACTERS[key]) return CHARACTERS[key];
  const g = getGeneratedCharacter(key);
  if (g) {
    return {
      name: g.name,
      cn: g.cn,
      cls: GeneratedFighter,
      portrait: g.portrait,
      figure: g.figure,
      generated: true,
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

// Fallback character key for direct dev-mode fight launches and any select-grid
// cell that isn't a real character (e.g. still empty, or landed on the "+" add
// button). Built-in roster first, otherwise whatever fighter was generated
// first this session.
export function getDefaultCharacterKey() {
  return Object.keys(CHARACTERS)[0] || listGeneratedCharacterIds()[0] || null;
}
