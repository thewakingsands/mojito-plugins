import { describe, expect, it } from 'vitest'
import { periodicDefs } from './defs/index.js'
import {
  type ElementRules,
  type GaugeModifier,
  mergeClassJobActions,
  PeriodicDefsError,
  parsePeriodicDefs,
  potencyAt,
  valueAt,
} from './defs.js'
import { testLevelModifiers } from './testing/periodic.js'

/** A valid input that every test changes in one place */
function validInput() {
  return {
    version: { version: '7.57', gameVersion: '2026.10.06.0000.0000', maxLevel: 100 } as Record<string, unknown>,
    statuses: {
      statuses: [
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
          id: 2938,
          periodic: {
            kind: 'heal',
            action: 24292,
            job: 40,
            potency: [{ level: 1, potency: 100 }],
          },
        },
        { id: 1878, modifiers: [{ type: 'damageDealt', valueFrom: 'applyByte' }] },
        { id: 786, modifiers: [{ type: 'critRate', value: [{ level: 1, value: 0.1 }], valueAction: 3557 }] },
        { id: 1221, modifiers: [{ type: 'critRateTaken', value: [{ level: 1, value: 0.1 }], scope: 'all' }] },
        {
          id: 444,
          modifiers: [
            { type: 'damageDealt', value: [{ level: 1, value: 0.25 }], zones: [446], damageType: 'physical' },
          ],
        },
        {
          id: 714,
          modifiers: [{ type: 'damageTaken', value: [{ level: 1, value: 0.1 }], scope: 'source', stacked: true }],
        },
        { id: 317, modifiers: [{ type: 'healingDealt', value: [{ level: 1, value: 0.2 }], category: 'spell' }] },
        { id: 1177, modifiers: [{ type: 'forceCritical', actions: [3549, 3550] }, { type: 'forceDirect' }] },
      ] as Record<string, unknown>[],
    },
    actions: {
      actions: [
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
          id: 24283,
          job: 40,
          calibration: { kind: 'damage', potency: [{ level: 1, potency: 330 }] },
        },
        {
          id: 24284,
          job: 40,
          calibration: { kind: 'heal', potency: [{ level: 1, potency: 450 }] },
        },
        { id: 16465, forced: 'criticalDirect' },
      ] as Record<string, unknown>[],
    },
    sampleActions: {
      actions: [
        {
          id: 7481,
          job: 34,
          potency: {
            base: [{ level: 1, potency: 160 }],
            rear: [{ level: 1, potency: 210 }],
            combo: [
              { level: 1, potency: 320 },
              { level: 84, potency: 370 },
            ],
            comboRear: [
              { level: 1, potency: 370 },
              { level: 84, potency: 420 },
            ],
          },
        },
      ] as Record<string, unknown>[],
    },
    actionTypes: {
      actions: [
        { id: 7481, category: 'weaponskill', attackType: 'physical' },
        { id: 16554, category: 'spell', attackType: 'magic' },
        { id: 24283, category: 'spell', attackType: 'magic' },
        { id: 24284, category: 'spell', attackType: 'magic' },
        { id: 24292, category: 'ability', attackType: null },
        { id: 25871, category: 'spell', attackType: 'magic' },
      ] as Record<string, unknown>[],
    },
    levelModifiers: testLevelModifiers(),
    gauge: [
      {
        gauge: 'BlackMage',
        when: (gauge) => gauge.enochianActive,
        type: 'damageDealt',
        value: [
          { level: 1, value: 0.05 },
          { level: 70, value: 0.1 },
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
        actions: [3577],
        category: null,
        damageType: null,
      },
    ] as GaugeModifier[],
    elements: {
      classJobs: [7, 25],
      enochianLevel: 56,
      maxStacks: [
        { level: 1, value: 1 },
        { level: 20, value: 2 },
        { level: 35, value: 3 },
      ],
      actions: [
        { id: 152, change: [{ level: 1, change: { kind: 'set', element: 'astralFire', stacks: 'max' } }] },
        {
          id: 147,
          change: [
            { level: 1, change: { kind: 'fireSwitch' } },
            { level: 35, change: { kind: 'set', element: 'astralFire', stacks: 'max' } },
          ],
        },
      ],
    } as ElementRules,
  }
}

type Input = ReturnType<typeof validInput>

/** The error parsePeriodicDefs throws for the input after the change */
function errorOf(change: (input: Input) => void, options?: { requirePotency?: boolean }): PeriodicDefsError {
  const input = validInput()
  change(input)
  try {
    parsePeriodicDefs(input, options)
  } catch (error) {
    expect(error).toBeInstanceOf(PeriodicDefsError)
    return error as PeriodicDefsError
  }
  throw new Error('expected a PeriodicDefsError')
}

