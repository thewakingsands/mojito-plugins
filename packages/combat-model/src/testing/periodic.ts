import { type ElementRules, type GaugeModifier, type PeriodicDefs, parsePeriodicDefs } from '../defs.js'
import { type TestBuff, TestCombatants } from './combatants.js'

/** The rules of the black mage the tests use */
export const testElements: ElementRules = {
  classJobs: [7, 25],
  enochianLevel: 56,
  maxStacks: [
    { level: 1, value: 1 },
    { level: 20, value: 2 },
    { level: 35, value: 3 },
  ],
  actions: [
    { id: 152, change: [{ level: 1, change: { kind: 'set', element: 'astralFire', stacks: 'max' } }] },
    { id: 154, change: [{ level: 1, change: { kind: 'set', element: 'umbralIce', stacks: 'max' } }] },
    { id: 9001, change: [{ level: 1, change: { kind: 'set', element: 'astralFire', stacks: 2 } }] },
    { id: 141, change: [{ level: 1, change: { kind: 'fire' } }] },
    { id: 142, change: [{ level: 1, change: { kind: 'ice' } }] },
    {
      id: 147,
      change: [
        { level: 1, change: { kind: 'fireSwitch' } },
        { level: 35, change: { kind: 'set', element: 'astralFire', stacks: 'max' } },
      ],
    },
    {
      id: 25793,
      change: [
        { level: 1, change: { kind: 'iceSwitch' } },
        { level: 35, change: { kind: 'set', element: 'umbralIce', stacks: 'max' } },
      ],
    },
    { id: 16506, change: [{ level: 1, change: { kind: 'umbralSoul' } }] },
    { id: 149, change: [{ level: 1, change: { kind: 'transpose' } }] },
  ],
}

/** Enochian, and the potency of the fire and ice spells at 3 stacks */
export const testGauge: GaugeModifier[] = [
  {
    gauge: 'BlackMage',
    when: (gauge) => gauge.enochianActive,
    type: 'damageDealt',
    value: [
      { level: 1, value: 0.05 },
      { level: 70, value: 0.1 },
      { level: 96, value: 0.27 },
    ],
    actions: null,
    category: null,
    damageType: 'magic',
  },
  {
    gauge: 'BlackMage',
    when: (gauge) => gauge.elementStance === 3,
    type: 'potency',
    value: [{ level: 1, value: 0.8 }],
    actions: [152, 141, 3577, 153],
    category: null,
    damageType: null,
  },
  {
    gauge: 'BlackMage',
    when: (gauge) => gauge.elementStance === 3,
    type: 'potency',
    value: [{ level: 1, value: -0.3 }],
    actions: [154, 142],
    category: null,
    damageType: null,
  },
  {
    gauge: 'BlackMage',
    when: (gauge) => gauge.elementStance === -3,
    type: 'potency',
    value: [{ level: 1, value: -0.3 }],
    actions: [152, 141, 3577],
    category: null,
    damageType: null,
  },
]

const table = (potency: number) => [{ level: 1, potency }]

/** The modifiers of level 100 at every level, the content of level-modifiers.json */
export const testLevelModifiers = () => ({
  levels: Array.from({ length: 100 }, (_, index) => ({ level: index + 1, sub: 420, div: 2780 })),
})

