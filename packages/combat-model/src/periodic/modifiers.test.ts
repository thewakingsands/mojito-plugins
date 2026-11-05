import { describe, expect, it, vi } from 'vitest'
import type { GaugeModifier } from '../defs.js'
import {
  ASTROLOGIAN,
  BLACK_MAGE,
  buff,
  ENEMY,
  SAGE,
  SAMURAI,
  testCombatants,
  testDefs,
  testElements,
} from '../testing/periodic.js'
import { ElementTracker } from './elements.js'
import { type ActionInfo, ModifierCalculator, type ModifierQuery } from './modifiers.js'

const MALEFIC: ActionInfo = { id: 25871, category: 'spell', attackType: 'magic' }
const HIGANBANA: ActionInfo = { id: 7489, category: 'weaponskill', attackType: 'physical' }
const ATTACK: ActionInfo = { id: 7, category: null, attackType: null }
const DIAGNOSIS: ActionInfo = { id: 24284, category: 'spell', attackType: 'magic' }
const FIRE_III: ActionInfo = { id: 152, category: 'spell', attackType: 'magic' }
const BLIZZARD_III: ActionInfo = { id: 154, category: 'spell', attackType: 'magic' }
const PET_ACTION: ActionInfo = { id: 16504, category: 'ability', attackType: 'magic' }
const PET = 0x40000010

function setup(options: { bytes?: Map<string, number>; defs?: ReturnType<typeof testDefs> } = {}) {
  const combatants = testCombatants()
  const defs = options.defs ?? testDefs()
  const elements = new ElementTracker(testElements, combatants)
  const bytes = options.bytes ?? new Map()
  const calculator = new ModifierCalculator(
    defs,
    combatants,
    elements,
    (holder, source, status) => bytes.get(`${holder} ${source} ${status}`) ?? null,
  )
  let slot = 0
  const give = (holder: number, status: number, source: number, extra = 0) =>
    combatants.buffUpdate(holder, slot++, buff(status, source, extra))
  const damage = (caster: number, action: ActionInfo, target = ENEMY): ModifierQuery => ({
    kind: 'damage',
    caster,
    target,
    action,
  })
  return { combatants, elements, calculator, give, damage }
}