const statusAt = (input: Input, index: number) => input.statuses.statuses[index] as any
const actionAt = (input: Input, index: number) => input.actions.actions[index] as any
const sampleAt = (input: Input, index: number) => input.sampleActions.actions[index] as any
const actionTypeAt = (input: Input, index: number) => input.actionTypes.actions[index] as any
const gaugeAt = (input: Input, index: number) => input.gauge[index] as any
const elements = (input: Input) => input.elements as any

describe('parsePeriodicDefs', () => {
  it('reads valid data', () => {
    const defs = parsePeriodicDefs(validInput())
    expect(defs.version).toBe('7.57')
    expect(defs.maxLevel).toBe(100)
    expect(defs.periodic.get(1881)).toEqual({
      kind: 'damage',
      action: 16554,
      job: 33,
      potency: [
        { level: 1, potency: 65 },
        { level: 94, potency: 70 },
      ],
    })
    expect(defs.actionTypes.get(16554)).toEqual({ category: 'spell', attackType: 'magic' })
    expect(defs.actionTypes.get(24292)).toEqual({ category: 'ability', attackType: null })
    expect(defs.modifiers.get(1878)).toEqual([
      {
        type: 'damageDealt',
        valueFrom: 'applyByte',
        byteOf: null,
        stacked: false,
        category: null,
        damageType: null,
        zones: null,
        actions: null,
      },
    ])
    expect(defs.modifiers.get(786)).toEqual([
      { type: 'critRate', value: [{ level: 1, value: 0.1 }], stacked: false, zones: null, actions: null },
    ])
    expect(defs.modifiers.get(714)).toEqual([
      {
        type: 'damageTaken',
        value: [{ level: 1, value: 0.1 }],
        stacked: true,
        scope: 'source',
        category: null,
        damageType: null,
        zones: null,
        actions: null,
      },
    ])
    expect(defs.modifiers.get(1177)).toEqual([
      { type: 'forceCritical', zones: null, actions: [3549, 3550] },
      { type: 'forceDirect', zones: null, actions: null },
    ])
    expect(defs.calibration.get(25871)).toMatchObject([{ kind: 'damage', job: 33, gauge: false }])
    expect(defs.forced.get(16465)).toBe('criticalDirect')
    expect(defs.samples.get(7481)).toEqual([
      {
        job: 34,
        potency: {
          base: [{ level: 1, potency: 160 }],
          rear: [{ level: 1, potency: 210 }],
          combo: [
            { level: 1, potency: 320 },
            { level: 84, potency: 370 },
          ],
          comboRear: [
            { level: 1, potency: 370 },
            { level: 84, potency: 420 },
          ],
        },
      },
    ])
    expect(defs.gauge).toHaveLength(2)
    expect(defs.elements.actions).toHaveLength(2)
  })

  it('reads the status whose byte a status without an entry of its own takes', () => {
    const input = validInput()
    input.statuses.statuses.push({
      id: 2105,
      modifiers: [{ type: 'damageDealt', valueFrom: 'applyByte', byteOf: 1878 }],
    })
    expect(parsePeriodicDefs(input).modifiers.get(2105)).toMatchObject([{ valueFrom: 'applyByte', byteOf: 1878 }])
  })

  it.each([
    ['byteOf with a value', (modifier: any) => Object.assign(modifier, { value: [{ level: 1, value: 0.05 }] })],
    ['byteOf of 0', (modifier: any) => Object.assign(modifier, { valueFrom: 'applyByte', byteOf: 0 })],
    [
      'byteOf that is not an integer',
      (modifier: any) => Object.assign(modifier, { valueFrom: 'applyByte', byteOf: 1.5 }),
    ],
    [
      'byteOf a status without valueFrom',
      (modifier: any) => Object.assign(modifier, { valueFrom: 'applyByte', byteOf: 786 }),
    ],
    [
      'byteOf a status that is not listed',
      (modifier: any) => Object.assign(modifier, { valueFrom: 'applyByte', byteOf: 5 }),
    ],
  ])('rejects %s', (_, change) => {
    const error = errorOf((input) => {
      const modifier: Record<string, unknown> = { type: 'damageDealt', byteOf: 1878 }
      change(modifier)
      input.statuses.statuses.push({ id: 2105, modifiers: [modifier] })
    })
    expect(error.path).toBe('statuses[9].modifiers[0].byteOf')
  })

  it('reads a potency bonus with its conditions', () => {
    const input = validInput()
    input.statuses.statuses.push(
      { id: 2688, modifiers: [{ type: 'potencyBonus', category: 'weaponskill' }] },
      { id: 3001, modifiers: [{ type: 'potencyBonus', actions: [7481], zones: [446] }] },
    )
    const defs = parsePeriodicDefs(input)
    expect(defs.modifiers.get(2688)).toEqual([
      { type: 'potencyBonus', category: 'weaponskill', zones: null, actions: null },
    ])
    expect(defs.modifiers.get(3001)).toEqual([{ type: 'potencyBonus', category: null, zones: [446], actions: [7481] }])
  })

  it.each([
    ['a potency bonus with a value', { value: [{ level: 1, value: 0.1 }] }, 'value'],
    ['a potency bonus with stacked', { stacked: true }, 'stacked'],
    ['a potency bonus with an unknown category', { category: 'item' }, 'category'],
  ])('rejects %s', (_, fields, key) => {
    const error = errorOf((input) => {
      input.statuses.statuses.push({ id: 2688, modifiers: [{ type: 'potencyBonus', ...fields }] })
    })
    expect(error.path).toBe(`statuses[9].modifiers[0].${key}`)
  })

  it('takes a value of 0 at the levels before a trait adds the effect', () => {
    const input = validInput()
    statusAt(input, 3).modifiers[0].value = [
      { level: 1, value: 0 },
      { level: 94, value: 0.15 },
    ]
    expect(parsePeriodicDefs(input).modifiers.get(786)).toMatchObject([{ value: [{ value: 0 }, { value: 0.15 }] }])
  })

  it('takes a calibration of an action for each job', () => {
    const input = validInput()
    input.actions.actions.push({ ...actionAt(input, 0), job: 25 })
    expect(
      parsePeriodicDefs(input)
        .calibration.get(25871)
        ?.map((item) => item.job),
    ).toEqual([33, 25])
  })

  it('reads the changes of the elements by level', () => {
    expect(parsePeriodicDefs(validInput()).elements.actions[1].change).toEqual([
      { level: 1, change: { kind: 'fireSwitch' } },
      { level: 35, change: { kind: 'set', element: 'astralFire', stacks: 'max' } },
    ])
  })

  it('takes a sample action for each job that uses it', () => {
    const input = validInput()
    input.sampleActions.actions.push({ id: 7481, job: 30, potency: { base: [{ level: 1, potency: 100 }] } })
    expect(
      parsePeriodicDefs(input)
        .samples.get(7481)
        ?.map((item) => item.job),
    ).toEqual([34, 30])
  })

  it('does not look up the sample actions in the action types without requirePotency', () => {
    const input = validInput()
    delete statusAt(input, 0).periodic.potency
    input.actionTypes.actions = []
    expect(parsePeriodicDefs(input, { requirePotency: false }).samples.get(7481)).toHaveLength(1)
  })

  describe('level modifiers', () => {
    it('reads the modifiers of each level', () => {
      expect(parsePeriodicDefs(validInput()).levelModifiers.get(100)).toEqual({ sub: 420, div: 2780 })
    })

    it('rejects a missing level, a repeated level and a level above maxLevel', () => {
      expect(errorOf((input) => input.levelModifiers.levels.splice(67, 1))).toMatchObject({
        path: 'levelModifiers.levels',
        reason: 'level 68 is missing',
      })
      expect(errorOf((input) => (input.levelModifiers.levels[1].level = 1)).path).toBe('levelModifiers.levels[1].level')
      expect(errorOf((input) => (input.levelModifiers.levels[99].level = 101)).path).toBe(
        'levelModifiers.levels[99].level',
      )
    })

    it('rejects a div of 0', () => {
      expect(errorOf((input) => (input.levelModifiers.levels[0].div = 0)).path).toBe('levelModifiers.levels[0].div')
    })

    it('accepts an empty table without requirePotency', () => {
      const input = validInput()
      input.levelModifiers.levels = []
      expect(parsePeriodicDefs(input, { requirePotency: false }).levelModifiers.size).toBe(0)
    })
  })

  it('lets the filled fields be missing without requirePotency', () => {
    const input = validInput()
    delete statusAt(input, 0).periodic.potency
    delete actionAt(input, 0).calibration.potency
    input.actionTypes.actions = []
    const defs = parsePeriodicDefs(input, { requirePotency: false })
    expect(defs.periodic.get(1881)).toMatchObject({ potency: [] })
    expect(defs.calibration.get(25871)).toMatchObject([{ potency: [] }])
    expect(defs.actionTypes.size).toBe(0)

    expect(errorOf((input) => delete statusAt(input, 0).periodic.potency).path).toBe('statuses[0].periodic.potency')
    expect(errorOf((input) => (input.actionTypes.actions = [])).path).toBe('actionTypes.actions')
  })

  it.each([
    ['a missing field', (input: Input) => delete input.version.maxLevel, 'version.maxLevel'],
    ['an extra field', (input: Input) => Object.assign(input.version, { extra: 1 }), 'version.extra'],
    ['an empty version', (input: Input) => Object.assign(input.version, { version: '' }), 'version.version'],
    [
      'a level that is not positive',
      (input: Input) => Object.assign(input.version, { maxLevel: 0 }),
      'version.maxLevel',
    ],
    ['a status without id', (input: Input) => delete statusAt(input, 0).id, 'statuses[0].id'],
    ['an extra status field', (input: Input) => (statusAt(input, 0).name = 'x'), 'statuses[0].name'],
    ['a wrong kind', (input: Input) => (statusAt(input, 0).periodic.kind = 'dot'), 'statuses[0].periodic.kind'],
    [
      'a periodic action with its category',
      (input: Input) => (statusAt(input, 0).periodic.category = 'spell'),
      'statuses[0].periodic.category',
    ],
    [
      'a calibration action with its attack type',
      (input: Input) => (actionAt(input, 0).attackType = 'magic'),
      'actions[0].attackType',
    ],
    [
      'a wrong attack type',
      (input: Input) => (actionTypeAt(input, 0).attackType = 'fire'),
      'actionTypes.actions[0].attackType',
    ],
    [
      'a wrong action category',
      (input: Input) => (actionTypeAt(input, 0).category = 'item'),
      'actionTypes.actions[0].category',
    ],
    [
      'an extra action type field',
      (input: Input) => (actionTypeAt(input, 0).name = 'x'),
      'actionTypes.actions[0].name',
    ],
    ['action types out of order', (input: Input) => (actionTypeAt(input, 2).id = 16554), 'actionTypes.actions[2].id'],
    [
      'a periodic action the action types do not list',
      (input: Input) => input.actionTypes.actions.splice(1, 1),
      'statuses[0].periodic.action',
    ],
    [
      'a calibration action the action types do not list',
      (input: Input) => input.actionTypes.actions.splice(5, 1),
      'actions[0].id',
    ],
    [
      'a string action',
      (input: Input) => (statusAt(input, 0).periodic.action = '16554'),
      'statuses[0].periodic.action',
    ],
    [
      'a repeated status',
      (input: Input) => input.statuses.statuses.push({ id: 1881, modifiers: [{ type: 'forceDirect' }] }),
      'statuses[9].id',
    ],
    ['an entry with neither field', (input: Input) => input.statuses.statuses.push({ id: 5 }), 'statuses[9]'],
    ['empty modifiers', (input: Input) => (statusAt(input, 2).modifiers = []), 'statuses[2].modifiers'],
    [
      'an unknown type',
      (input: Input) => (statusAt(input, 2).modifiers[0].type = 'damage'),
      'statuses[2].modifiers[0].type',
    ],
    [
      'a value of 0 at every level',
      (input: Input) => (statusAt(input, 3).modifiers[0].value = [{ level: 1, value: 0 }]),
      'statuses[3].modifiers[0].value',
    ],
    [
      'a value of -1',
      (input: Input) => (statusAt(input, 3).modifiers[0].value = [{ level: 1, value: -1 }]),
      'statuses[3].modifiers[0].value[0].value',
    ],
    [
      'a value that is not a table',
      (input: Input) => (statusAt(input, 3).modifiers[0].value = 0.1),
      'statuses[3].modifiers[0].value',
    ],
    [
      'both value and valueFrom',
      (input: Input) => (statusAt(input, 2).modifiers[0].value = [{ level: 1, value: 0.06 }]),
      'statuses[2].modifiers[0].valueFrom',
    ],
    [
      'neither value nor valueFrom',
      (input: Input) => delete statusAt(input, 2).modifiers[0].valueFrom,
      'statuses[2].modifiers[0].value',
    ],
    [
      'valueFrom on a rate',
      (input: Input) => (statusAt(input, 3).modifiers[0].valueFrom = 'applyByte'),
      'statuses[3].modifiers[0].valueFrom',
    ],
    [
      'valueAction with valueFrom',
      (input: Input) => (statusAt(input, 2).modifiers[0].valueAction = 16552),
      'statuses[2].modifiers[0].valueAction',
    ],
    [
      'a rate with category',
      (input: Input) => (statusAt(input, 3).modifiers[0].category = 'spell'),
      'statuses[3].modifiers[0].category',
    ],
    [
      'a rate with damageType',
      (input: Input) => (statusAt(input, 3).modifiers[0].damageType = 'magic'),
      'statuses[3].modifiers[0].damageType',
    ],
    [
      'a heal multiplier with damageType',
      (input: Input) => (statusAt(input, 7).modifiers[0].damageType = 'magic'),
      'statuses[7].modifiers[0].damageType',
    ],
    [
      'a missing scope',
      (input: Input) => delete statusAt(input, 4).modifiers[0].scope,
      'statuses[4].modifiers[0].scope',
    ],
    [
      'a scope on the caster',
      (input: Input) => (statusAt(input, 3).modifiers[0].scope = 'all'),
      'statuses[3].modifiers[0].scope',
    ],
    [
      'a wrong scope',
      (input: Input) => (statusAt(input, 4).modifiers[0].scope = 'party'),
      'statuses[4].modifiers[0].scope',
    ],
    ['empty zones', (input: Input) => (statusAt(input, 5).modifiers[0].zones = []), 'statuses[5].modifiers[0].zones'],
    [
      'empty actions',
      (input: Input) => (statusAt(input, 8).modifiers[0].actions = []),
      'statuses[8].modifiers[0].actions',
    ],
    [
      'a repeated zone',
      (input: Input) => (statusAt(input, 5).modifiers[0].zones = [446, 446]),
      'statuses[5].modifiers[0].zones',
    ],
    [
      'stacked false',
      (input: Input) => (statusAt(input, 6).modifiers[0].stacked = false),
      'statuses[6].modifiers[0].stacked',
    ],
    [
      'a value on a force',
      (input: Input) => (statusAt(input, 8).modifiers[0].value = 1),
      'statuses[8].modifiers[0].value',
    ],
    ['an action without fields', (input: Input) => input.actions.actions.push({ id: 7 }), 'actions[4]'],
    [
      'a repeated action',
      (input: Input) => input.actions.actions.push({ id: 16465, forced: 'critical' }),
      'actions[4].id',
    ],
    ['a wrong forced', (input: Input) => (actionAt(input, 3).forced = 'always'), 'actions[3].forced'],
    ['a job without calibration', (input: Input) => (actionAt(input, 3).job = 33), 'actions[3].job'],
    ['a calibration without job', (input: Input) => delete actionAt(input, 0).job, 'actions[0].job'],
    ['gauge false', (input: Input) => (actionAt(input, 0).calibration.gauge = false), 'actions[0].calibration.gauge'],
    [
      'a damage status without calibration',
      (input: Input) => (actionAt(input, 0).calibration.kind = 'heal'),
      'statuses[0].periodic.job',
    ],
    [
      'a heal status without calibration',
      (input: Input) => input.actions.actions.splice(2, 1),
      'statuses[1].periodic.job',
    ],
    ['an empty table', (input: Input) => (statusAt(input, 0).periodic.potency = []), 'statuses[0].periodic.potency'],
    [
      'a table from level 2',
      (input: Input) => (statusAt(input, 0).periodic.potency = [{ level: 2, potency: 70 }]),
      'statuses[0].periodic.potency[0].level',
    ],
    [
      'levels that do not ascend',
      (input: Input) =>
        (actionAt(input, 0).calibration.potency = [
          { level: 1, potency: 250 },
          { level: 1, potency: 270 },
        ]),
      'actions[0].calibration.potency[1].level',
    ],
    [
      'a level above maxLevel',
      (input: Input) =>
        (actionAt(input, 0).calibration.potency = [
          { level: 1, potency: 250 },
          { level: 101, potency: 270 },
        ]),
      'actions[0].calibration.potency[1].level',
    ],
    [
      'the same potency twice',
      (input: Input) =>
        (actionAt(input, 0).calibration.potency = [
          { level: 1, potency: 250 },
          { level: 94, potency: 250 },
        ]),
      'actions[0].calibration.potency[1].potency',
    ],
    ['a gauge other than BlackMage', (input: Input) => (gaugeAt(input, 0).gauge = 'Machinist'), 'gauge[0].gauge'],
    ['a when that is not a function', (input: Input) => (gaugeAt(input, 0).when = true), 'gauge[0].when'],
    ['a potency modifier without actions', (input: Input) => (gaugeAt(input, 1).actions = null), 'gauge[1].actions'],
    [
      'a gauge value table from level 2',
      (input: Input) => (gaugeAt(input, 1).value = [{ level: 2, value: 0.8 }]),
      'gauge[1].value[0].level',
    ],
    ['a missing gauge condition', (input: Input) => delete gaugeAt(input, 0).category, 'gauge[0].category'],
    [
      'an enochian level above maxLevel',
      (input: Input) => (elements(input).enochianLevel = 101),
      'elements.enochianLevel',
    ],
    [
      'four stacks',
      (input: Input) =>
        (elements(input).maxStacks = [
          { level: 1, value: 1 },
          { level: 35, value: 4 },
        ]),
      'elements.maxStacks[1].value',
    ],
    [
      'zero stacks',
      (input: Input) => (elements(input).maxStacks = [{ level: 1, value: 0 }]),
      'elements.maxStacks[0].value',
    ],
    [
      'a repeated element action',
      (input: Input) => elements(input).actions.push({ id: 147, change: [{ level: 1, change: { kind: 'ice' } }] }),
      'elements.actions[2].id',
    ],
    [
      'a set without element',
      (input: Input) => delete elements(input).actions[0].change[0].change.element,
      'elements.actions[0].change[0].change.element',
    ],
    [
      'a set without stacks',
      (input: Input) => delete elements(input).actions[0].change[0].change.stacks,
      'elements.actions[0].change[0].change.stacks',
    ],
    [
      'a switch with element',
      (input: Input) => (elements(input).actions[1].change[0].change.element = 'astralFire'),
      'elements.actions[1].change[0].change.element',
    ],
    [
      'a switch with stacks',
      (input: Input) => (elements(input).actions[1].change[0].change.stacks = 1),
      'elements.actions[1].change[0].change.stacks',
    ],
    [
      'set stacks of 4',
      (input: Input) => (elements(input).actions[0].change[0].change.stacks = 4),
      'elements.actions[0].change[0].change.stacks',
    ],
    [
      'a change table from level 2',
      (input: Input) => (elements(input).actions[1].change[0].level = 2),
      'elements.actions[1].change[0].level',
    ],
    [
      'the same change twice',
      (input: Input) => (elements(input).actions[1].change[1].change = { kind: 'fireSwitch' }),
      'elements.actions[1].change[1].change',
    ],
    [
      'a change that is not a table',
      (input: Input) => (elements(input).actions[0].change = { kind: 'fire' }),
      'elements.actions[0].change',
    ],
    [
      'a calibration listed twice for one job',
      (input: Input) => input.actions.actions.push({ ...actionAt(input, 0) }),
      'actions[4].id',
    ],
    [
      'a sample action the action types do not list',
      (input: Input) => input.actionTypes.actions.splice(0, 1),
      'sampleActions.actions[0].id',
    ],
    [
      'a sample action listed twice for one job',
      (input: Input) => input.sampleActions.actions.push({ ...sampleAt(input, 0) }),
      'sampleActions.actions[1].id',
    ],
    [
      'a sample action without a base potency',
      (input: Input) => delete sampleAt(input, 0).potency.base,
      'sampleActions.actions[0].potency.base',
    ],
    [
      'an unknown sample potency',
      (input: Input) => (sampleAt(input, 0).potency.frontal = [{ level: 1, potency: 200 }]),
      'sampleActions.actions[0].potency.frontal',
    ],
    ['a sample action without job', (input: Input) => delete sampleAt(input, 0).job, 'sampleActions.actions[0].job'],
    [
      'an empty sample potency table',
      (input: Input) => (sampleAt(input, 0).potency.rear = []),
      'sampleActions.actions[0].potency.rear',
    ],
    [
      'an action forced twice',
      (input: Input) => input.actions.actions.push({ id: 16465, job: 33, forced: 'critical' }),
      'actions[4].forced',
    ],
  ])('rejects %s', (_, change, path) => {
    expect(errorOf(change).path).toBe(path)
  })
})