/** Periodic data with the statuses and actions the tests use */
export function testDefs(
  change: (input: {
    statuses: Record<string, unknown>[]
    actions: Record<string, unknown>[]
    sampleActions: Record<string, unknown>[]
    actionTypes: Record<string, unknown>[]
  }) => void = () => {},
): PeriodicDefs {
  const statuses: Record<string, unknown>[] = [
    {
      id: 1881,
      periodic: {
        kind: 'damage',
        action: 16554,
        job: 33,
        potency: [
          { level: 1, potency: 65 },
          { level: 94, potency: 70 },
        ],
      },
    },
    {
      id: 1228,
      periodic: {
        kind: 'damage',
        action: 7489,
        job: 34,
        potency: table(50),
      },
    },
    {
      id: 3871,
      periodic: { kind: 'damage', action: 36986, job: 25, potency: table(60) },
    },
    {
      id: 2938,
      periodic: { kind: 'heal', action: 24298, job: 40, potency: table(100) },
    },
    { id: 1878, modifiers: [{ type: 'damageDealt', valueFrom: 'applyByte' }] },
    { id: 1821, modifiers: [{ type: 'damageDealt', valueFrom: 'applyByte' }] },
    { id: 2105, modifiers: [{ type: 'damageDealt', valueFrom: 'applyByte', byteOf: 1821 }] },
    { id: 786, modifiers: [{ type: 'critRate', value: [{ level: 1, value: 0.1 }] }] },
    { id: 141, modifiers: [{ type: 'directHitRate', value: [{ level: 1, value: 0.2 }] }] },
    { id: 1221, modifiers: [{ type: 'critRateTaken', value: [{ level: 1, value: 0.1 }], scope: 'all' }] },
    { id: 2586, modifiers: [{ type: 'damageTaken', value: [{ level: 1, value: 0.1 }], scope: 'source' }] },
    { id: 3849, modifiers: [{ type: 'damageTaken', value: [{ level: 1, value: 0.05 }], scope: 'all' }] },
    {
      id: 1298,
      modifiers: [
        {
          type: 'damageDealt',
          value: [
            { level: 1, value: 0.1 },
            { level: 78, value: 0.13 },
          ],
        },
      ],
    },
    { id: 444, modifiers: [{ type: 'damageDealt', value: [{ level: 1, value: 0.25 }], zones: [446] }] },
    { id: 714, modifiers: [{ type: 'damageTaken', value: [{ level: 1, value: 0.1 }], scope: 'all', stacked: true }] },
    { id: 1239, modifiers: [{ type: 'damageDealt', value: [{ level: 1, value: 0.1 }], damageType: 'magic' }] },
    { id: 900, modifiers: [{ type: 'damageDealt', value: [{ level: 1, value: 0.2 }], damageType: 'physical' }] },
    { id: 901, modifiers: [{ type: 'damageDealt', value: [{ level: 1, value: 0.3 }], actions: [7489] }] },
    { id: 902, modifiers: [{ type: 'damageDealt', value: [{ level: 1, value: 0.4 }], category: 'weaponskill' }] },
    { id: 1892, modifiers: [{ type: 'healingDealt', value: [{ level: 1, value: 0.2 }] }] },
    { id: 2622, modifiers: [{ type: 'healingReceived', value: [{ level: 1, value: 0.2 }], scope: 'all' }] },
    {
      id: 1177,
      modifiers: [
        { type: 'forceCritical', actions: [3549] },
        { type: 'forceDirect', actions: [3549] },
      ],
    },
    { id: 851, modifiers: [{ type: 'forceCritical' }, { type: 'forceDirect' }] },
    { id: 2688, modifiers: [{ type: 'potencyBonus', category: 'weaponskill' }] },
    { id: 3001, modifiers: [{ type: 'potencyBonus', actions: [7489] }] },
    { id: 3002, modifiers: [{ type: 'potencyBonus' }] },
  ]
  const actions: Record<string, unknown>[] = [
    {
      id: 25871,
      job: 33,
      calibration: {
        kind: 'damage',
        potency: [
          { level: 1, potency: 250 },
          { level: 94, potency: 270 },
        ],
      },
    },
    {
      id: 7477,
      job: 34,
      calibration: { kind: 'damage', potency: table(200) },
    },
    {
      id: 16507,
      job: 25,
      calibration: { kind: 'damage', potency: table(890) },
    },
    {
      id: 152,
      job: 25,
      calibration: { kind: 'damage', potency: table(290), gauge: true },
    },
    {
      id: 154,
      job: 25,
      calibration: { kind: 'damage', potency: table(290), gauge: true },
    },
    {
      id: 141,
      job: 25,
      calibration: { kind: 'damage', potency: table(180), gauge: true },
    },
    {
      id: 24283,
      job: 40,
      calibration: { kind: 'damage', potency: table(330) },
    },
    { id: 24284, job: 40, calibration: { kind: 'heal', potency: table(450) } },
    { id: 16465, forced: 'criticalDirect' },
  ]
  const actionTypes: Record<string, unknown>[] = [
    { id: 141, category: 'spell', attackType: 'magic' },
    { id: 152, category: 'spell', attackType: 'magic' },
    { id: 154, category: 'spell', attackType: 'magic' },
    { id: 7477, category: 'weaponskill', attackType: 'physical' },
    { id: 7481, category: 'weaponskill', attackType: 'physical' },
    { id: 7489, category: 'weaponskill', attackType: 'physical' },
    { id: 7490, category: 'ability', attackType: 'physical' },
    { id: 16507, category: 'spell', attackType: 'magic' },
    { id: 16554, category: 'spell', attackType: 'magic' },
    { id: 24283, category: 'spell', attackType: 'magic' },
    { id: 24284, category: 'spell', attackType: 'magic' },
    { id: 24298, category: 'ability', attackType: 'magic' },
    { id: 25871, category: 'spell', attackType: 'magic' },
    { id: 36986, category: 'spell', attackType: 'magic' },
  ]
  const sampleActions: Record<string, unknown>[] = [
    { id: 7477, job: 34, potency: { base: table(200) } },
    {
      id: 7481,
      job: 34,
      potency: { base: table(160), rear: table(210), combo: table(370), comboRear: table(420) },
    },
    { id: 7490, job: 34, potency: { base: table(250) } },
    { id: 16507, job: 25, potency: { base: table(890) } },
  ]
  change({ statuses, actions, sampleActions, actionTypes })
  return parsePeriodicDefs({
    version: { version: '7.57', gameVersion: '2026.10.06.0000.0000', maxLevel: 100 },
    statuses: { statuses },
    actions: { actions },
    sampleActions: { actions: sampleActions },
    actionTypes: { actions: actionTypes },
    // The statuses above that raid buffs give
    raidBuffStatuses: [1878, 786, 2105, 141, 1221, 3849],
    raidBuffActions: [],
    partyMitigations: [],
    levelModifiers: testLevelModifiers(),
    gauge: testGauge,
    elements: testElements,
  })
}

