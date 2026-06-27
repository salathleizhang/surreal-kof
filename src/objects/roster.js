import Kyo from './Kyo.js';
import GeneratedFighter from './GeneratedFighter.js';
import { GENERATED } from './generatedRoster.js';

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
  const g = GENERATED[key];
  if (g) {
    return {
      name: g.name, cn: g.cn, cls: GeneratedFighter, portrait: g.portrait, generated: true,
    };
  }
  return null;
}

// Every selectable character key right now: the fixed roster plus generated ones.
export function allCharacterKeys() {
  return [...new Set([...Object.keys(CHARACTERS), ...Object.keys(GENERATED)])];
}

// The selectable fight stages. The same texture is used for the preview card
// and the actual fight background, so every option shown here is guaranteed to
// match the arena that starts after confirmation.
export const SCENES = {
  lovartOffice: {
    name: 'LOVART OFFICE',
    cn: 'LOVART 办公室',
    texture: 'stage-lovart-office',
    image: 'assets/background/lovart-office-v2.png',
  },
  idolProducer: {
    name: 'IDOL PRODUCER',
    cn: '偶像练习生舞台',
    texture: 'stage-idol-producer',
    image: 'assets/background/idol-producer-stage-v2.png',
  },
  lakersArena: {
    name: 'LAKERS ARENA',
    cn: '湖人主场',
    texture: 'stage-lakers-arena',
    image: 'assets/background/lakers-arena-stage.png',
  },
  tiananmenNight: {
    name: 'TIANANMEN NIGHT',
    cn: '天安门广场·夜',
    texture: 'stage-tiananmen-night',
    image: 'assets/background/tiananmen-square-stage.png',
  },
  fenggePark: {
    name: 'FENGGE PARK',
    cn: '峰哥公园',
    texture: 'stage-fengge-park',
    image: 'assets/background/fengge-park-statue-v2.png',
  },
  tiananmenDay: {
    name: 'TIANANMEN DAY',
    cn: '天安门广场·昼',
    texture: 'stage-tiananmen-day',
    image: 'assets/background/tiananmen-square-stage-day.png',
  },
  shenyangStreet: {
    name: 'SHENYANG STREET',
    cn: '沈阳大街',
    texture: 'stage-shenyang-street',
    image: 'assets/background/shenyang-street-stage.png',
  },
  shanghaiBund: {
    name: 'SHANGHAI BUND',
    cn: '上海外滩',
    texture: 'stage-shanghai-bund',
    image: 'assets/background/shanghai-bund-stage-day.png',
  },
};

// Display order for the STAGE SELECT screen's flip-deck. Each entry is a key in
// SCENES; the screen flips through them one at a time with W/S (or up/down).
export const SCENE_ORDER = [
  'lovartOffice',
  'idolProducer',
  'lakersArena',
  'tiananmenNight',
  'fenggePark',
  'tiananmenDay',
  'shenyangStreet',
  'shanghaiBund',
];

export const DEFAULT_SCENE = 'lovartOffice';