/** Two files that share Rampart and its status, as the role actions of the tanks */
function classJobFiles() {
  const rampart = () => ({
    id: 1191,
    modifiers: [{ type: 'damageTaken', value: [{ level: 1, value: -0.2 }], scope: 'all' }],
  })
  return [
    {
      name: 'ClassJobActions/Paladin',
      content: {
        classJob: 19,
        statuses: [
          rampart(),
          { id: 725, periodic: { kind: 'damage', action: 3538, potency: [{ level: 1, potency: 30 }] } },
        ] as Record<string, any>[],
        actions: [
          {
            id: 9,
            category: 'weaponskill',
            attackType: 'physical',
            calibration: { kind: 'damage', potency: [{ level: 1, potency: 220 }] },
            potency: { base: [{ level: 1, potency: 220 }] },
          },
          { id: 3538, category: 'weaponskill', attackType: 'physical' },
          { id: 7531, category: 'ability', attackType: null },
        ] as Record<string, any>[],
      } as Record<string, any>,
    },
    {
      name: 'ClassJobActions/Warrior',
      content: {
        classJob: 21,
        statuses: [rampart()] as Record<string, any>[],
        actions: [
          {
            id: 31,
            category: 'weaponskill',
            attackType: 'physical',
            calibration: { kind: 'damage', potency: [{ level: 1, potency: 240 }] },
          },
          { id: 7531, category: 'ability', attackType: null },
          { id: 16465, category: 'weaponskill', attackType: 'physical', forced: 'criticalDirect' },
        ] as Record<string, any>[],
      } as Record<string, any>,
    },
  ]
}

