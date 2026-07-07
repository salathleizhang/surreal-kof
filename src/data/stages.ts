export const STAGES = Object.freeze({
  lovartOffice: {
    name: 'LOVART OFFICE',
    cn: 'LOVART 办公室',
    texture: 'stage-lovart-office',
    image: 'assets/background/lovart-office-v2.webp',
  },
  idolProducer: {
    name: 'IDOL PRODUCER',
    cn: '偶像练习生舞台',
    texture: 'stage-idol-producer',
    image: 'assets/background/idol-producer-stage-v2.webp',
  },
  lakersArena: {
    name: 'LAKERS ARENA',
    cn: '湖人主场',
    texture: 'stage-lakers-arena',
    image: 'assets/background/lakers-arena-stage.webp',
  },
  fenggePark: {
    name: 'FENGGE PARK',
    cn: '峰哥公园',
    texture: 'stage-fengge-park',
    image: 'assets/background/fengge-park-statue-v2.webp',
  },
  shenyangStreet: {
    name: 'SHENYANG STREET',
    cn: '沈阳大街',
    texture: 'stage-shenyang-street',
    image: 'assets/background/shenyang-street-stage.webp',
  },
  shanghaiBund: {
    name: 'SHANGHAI BUND',
    cn: '上海外滩',
    texture: 'stage-shanghai-bund',
    image: 'assets/background/shanghai-bund-stage-day.webp',
  },
});

export const STAGE_ORDER = Object.freeze([
  'lovartOffice',
  'idolProducer',
  'lakersArena',
  'fenggePark',
  'shenyangStreet',
  'shanghaiBund',
]);

export const DEFAULT_STAGE = 'lovartOffice';

export function getStage(key) {
  return STAGES[key] || STAGES[DEFAULT_STAGE];
}
