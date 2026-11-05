import type { ElementChange, ElementChangeTable, ElementRules } from '../defs.js'

const always = (change: ElementChange): ElementChangeTable => [{ level: 1, change }]
const astralFire: ElementChange = { kind: 'set', element: 'astralFire', stacks: 'max' }
const umbralIce: ElementChange = { kind: 'set', element: 'umbralIce', stacks: 'max' }

export const blackMageElements: ElementRules = {
  // Thaumaturge and Black Mage
  classJobs: [7, 25],
  enochianLevel: 56,
  // Aspect Mastery: one stack, two from Aspect Mastery II and three from Aspect Mastery III
  maxStacks: [
    { level: 1, value: 1 },
    { level: 20, value: 2 },
    { level: 35, value: 3 },
  ],
  actions: [
    { id: 152, change: always(astralFire) }, // 爆炎
    // 烈炎 and 冰冻 add a stack up to level 34, and give the maximum from Aspect Mastery III at level 35
    {
      id: 147, // 烈炎
      change: [
        { level: 1, change: { kind: 'fireSwitch' } },
        { level: 35, change: astralFire },
      ],
    },
    { id: 25794, change: always(astralFire) }, // 高烈炎
    { id: 162, change: always(astralFire) }, // 核爆
    { id: 16505, change: always(astralFire) }, // 绝望
    { id: 158, change: always(astralFire) }, // 魔泉
    { id: 154, change: always(umbralIce) }, // 冰封
    {
      id: 25793, // 冰冻
      change: [
        { level: 1, change: { kind: 'iceSwitch' } },
        { level: 35, change: umbralIce },
      ],
    },
    { id: 25795, change: always(umbralIce) }, // 高冰冻
    { id: 141, change: always({ kind: 'fire' }) }, // 火炎
    { id: 142, change: always({ kind: 'ice' }) }, // 冰结
    { id: 16506, change: always({ kind: 'umbralSoul' }) }, // 灵极魂
    { id: 149, change: always({ kind: 'transpose' }) }, // 星灵移位
  ],
}