type Files = ReturnType<typeof classJobFiles>

/** The data the files give with the rest of a valid input */
const defsOf = (files: Files) => parsePeriodicDefs({ ...validInput(), ...mergeClassJobActions(files) })

/** The error that merging the files, or reading the merged input, throws after the change */
function mergeErrorOf(change: (files: Files) => void): PeriodicDefsError {
  const files = classJobFiles()
  change(files)
  try {
    defsOf(files)
  } catch (error) {
    expect(error).toBeInstanceOf(PeriodicDefsError)
    return error as PeriodicDefsError
  }
  throw new Error('expected a PeriodicDefsError')
}

describe('mergeClassJobActions', () => {
  it('gives each entry the job of its file', () => {
    const defs = defsOf(classJobFiles())
    expect(defs.periodic.get(725)?.job).toBe(19)
    expect(defs.calibration.get(9)).toMatchObject([{ job: 19 }])
    expect(defs.calibration.get(31)).toMatchObject([{ job: 21 }])
    expect(defs.samples.get(9)).toMatchObject([{ job: 19 }])
    expect(defs.forced.get(16465)).toBe('criticalDirect')
  })

  it('lists a shared status and action once', () => {
    const merged = mergeClassJobActions(classJobFiles())
    expect(merged.statuses.statuses.filter((entry: any) => entry.id === 1191)).toHaveLength(1)
    expect(merged.actionTypes.actions.map((entry) => entry.id)).toEqual([9, 31, 3538, 7531, 16465])
    expect(defsOf(classJobFiles()).actionTypes.get(7531)).toEqual({ category: 'ability', attackType: null })
  })

  it('gives the forced result of an action in several files once', () => {
    const files = classJobFiles()
    files[0].content.actions.push({
      id: 16465,
      category: 'weaponskill',
      attackType: 'physical',
      forced: 'criticalDirect',
    })
    files[1].content.actions[2].calibration = { kind: 'damage', potency: [{ level: 1, potency: 500 }] }
    expect(defsOf(files).forced.get(16465)).toBe('criticalDirect')
    const forced = mergeClassJobActions(files).actions.actions.filter((entry: any) => 'forced' in entry)
    expect(forced).toHaveLength(1)
  })

  it.each([
    ['an unknown field of a file', (files: Files) => (files[0].content.extra = 1), 'ClassJobActions/Paladin.extra'],
    [
      'a class or job given twice',
      (files: Files) => (files[1].content.classJob = 19),
      'ClassJobActions/Warrior.classJob',
    ],
    [
      'actions out of order',
      (files: Files) => files[1].content.actions.reverse(),
      'ClassJobActions/Warrior.actions[1].id',
    ],
    [
      'the job of a periodic status',
      (files: Files) => (files[0].content.statuses[1].periodic.job = 19),
      'ClassJobActions/Paladin.statuses[1].periodic.job',
    ],
    [
      'the job of an action',
      (files: Files) => (files[0].content.actions[0].job = 19),
      'ClassJobActions/Paladin.actions[0].job',
    ],
    [
      'the job of a calibration',
      (files: Files) => (files[0].content.actions[0].calibration.job = 19),
      'ClassJobActions/Paladin.actions[0].calibration.job',
    ],
    [
      'a shared status that differs',
      (files: Files) => (files[1].content.statuses[0].modifiers[0].scope = 'source'),
      'ClassJobActions/Warrior.statuses[0]',
    ],
    [
      'a shared action of another category',
      (files: Files) => (files[1].content.actions[1].category = 'spell'),
      'ClassJobActions/Warrior.actions[1].category',
    ],
    [
      'a shared action with another forced result',
      (files: Files) => (files[1].content.actions[1].forced = 'critical'),
      'ClassJobActions/Warrior.actions[1].forced',
    ],
  ])('rejects %s', (_, change, path) => {
    expect(mergeErrorOf(change).path).toBe(path)
  })

  it('names the shared status an entry differs from', () => {
    const error = mergeErrorOf((files) => (files[1].content.statuses[0].modifiers[0].scope = 'source'))
    expect(error.reason).toBe('status 1191 differs from ClassJobActions/Paladin.statuses[0]')
  })

  it.each([
    [
      'a status',
      (files: Files) => {
        for (const file of files) file.content.statuses[0].modifiers[0].scope = 'party'
      },
      'ClassJobActions/Paladin.statuses[0].modifiers[0].scope',
    ],
    [
      'a periodic status',
      (files: Files) => (files[0].content.statuses[1].periodic.kind = 'mana'),
      'ClassJobActions/Paladin.statuses[1].periodic.kind',
    ],
    [
      'a calibration',
      (files: Files) => (files[1].content.actions[0].calibration.kind = 'mana'),
      'ClassJobActions/Warrior.actions[0].calibration.kind',
    ],
    [
      'a forced result',
      (files: Files) => (files[1].content.actions[2].forced = 'never'),
      'ClassJobActions/Warrior.actions[2].forced',
    ],
    [
      'a sample potency',
      (files: Files) => (files[0].content.actions[0].potency.base = []),
      'ClassJobActions/Paladin.actions[0].potency.base',
    ],
    [
      'an action type',
      (files: Files) => (files[0].content.actions[1].attackType = 'fire'),
      'ClassJobActions/Paladin.actions[1].attackType',
    ],
  ])('gives the path in its file of an error in %s', (_, change, path) => {
    expect(mergeErrorOf(change).path).toBe(path)
  })
})

