import type { Catalog, Monster } from './data.js'

const weakness: Monster['weakness'] = {
  stun: 'effective',
  heavy: 'immune',
  slow: 'unknown',
  sleep: 'immune',
  bind: 'effective',
}
const catalog: Catalog = {
  nameColumn: 0,
  territories: [
    { dungeon: 'PotD', first: 900001, last: 900002 },
    { dungeon: 'EO', first: 900003, last: 900003 },
  ],
  monsters: [
    {
      nameId: 910001,
      upstreamName: '训练石像',
      dungeons: ['PotD'],
      aggro: 'Sight',
      threat: 'Caution',
      weakness,
      undead: false,
      notes: { zhCN: '测试备注。', en: 'Synthetic training note.\nRead the whole passage.' },
      sourcePath: 'synthetic/long',
    },
    {
      nameId: 910002,
      upstreamName: '训练木偶',
      dungeons: ['PotD'],
      aggro: 'Sound',
      threat: 'Easy',
      weakness,
      undead: false,
      notes: {},
      sourcePath: 'synthetic/empty',
    },
    {
      nameId: 910003,
      upstreamName: '训练幽灵',
      dungeons: ['PotD', 'EO'],
      aggro: 'Proximity',
      threat: 'Danger',
      weakness: { ...weakness, stun: 'unknown' },
      undead: true,
      notes: { en: 'Synthetic English fallback.\n<em>This stays plain text.</em>' },
      sourcePath: 'synthetic/fallback',
    },
    {
      nameId: 910004,
      upstreamName: '另一迷宫的训练怪',
      dungeons: ['EO'],
      aggro: 'Proximity',
      threat: 'Easy',
      weakness,
      undead: false,
      notes: { zhCN: '另一迷宫的合成资料。' },
      sourcePath: 'synthetic/other',
    },
  ],
  floors: [
    {
      dungeon: 'PotD',
      key: '练习 1–10',
      notes: { zhCN: '用于手动查阅的合成楼层提示。', en: 'Synthetic floor notes.' },
    },
    { dungeon: 'PotD', key: '练习 11–20', redirect: '练习 1–10', notes: {} },
    { dungeon: 'EO', key: '练习 1–10', notes: { en: 'Another synthetic floor guide.' } },
  ],
}
export default catalog
