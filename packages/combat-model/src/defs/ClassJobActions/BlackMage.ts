import type { ElementChange, ElementChangeTable, ElementRules, GaugeModifier } from '../../defs.js'

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

// The fire and the ice spells of the thaumaturge and the black mage
const FIRE = [141, 147, 152, 3577, 162, 16505, 25794, 36989]
const ICE = [142, 25793, 154, 3576, 159, 25795]

/** The potency of the fire and ice spells at each stack of Astral Fire and Umbral Ice, from Aspect Mastery I–III */
function aspectMastery(stance: number, fire: number, ice: number | null): GaugeModifier[] {
  const modifiers: GaugeModifier[] = [
    {
      gauge: 'BlackMage',
      when: (gauge) => gauge.elementStance === stance,
      type: 'potency',
      value: [{ level: 1, value: fire }],
      actions: FIRE,
      category: null,
      damageType: null,
    },
  ]
  if (ice !== null) {
    modifiers.push({
      gauge: 'BlackMage',
      when: (gauge) => gauge.elementStance === stance,
      type: 'potency',
      value: [{ level: 1, value: ice }],
      actions: ICE,
      category: null,
      damageType: null,
    })
  }
  return modifiers
}

export const gaugeModifiers: readonly GaugeModifier[] = [
  // Enochian, and Enhanced Enochian I–IV
  {
    gauge: 'BlackMage',
    when: (gauge) => gauge.enochianActive,
    type: 'damageDealt',
    value: [
      { level: 1, value: 0.05 },
      { level: 70, value: 0.1 },
      { level: 78, value: 0.15 },
      { level: 86, value: 0.22 },
      { level: 96, value: 0.27 },
    ],
    actions: null,
    category: null,
    damageType: 'magic',
  },
  // Astral Fire raises the fire spells and lowers the ice spells; Umbral Ice lowers the fire spells only
  ...aspectMastery(1, 0.4, -0.1),
  ...aspectMastery(2, 0.6, -0.2),
  ...aspectMastery(3, 0.8, -0.3),
  ...aspectMastery(-1, -0.1, null),
  ...aspectMastery(-2, -0.2, null),
  ...aspectMastery(-3, -0.3, null),
]
