import { expect, it } from 'vitest'
import { compatibility } from './compatibility.js'
import { displaySummary } from './display.js'
import { Encounters } from './encounters.js'
import { actors, effect, sample } from './fixtures.js'
import { Presentation } from './presentation.js'

function encounter() {
  const model = new Encounters(
    () => 'synthetic',
    () => {},
  )
  model.config.mode = 'manual'
  model.updateActors(actors())
  model.accept(sample(effect(1, 100), 1000), 1000)
  return model
}

it('advances a zero-duration encounter without changing facts, personal rates or counters', () => {
  const model = encounter(),
    projection = new Presentation()
  const facts = model.snapshot()!,
    before = structuredClone(facts)
  const output = projection.project(facts, model.presentationAnchor(), { now: 3000, paused: false }, true).summary!
  expect(output.durationMs).toBe(2000)
  expect(output.rows[0].metrics.encDps).toMatchObject({ value: 50, quality: 'observed' })
  expect(output.rows[0].metrics.dps.value).toBeNull()
  expect(output.rows[0].totals).toEqual(before.rows[0].totals)
  expect(facts).toEqual(before)
  expect(model.snapshot()).toEqual(before)
  const ended = projection.project(facts, model.presentationAnchor(), { now: 3000, paused: false }, false)
  expect(ended.summary).toBe(facts)
  expect(ended.summary?.durationMs).toBe(0)
  expect(ended.summary?.rows[0].metrics.encDps.value).toBeNull()
})

it('uses the settlement anchor with packet/source clock differences and new boundary facts', () => {
  const model = encounter(),
    projection = new Presentation()
  const next = sample(effect(2, 200), 2000)
  next.value.packet.timestamp = 1700
  model.accept(next, 2000)
  expect(model.presentationAnchor()).toMatchObject({ factDurationMs: 700, lastFactSourceAt: 2000 })
  expect(
    projection.project(model.snapshot(), model.presentationAnchor(), { now: 2500, paused: false }, true).summary
      ?.durationMs,
  ).toBe(1200)
  const heal = sample(effect(3, 10, 1, 2, 4), 3000)
  heal.value.packet.timestamp = 2700
  model.accept(heal, 3000)
  expect(model.presentationAnchor()?.factDurationMs).toBe(model.snapshot()?.durationMs)
  expect(
    projection.project(model.snapshot(), model.presentationAnchor(), { now: 3500, paused: false }, true).summary
      ?.durationMs,
  ).toBe(2200)
})

it('holds the displayed value on pause, follows source speed and resets on a new source', () => {
  const model = encounter(),
    projection = new Presentation(),
    facts = model.snapshot()!
  const show = (now: number, paused = false) =>
    projection.project(facts, model.presentationAnchor(), { now, paused }, true)
  expect(show(3000).summary?.durationMs).toBe(2000)
  expect(show(3000, true)).toMatchObject({ changed: false, summary: { durationMs: 2000 } })
  expect(show(5000).summary?.durationMs).toBe(4000)
  expect(show(5500).summary?.durationMs).toBe(4500)
  const changed = { ...facts, source: 'new-source' }
  const anchor = { ...model.presentationAnchor()!, source: changed.source }
  expect(projection.project(changed, anchor, { now: 1000, paused: false }, true).summary?.durationMs).toBe(0)
  expect(projection.project(changed, anchor, { now: null, paused: false }, true).summary).toBe(changed)
})

it('does not regress during an active encounter, but clears the floor at final settlement', () => {
  const model = encounter(),
    projection = new Presentation()
  projection.project(model.snapshot(), model.presentationAnchor(), { now: 5000, paused: false }, null)
  model.accept(sample(effect(2), 2000), 2000)
  expect(
    projection.project(model.snapshot(), model.presentationAnchor(), { now: 3000, paused: false }, null).summary
      ?.durationMs,
  ).toBe(4000)
  model.end('synthetic', 5000)
  const final = model.snapshot(model.completed[0])!
  expect(projection.project(final, null, { now: 6000, paused: false }, null).summary).toBe(final)
  expect(final.durationMs).toBe(1000)
})

