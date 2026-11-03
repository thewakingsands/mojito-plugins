import { expect, it } from 'vitest'
import type { FightEntry } from '../log/types.js'
import type { Summary } from '../model.js'
import type { StatisticsState } from '../view-model.js'
import { fightFacts } from './fight.js'

const fight: FightEntry = {
  number: 1,
  id: 'fight-1',
  startAt: 0,
  endAt: 380_000,
  reason: 'outOfCombat',
  scope: 'party',
  durationMs: 380_000,
  deaths: 1,
  result: 'ended',
  mainEnemy: null,
  truncated: false,
  hashed: true,
}
const state = (selected: Partial<Summary> | null) =>
  ({ activeFightId: null, current: null, selected }) as unknown as StatisticsState

it('shows the logged result of a fight that is not selected', () => {
  expect(fightFacts(fight, state(null))).toMatchObject({ result: 'ended', enemy: '未知敌人' })
})
it('shows the result of the summary of the selected fight over what an older log recorded', () => {
  const selected = {
    id: 'fight-1',
    outcome: { result: 'kill', mainEnemy: { key: 'k', name: '永远之暗', hpCur: 0, hpMax: 1, hpPercent: 0 } },
  } as Partial<Summary>
  expect(fightFacts(fight, state(selected))).toMatchObject({ result: 'kill', enemy: '永远之暗' })
  expect(fightFacts({ ...fight, id: 'fight-2' }, state(selected))).toMatchObject({ result: 'ended' })
})