describe('potencyAt', () => {
  const table = [
    { level: 1, potency: 250 },
    { level: 94, potency: 270 },
  ]

  it('takes the last entry at or below the level', () => {
    expect(potencyAt(table, 1, 100)).toBe(250)
    expect(potencyAt(table, 93, 100)).toBe(250)
    expect(potencyAt(table, 94, 100)).toBe(270)
    expect(potencyAt(table, 100, 100)).toBe(270)
  })

  it('has no potency at level 0 or above maxLevel', () => {
    expect(potencyAt(table, 0, 100)).toBeNull()
    expect(potencyAt(table, 101, 100)).toBeNull()
  })
})

describe('valueAt', () => {
  const table = [
    { level: 1, value: 0.1 },
    { level: 78, value: 0.13 },
  ]

  it('takes the last entry at or below the level, and the last one for an unknown level', () => {
    expect(valueAt(table, 77)).toBe(0.1)
    expect(valueAt(table, 78)).toBe(0.13)
    expect(valueAt(table, 0)).toBe(0.13)
  })
})

describe('periodicDefs', () => {
  it('loads the data shipped with the parser', () => {
    expect(periodicDefs.version).toBe('7.57')
  })

  it('has the level modifiers of every level, as the wiki lists them', () => {
    const { levelModifiers, maxLevel } = periodicDefs
    for (let level = 1; level <= maxLevel; level++) expect(levelModifiers.has(level)).toBe(true)
    expect(levelModifiers.get(70)).toEqual({ sub: 364, div: 900 })
    expect(levelModifiers.get(80)).toEqual({ sub: 380, div: 1300 })
    expect(levelModifiers.get(90)).toEqual({ sub: 400, div: 1900 })
    expect(levelModifiers.get(100)).toEqual({ sub: 420, div: 2780 })
  })

  it('has the combo and positional potencies of the sample actions', () => {
    const [stormsPath] = periodicDefs.samples.get(37) ?? []
    expect(stormsPath.job).toBe(21)
    expect(potencyAt(stormsPath.potency.base, 100, 100)).toBe(190)
    expect(potencyAt(stormsPath.potency.combo ?? [], 100, 100)).toBe(340)
    const [gekko] = periodicDefs.samples.get(7481) ?? []
    expect(Object.keys(gekko.potency).sort()).toEqual(['base', 'combo', 'comboRear', 'rear'])
    // Actions that no job learns, one that another action raises, and one whose potency depends on the stacks
    for (const id of [16196, 7487, 36946, 24385]) expect(periodicDefs.samples.has(id)).toBe(false)
  })

  it('leaves out the actions of PvP', () => {
    for (const id of [29716, 41494, 29236]) expect(periodicDefs.actionTypes.has(id)).toBe(false)
  })

  it('gives a sample action only to the jobs that learn it', () => {
    // Ruin and Ruin II of the scholar; it does not learn Fester, Energy Drain or the gemstone summons of the arcanist
    for (const id of [17869, 17870]) expect(periodicDefs.samples.get(id)?.map((item) => item.job)).toEqual([28])
    for (const id of [181, 16508, 25802, 25803, 25804]) {
      expect(periodicDefs.samples.get(id)?.map((item) => item.job)).not.toContain(28)
    }
  })
})
