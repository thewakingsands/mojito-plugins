import { describe, expect, it } from 'vitest'
import type { JobGaugeState } from '../input.js'
import { ASTROLOGIAN, BLACK_MAGE, THAUMATURGE, testCombatants, testElements } from '../testing/periodic.js'
import { ElementTracker } from './elements.js'

const FIRE = 141
const BLIZZARD = 142
const FIRE_III = 152
const BLIZZARD_III = 154
const SET_TWO = 9001
const UMBRAL_SOUL = 16506
const TRANSPOSE = 149
const FIRE_II = 147
const BLIZZARD_II = 25793

function setup() {
  const combatants = testCombatants()
  const elements = new ElementTracker(testElements, combatants)
  const stance = (caster = BLACK_MAGE) => elements.stateOf(caster)?.elementStance ?? null
  return { combatants, elements, stance }
}

/** Brings the black mage to the stance: no elements after death, one stack after two transposes, then more */
function reach(elements: ElementTracker, target: number) {
  elements.death(BLACK_MAGE)
  if (target === 0) return
  elements.applyAction(BLACK_MAGE, target > 0 ? FIRE_III : BLIZZARD_III)
  elements.applyAction(BLACK_MAGE, TRANSPOSE)
  elements.applyAction(BLACK_MAGE, TRANSPOSE)
  for (let stacks = 1; stacks < Math.abs(target); stacks++) {
    elements.applyAction(BLACK_MAGE, target > 0 ? FIRE : BLIZZARD)
  }
}

const gauge = (elementStance: number, enochianActive: boolean): JobGaugeState => ({
  job: 'BlackMage',
  elementStance,
  enochianActive,
})

