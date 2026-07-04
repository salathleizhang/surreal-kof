export const WINNER_QUOTES = Object.freeze({
  'fighter-87633c7b': '理解万岁！',
  chenmian: '此一时彼一时！',
  speed: 'siu！',
  kobe: 'man！what can i say！',
  caixukun: '你～干～嘛',
  'fengge-wangming-tianya': '这是好事儿啊！',
});

export const DEFAULT_WINNER_QUOTE = '胜负已分！';

export function getWinnerQuote(characterId: string): string {
  return WINNER_QUOTES[characterId] || DEFAULT_WINNER_QUOTE;
}