describe('ModifierCalculator', () => {
  it('multiplies the modifiers of the caster and the target', () => {
    const { calculator, give, damage } = setup()
    give(ASTROLOGIAN, 1239, ASTROLOGIAN)
    give(ENEMY, 3849, SAMURAI)
    const result = calculator.compute(damage(ASTROLOGIAN, MALEFIC))
    expect(result.multiplier).toBeCloseTo(1.1 * 1.05, 12)
    expect(result.effects).toEqual([
      { statusId: 1239, sourceId: ASTROLOGIAN, holder: 'caster', type: 'multiplier', value: 1.1 },
      { statusId: 3849, sourceId: SAMURAI, holder: 'target', type: 'multiplier', value: 1.05 },
    ])
  })

  it('reads the statuses of one side only when it is asked to', () => {
    const { calculator, give, damage } = setup()
    give(ASTROLOGIAN, 1239, ASTROLOGIAN)
    give(ASTROLOGIAN, 786, SAMURAI)
    give(ENEMY, 3849, SAMURAI)
    give(ENEMY, 1221, SAGE)
    const caster = calculator.compute(damage(ASTROLOGIAN, MALEFIC), 'caster')
    expect(caster).toMatchObject({ multiplier: 1.1, critRate: 0.1 })
    expect(caster.effects.map((effect) => effect.holder)).toEqual(['caster', 'caster'])
    const target = calculator.compute(damage(ASTROLOGIAN, MALEFIC), 'target')
    expect(target.multiplier).toBeCloseTo(1.05, 12)
    expect(target.critRate).toBeCloseTo(0.1, 12)
    expect(target.effects.map((effect) => effect.holder)).toEqual(['target', 'target'])
  })

  it('counts a modifier with scope source for its source only', () => {
    const { calculator, give, damage } = setup()
    give(ENEMY, 2586, SAMURAI)
    expect(calculator.compute(damage(SAMURAI, HIGANBANA)).multiplier).toBeCloseTo(1.1, 12)
    expect(calculator.compute(damage(ASTROLOGIAN, MALEFIC)).multiplier).toBe(1)
  })

  it('adds the rates for damage and leaves them out of heals', () => {
    const { calculator, give, damage } = setup()
    give(ASTROLOGIAN, 786, SAMURAI)
    give(ASTROLOGIAN, 141, SAMURAI)
    give(ENEMY, 1221, SAGE)
    const result = calculator.compute(damage(ASTROLOGIAN, MALEFIC))
    expect(result.critRate).toBeCloseTo(0.2, 12)
    expect(result.directRate).toBeCloseTo(0.2, 12)
    expect(result.effects.map((effect) => effect.type)).toEqual(['critical', 'direct', 'critical'])

    const heal = calculator.compute({ kind: 'heal', caster: ASTROLOGIAN, target: SAGE, action: DIAGNOSIS })
    expect(heal.critRate).toBe(0)
    expect(heal.directRate).toBe(0)
    expect(heal.effects).toEqual([])
  })

  it('forces the results of the actions it lists, and of all but auto attacks without a list', () => {
    const { calculator, give, damage } = setup()
    expect(calculator.compute(damage(SAMURAI, { ...HIGANBANA, id: 16465 }))).toMatchObject({
      forcedCritical: true,
      forcedDirect: true,
    })
    give(SAMURAI, 1177, SAMURAI)
    expect(calculator.compute(damage(SAMURAI, { ...HIGANBANA, id: 3549 })).forcedCritical).toBe(true)
    expect(calculator.compute(damage(SAMURAI, HIGANBANA)).forcedCritical).toBe(false)
    give(SAMURAI, 851, SAMURAI)
    expect(calculator.compute(damage(SAMURAI, HIGANBANA)).forcedDirect).toBe(true)
    expect(calculator.compute(damage(SAMURAI, ATTACK))).toMatchObject({ forcedCritical: false, forcedDirect: false })
    // The forced results come with the caster
    expect(calculator.compute(damage(SAMURAI, HIGANBANA), 'target').forcedDirect).toBe(false)
    expect(calculator.compute(damage(SAMURAI, HIGANBANA), 'caster').forcedDirect).toBe(true)
  })

  it('marks a potency bonus of the caster by its category or its actions', () => {
    const { calculator, give, damage } = setup()
    const ability: ActionInfo = { id: 7499, category: 'ability', attackType: 'physical' }
    expect(calculator.compute(damage(SAMURAI, HIGANBANA)).potencyBonus).toBe(false)
    give(SAMURAI, 2688, SAMURAI)
    expect(calculator.compute(damage(SAMURAI, HIGANBANA)).potencyBonus).toBe(true)
    expect(calculator.compute(damage(SAMURAI, ability)).potencyBonus).toBe(false)
    expect(calculator.compute(damage(SAMURAI, HIGANBANA), 'target').potencyBonus).toBe(false)

    const listed = setup()
    listed.give(SAMURAI, 3001, SAMURAI)
    expect(listed.calculator.compute(listed.damage(SAMURAI, HIGANBANA)).potencyBonus).toBe(true)
    expect(listed.calculator.compute(listed.damage(SAMURAI, { ...HIGANBANA, id: 7477 })).potencyBonus).toBe(false)

    const all = setup()
    all.give(SAMURAI, 3002, SAMURAI)
    expect(all.calculator.compute(all.damage(SAMURAI, ability)).potencyBonus).toBe(true)
    expect(all.calculator.compute(all.damage(SAMURAI, ATTACK)).potencyBonus).toBe(false)
  })

  it('leaves out a potency bonus on the target', () => {
    const { calculator, give, damage } = setup()
    give(ENEMY, 2688, SAMURAI)
    expect(calculator.compute(damage(SAMURAI, HIGANBANA)).potencyBonus).toBe(false)
  })

  it('counts a zone modifier in its zones only', () => {
    const { calculator, give, damage } = setup()
    give(SAMURAI, 444, SAMURAI)
    expect(calculator.compute(damage(SAMURAI, HIGANBANA)).multiplier).toBe(1)
    calculator.zone = 1
    expect(calculator.compute(damage(SAMURAI, HIGANBANA)).multiplier).toBe(1)
    calculator.zone = 446
    expect(calculator.compute(damage(SAMURAI, HIGANBANA)).multiplier).toBeCloseTo(1.25, 12)
  })

  it('checks the actions, the category and the damage type', () => {
    const { calculator, give, damage } = setup()
    give(SAMURAI, 901, SAMURAI)
    expect(calculator.compute(damage(SAMURAI, HIGANBANA)).multiplier).toBeCloseTo(1.3, 12)
    expect(calculator.compute(damage(SAMURAI, { ...HIGANBANA, id: 7477 })).multiplier).toBe(1)

    const second = setup()
    second.give(SAMURAI, 902, SAMURAI)
    expect(second.calculator.compute(second.damage(SAMURAI, HIGANBANA)).multiplier).toBeCloseTo(1.4, 12)
    expect(second.calculator.compute(second.damage(SAMURAI, { ...HIGANBANA, category: 'ability' })).multiplier).toBe(1)

    const third = setup()
    third.give(SAMURAI, 900, SAMURAI)
    for (const attackType of ['slashing', 'piercing', 'blunt', 'shot', 'physical'] as const) {
      expect(third.calculator.compute(third.damage(SAMURAI, { ...HIGANBANA, attackType })).multiplier).toBeCloseTo(
        1.2,
        12,
      )
    }
    expect(third.calculator.compute(third.damage(SAMURAI, MALEFIC)).multiplier).toBe(1)
    expect(third.calculator.compute(third.damage(SAMURAI, ATTACK)).multiplier).toBe(1)
  })

  it('counts the heal multipliers for spells and abilities only', () => {
    const { calculator, give } = setup()
    give(SAGE, 1892, SAGE)
    give(ASTROLOGIAN, 2622, SAGE)
    const heal = (action: ActionInfo) => calculator.compute({ kind: 'heal', caster: SAGE, target: ASTROLOGIAN, action })
    expect(heal(DIAGNOSIS).multiplier).toBeCloseTo(1.2 * 1.2, 12)
    expect(heal({ ...DIAGNOSIS, category: 'ability' }).multiplier).toBeCloseTo(1.44, 12)
    expect(heal({ ...DIAGNOSIS, category: 'weaponskill' }).multiplier).toBe(1)
  })

  it('reads the signed byte of the entry that applied the status', () => {
    const bytes = new Map([[`${SAMURAI} ${ASTROLOGIAN} 1878`, 6]])
    const { calculator, give, damage } = setup({ bytes })
    give(SAMURAI, 1878, ASTROLOGIAN)
    expect(calculator.compute(damage(SAMURAI, HIGANBANA)).multiplier).toBeCloseTo(1.06, 12)
    bytes.set(`${SAMURAI} ${ASTROLOGIAN} 1878`, -10)
    expect(calculator.compute(damage(SAMURAI, HIGANBANA)).multiplier).toBeCloseTo(0.9, 12)
    bytes.clear()
    expect(calculator.compute(damage(SAMURAI, HIGANBANA)).multiplier).toBe(1)
  })

  describe('a pet with its owner', () => {
    it('takes the statuses other players put on the owner, with the bytes of the owner', () => {
      const bytes = new Map([[`${SAMURAI} ${ASTROLOGIAN} 1878`, 6]])
      const { calculator, give, damage } = setup({ bytes })
      give(SAMURAI, 1878, ASTROLOGIAN)
      give(SAMURAI, 786, SAGE)
      const result = calculator.compute({ ...damage(PET, PET_ACTION), owner: SAMURAI })
      expect(result.multiplier).toBeCloseTo(1.06, 12)
      expect(result.critRate).toBeCloseTo(0.1, 12)
      expect(result.effects).toEqual([
        { statusId: 1878, sourceId: ASTROLOGIAN, holder: 'caster', type: 'multiplier', value: 1.06 },
        { statusId: 786, sourceId: SAGE, holder: 'caster', type: 'critical', value: 0.1 },
      ])
    })

    it('leaves out the statuses the owner put on itself', () => {
      const { calculator, give, damage } = setup()
      give(SAMURAI, 1298, SAMURAI)
      expect(calculator.compute({ ...damage(PET, PET_ACTION), owner: SAMURAI }).effects).toEqual([])
    })

    it('counts a status on both the pet and the owner once', () => {
      const { combatants, calculator, give, damage } = setup()
      combatants.update(PET, { bNpcBase: 10490, ownerId: SAMURAI }, true)
      give(SAMURAI, 786, SAGE)
      give(PET, 786, SAGE)
      give(PET, 1298, SAMURAI)
      const result = calculator.compute({ ...damage(PET, PET_ACTION), owner: SAMURAI })
      expect(result.effects.map((effect) => effect.statusId)).toEqual([786, 1298])
      expect(result.critRate).toBeCloseTo(0.1, 12)
    })
  })

  it('multiplies a stacked value by the stacks', () => {
    const { calculator, give, damage } = setup()
    give(ENEMY, 714, SAGE, 3)
    expect(calculator.compute(damage(SAMURAI, HIGANBANA)).multiplier).toBeCloseTo(1.3, 12)
  })

  it('takes the value at the level of the source of the status', () => {
    const { combatants, calculator, give, damage } = setup()
    give(SAMURAI, 1298, SAMURAI)
    expect(calculator.compute(damage(SAMURAI, HIGANBANA)).multiplier).toBeCloseTo(1.13, 12)
    combatants.update(SAMURAI, { level: 77 })
    expect(calculator.compute(damage(SAMURAI, HIGANBANA)).multiplier).toBeCloseTo(1.1, 12)
  })

  describe('the gauge', () => {
    it.each([
      // [stance, Enochian, multiplier of Fire III, potency of Fire III, potency of Blizzard III]
      [3, true, 1.27, 1.8, 0.7],
      [3, false, 1, 1.8, 0.7],
      [-3, true, 1.27, 0.7, 1],
      [-3, false, 1, 0.7, 1],
      [0, false, 1, 1, 1],
      [0, true, 1.27, 1, 1],
    ])('applies with stance %i and Enochian %s', (stance, enochian, multiplier, fire, ice) => {
      const { elements, calculator, damage } = setup()
      elements.handleGauge(BLACK_MAGE, { job: 'BlackMage', elementStance: stance, enochianActive: enochian })
      const result = calculator.compute(damage(BLACK_MAGE, FIRE_III))
      expect(result.multiplier).toBeCloseTo(multiplier, 12)
      expect(result.potencyFactor).toBeCloseTo(fire, 12)
      expect(calculator.compute(damage(BLACK_MAGE, BLIZZARD_III)).potencyFactor).toBeCloseTo(ice, 12)
    })

    it('does not call the conditions of an unknown state', () => {
      const when = vi.fn(() => true)
      const modifier: GaugeModifier = {
        gauge: 'BlackMage',
        when,
        type: 'damageDealt',
        value: [{ level: 1, value: 0.5 }],
        actions: null,
        category: null,
        damageType: null,
      }
      const { calculator, elements, damage } = setup()
      const defs = { ...testDefs(), gauge: [modifier] }
      const unknown = new ModifierCalculator(
        defs,
        testCombatants(),
        new ElementTracker(testElements, testCombatants()),
        () => null,
      )
      expect(unknown.compute(damage(BLACK_MAGE, FIRE_III)).multiplier).toBe(1)
      expect(when).not.toHaveBeenCalled()
      elements.applyAction(BLACK_MAGE, 152)
      expect(calculator.compute(damage(BLACK_MAGE, FIRE_III)).potencyFactor).toBeCloseTo(1.8, 12)
    })

    it('takes Enochian at the level of the caster', () => {
      const { combatants, elements, calculator, damage } = setup()
      elements.applyAction(BLACK_MAGE, 152)
      const result = calculator.compute(damage(BLACK_MAGE, MALEFIC))
      expect(result.multiplier).toBeCloseTo(1.27, 12)
      // Enochian is a modifier of the caster itself, without a status
      expect(result.effects).toEqual([
        { statusId: 0, sourceId: BLACK_MAGE, holder: 'caster', type: 'multiplier', value: 1.27 },
      ])
      expect(calculator.compute(damage(BLACK_MAGE, MALEFIC), 'target').effects).toEqual([])
      combatants.update(BLACK_MAGE, { level: 70 })
      expect(calculator.compute(damage(BLACK_MAGE, MALEFIC)).multiplier).toBeCloseTo(1.1, 12)
      combatants.update(BLACK_MAGE, { level: 55 })
      expect(calculator.compute(damage(BLACK_MAGE, MALEFIC)).multiplier).toBe(1)
    })
  })
})

it('marks an unknown source condition incomplete without changing its numeric result', () => {
  const { calculator, give, damage } = setup()
  give(ENEMY, 2586, 0xe0000000)
  expect(calculator.compute(damage(SAMURAI, HIGANBANA))).toMatchObject({ multiplier: 1, telemetryComplete: false })
})