describe('ElementTracker', () => {
  it('sets the elements and the stacks', () => {
    const { elements, stance } = setup()
    elements.applyAction(BLACK_MAGE, FIRE_III)
    expect(stance()).toBe(3)
    elements.applyAction(BLACK_MAGE, BLIZZARD_III)
    expect(stance()).toBe(-3)
    elements.applyAction(BLACK_MAGE, SET_TWO)
    expect(stance()).toBe(2)
  })

  it.each([
    // [action, stance before, stance after]
    [FIRE, 0, 1],
    [FIRE, 2, 3],
    [FIRE, 3, 3],
    [FIRE, -2, 0],
    [BLIZZARD, 0, -1],
    [BLIZZARD, -2, -3],
    [BLIZZARD, -3, -3],
    [BLIZZARD, 2, 0],
    [UMBRAL_SOUL, -1, -2],
    [UMBRAL_SOUL, -3, -3],
    [UMBRAL_SOUL, 2, 2],
    [UMBRAL_SOUL, 0, 0],
    [TRANSPOSE, 3, -1],
    [TRANSPOSE, -2, 1],
    [TRANSPOSE, 0, 0],
  ])('changes with action %i from %i to %i', (action, before, after) => {
    const { elements, stance } = setup()
    reach(elements, before)
    expect(stance()).toBe(before)
    elements.applyAction(BLACK_MAGE, action)
    expect(stance()).toBe(after)
  })

  it('switches the element with a stack below level 35, and sets the maximum from level 35', () => {
    const { combatants, elements, stance } = setup()
    combatants.update(BLACK_MAGE, { level: 30 })
    elements.applyAction(BLACK_MAGE, FIRE_II)
    expect(elements.stateOf(BLACK_MAGE)).toBeNull()
    elements.death(BLACK_MAGE)
    elements.applyAction(BLACK_MAGE, FIRE_II)
    expect(stance()).toBe(1)
    elements.applyAction(BLACK_MAGE, FIRE_II)
    expect(stance()).toBe(2)
    elements.applyAction(BLACK_MAGE, FIRE_II)
    expect(stance()).toBe(2)
    // From Astral Fire, Blizzard II removes it and gives one stack of Umbral Ice
    elements.applyAction(BLACK_MAGE, BLIZZARD_II)
    expect(stance()).toBe(-1)
    elements.applyAction(BLACK_MAGE, BLIZZARD_II)
    expect(stance()).toBe(-2)
    elements.applyAction(BLACK_MAGE, FIRE_II)
    expect(stance()).toBe(1)

    combatants.update(BLACK_MAGE, { level: 35 })
    elements.changeZone()
    elements.applyAction(BLACK_MAGE, BLIZZARD_II)
    expect(stance()).toBe(-3)
  })

  it('keeps an unknown state unknown until an action sets it', () => {
    const { elements, stance } = setup()
    for (const action of [FIRE, BLIZZARD, UMBRAL_SOUL, TRANSPOSE]) {
      elements.applyAction(BLACK_MAGE, action)
      expect(elements.stateOf(BLACK_MAGE)).toBeNull()
    }
    elements.applyAction(BLACK_MAGE, FIRE_III)
    expect(stance()).toBe(3)
  })

  it('caps the stacks by the level', () => {
    const { combatants, elements, stance } = setup()
    for (const [level, max] of [
      [19, 1],
      [20, 2],
      [34, 2],
      [35, 3],
    ]) {
      combatants.update(BLACK_MAGE, { level })
      elements.applyAction(BLACK_MAGE, FIRE_III)
      expect(stance()).toBe(max)
      elements.applyAction(BLACK_MAGE, SET_TWO)
      expect(stance()).toBe(Math.min(2, max))
    }
  })

  it('has Enochian from its level while there are elements', () => {
    const { combatants, elements } = setup()
    combatants.update(BLACK_MAGE, { level: 55 })
    elements.applyAction(BLACK_MAGE, FIRE_III)
    expect(elements.stateOf(BLACK_MAGE)?.enochianActive).toBe(false)
    combatants.update(BLACK_MAGE, { level: 56 })
    expect(elements.stateOf(BLACK_MAGE)?.enochianActive).toBe(true)
    elements.applyAction(BLACK_MAGE, TRANSPOSE)
    elements.applyAction(BLACK_MAGE, FIRE)
    expect(elements.stateOf(BLACK_MAGE)).toEqual({ job: 'BlackMage', elementStance: 0, enochianActive: false })
  })

  it('has no elements after death, and an unknown state after a zone change', () => {
    const { elements, stance } = setup()
    elements.applyAction(BLACK_MAGE, FIRE_III)
    elements.death(BLACK_MAGE)
    expect(stance()).toBe(0)
    elements.applyAction(BLACK_MAGE, FIRE_III)
    elements.changeZone()
    expect(elements.stateOf(BLACK_MAGE)).toBeNull()
  })

  it('reads the gauge of the recording player once it came, and keeps inferring', () => {
    const { elements, stance } = setup()
    elements.applyAction(BLACK_MAGE, FIRE_III)
    elements.handleGauge(BLACK_MAGE, gauge(-2, true))
    expect(elements.stateOf(BLACK_MAGE)).toEqual({ job: 'BlackMage', elementStance: -2, enochianActive: true })
    expect(elements.inferredOf(BLACK_MAGE)?.elementStance).toBe(3)
    elements.applyAction(BLACK_MAGE, TRANSPOSE)
    expect(stance()).toBe(-2)
    expect(elements.inferredOf(BLACK_MAGE)?.elementStance).toBe(-1)
    elements.changeZone()
    expect(elements.stateOf(BLACK_MAGE)).toBeNull()
  })

  it('keeps elements for thaumaturges and black mages only', () => {
    const { elements, stance } = setup()
    elements.applyAction(THAUMATURGE, FIRE_III)
    // level 30 has two stacks at most
    expect(stance(THAUMATURGE)).toBe(2)
    elements.applyAction(ASTROLOGIAN, FIRE_III)
    expect(elements.stateOf(ASTROLOGIAN)).toBeNull()
    elements.death(ASTROLOGIAN)
    expect(elements.stateOf(ASTROLOGIAN)).toBeNull()
  })
})
