import { describe, expect, it } from 'vitest'
import { invalidTarget } from '../constants.js'
import { TestCombatants } from '../testing/combatants.js'
import { playerOf } from './owners.js'

const PLAYER = 0x10000001
const PET = 0x40000010
const ENEMY = 0x40000001
const ORPHAN = 0x40000020
const NPC_PET = 0x40000030

describe('playerOf', () => {
  const combatants = new TestCombatants()
  combatants.update(PLAYER, { nickname: 'Summoner', classJob: 27, ownerId: invalidTarget }, true)
  combatants.update(PET, { bNpcBase: 10490, ownerId: PLAYER }, true)
  combatants.update(ENEMY, { bNpcBase: 541, ownerId: invalidTarget }, true)
  combatants.update(ORPHAN, { bNpcBase: 10490, ownerId: 0x10000099 }, true)
  combatants.update(NPC_PET, { bNpcBase: 100, ownerId: ENEMY }, true)

  it.each([
    ['a player', PLAYER, PLAYER],
    ['a pet of a player', PET, PLAYER],
    ['an enemy whose owner is invalidTarget', ENEMY, null],
    ['a pet whose owner is not known', ORPHAN, null],
    ['a pet of an enemy', NPC_PET, null],
    ['a combatant that is not known', 0x10000077, null],
  ])('takes %s to %s', (_, id, player) => {
    expect(playerOf(combatants, id)).toBe(player)
  })
})