/** Players of the tests */
export const ASTROLOGIAN = 0x10000001
export const SAMURAI = 0x10000002
export const BLACK_MAGE = 0x10000003
export const SAGE = 0x10000004
export const THAUMATURGE = 0x10000005
export const DANCER = 0x10000006
export const DANCER_2 = 0x10000007
export const ENEMY = 0x40000001

/** A world with the players of the tests at level 100 and an enemy */
export function testCombatants(): TestCombatants {
  const combatants = new TestCombatants()
  combatants.update(ASTROLOGIAN, { nickname: 'Astrologian', classJob: 33, level: 100 }, true)
  combatants.update(SAMURAI, { nickname: 'Samurai', classJob: 34, level: 100 }, true)
  combatants.update(BLACK_MAGE, { nickname: 'Black Mage', classJob: 25, level: 100 }, true)
  combatants.update(SAGE, { nickname: 'Sage', classJob: 40, level: 100 }, true)
  combatants.update(THAUMATURGE, { nickname: 'Thaumaturge', classJob: 7, level: 30 }, true)
  combatants.update(DANCER, { nickname: 'Dancer', classJob: 38, level: 100 }, true)
  combatants.update(DANCER_2, { nickname: 'Second Dancer', classJob: 38, level: 100 }, true)
  combatants.update(ENEMY, { nickname: 'Striking Dummy', level: 100, bNpcBase: 541 }, true)
  return combatants
}

/** A status of the slot, from the source, lasting long */
export const buff = (id: number, actorId: number, extra = 0, timestamp = 0, duration = 30): TestBuff => ({
  id,
  extra,
  timestamp,
  duration,
  actorId,
})