it('projects after pet grouping and supplies one encounter denominator to all templates', () => {
  const model = encounter(),
    projection = new Presentation()
  model.accept(sample(effect(2, 200, 3), 2000), 2000)
  const facts = model.snapshot(undefined, false)!,
    before = structuredClone(facts)
  const grouped = displaySummary(facts, true)!
  const output = projection.project(grouped, model.presentationAnchor(), { now: 4000, paused: false }, true).summary!
  expect(output.rows).toHaveLength(1)
  const state = compatibility(output, { id: 1, name: 'Synthetic' }, null, 'en', true)
  expect(state.combatData?.Encounter).toMatchObject({ DURATION: '3', duration: '00:03', encdps: '100.00' })
  expect(state.combatData?.Combatant.YOU).toMatchObject({ DURATION: '1', dps: '300.00', encdps: '100.00' })
  // MopiMopi's own encounter-rate recomputation uses these same fields.
  expect(Number(state.combatData!.Combatant.YOU.damage) / Number(state.combatData!.Encounter.DURATION)).toBe(100)
  expect(facts).toEqual(before)
  expect(displaySummary(facts, true)).toEqual(grouped)
})

it('rejects anchors from a different encounter and never projects historical summaries', () => {
  const model = encounter(),
    projection = new Presentation(),
    facts = model.snapshot()!
  expect(
    projection.project(
      facts,
      { ...model.presentationAnchor()!, encounterId: 'old' },
      { now: 5000, paused: false },
      true,
    ).summary,
  ).toBe(facts)
  model.end('synthetic', 5000)
  const history = model.snapshot(model.completed[0])!
  expect(projection.project(history, model.presentationAnchor(), { now: 9000, paused: false }, true).summary).toBe(
    history,
  )
})

it('does not project incoming-only encounters and starts timing on the first qualified fact', () => {
  const model = new Encounters(
    () => 'incoming',
    () => {},
  )
  model.config.mode = 'manual'
  model.updateActors(actors())
  model.accept(sample(effect(1, 10, 9, 1), 1000), 1000)
  const projection = new Presentation()
  const facts = model.snapshot()!
  expect(projection.project(facts, model.presentationAnchor(), { now: 5000, paused: false }, true).summary).toBe(facts)
  expect(facts.durationMs).toBe(0)
  expect(facts.rows[0].hasSettlementTime).toBe(false)
  expect(facts.rows[0].metrics.encDps.value).toBeNull()
  model.accept(sample(effect(2, 100), 6000), 6000)
  const active = projection.project(model.snapshot(), model.presentationAnchor(), { now: 7000, paused: false }, true)
    .summary!
  expect(active.durationMs).toBe(1000)
  expect(active.rows[0].metrics.encDps.value).toBe(100)
})
it('ignores incoming-only owner placeholders when displaying or regrouping a pet with one valid fact', () => {
  const model = new Encounters(
    () => 'pet',
    () => {},
  )
  model.updateActors(actors())
  model.accept(sample(effect(1, 10, 9, 1), 1000), 1000)
  model.accept(sample(effect(2, 100, 3), 2000), 2000)
  model.accept(sample(effect(3, 20, 9, 1), 4000), 4000)
  const separated = model.snapshot(undefined, false)!
  expect(separated.rows.find((row) => row.actor.id === 1)?.hasSettlementTime).toBe(false)
  expect(separated.rows.find((row) => row.actor.id === 3)?.hasSettlementTime).toBe(true)
  const grouped = displaySummary(separated, true)!
  expect(grouped.rows[0]).toMatchObject({
    firstAt: 2000,
    lastAt: 2000,
    hasSettlementTime: true,
    totals: { taken: 30, damage: 100 },
  })
  expect(grouped.rows[0].metrics.dps.value).toBeNull()
  expect(displaySummary(grouped, true)?.rows).toEqual(grouped.rows)
  const legacy = structuredClone(separated)
  for (const row of legacy.rows) delete row.hasSettlementTime
  expect(displaySummary(legacy, true)?.rows[0]).toMatchObject({ firstAt: 1000, lastAt: 2000, hasSettlementTime: true })
})
