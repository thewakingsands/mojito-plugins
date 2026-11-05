import { periodicDefs } from '@ffcafe/mojito-combat-model/defs'
import type { Sample } from '@ffcafe/mojito-plugin-sdk'
import { describe, expect, it } from 'vitest'
import { CombatEngineRunner, toCombatInput } from './combat-engine.js'
import type { GameEvent, PeriodicTick } from './combat-events.js'
import { effect, meta, sample } from './fixtures.js'

/** A runner whose timers wait for the test to call them */
function runner(previousGeneration = 0) {
  const timers: { callback: () => void; ms: number; cancelled: boolean }[] = []
  const drained: Sample<GameEvent>[][] = []
  const timing: unknown[] = []
  let now = 0
  const value = new CombatEngineRunner({
    defs: periodicDefs,
    previousGeneration,
    now: () => now,
    setTimeout: (callback, ms) => {
      const timer = { callback, ms, cancelled: false }
      timers.push(timer)
      return () => {
        timer.cancelled = true
      }
    },
    drained: (results) => drained.push(results),
    timing: (fields) => timing.push(fields),
  })
  return {
    runner: value,
    timers,
    drained,
    timing,
    setNow: (at: number) => {
      now = at
    },
  }
}

const tick = (seq: number, statusId: number, sourceActorId: number | null): GameEvent => ({
  type: 'overTimeTick',
  packet: { seq, timestamp: seq * 1000, sourceActorId: 9, targetActorId: 1 },
  data: { targetId: 9, sourceActorId, statusId, isHeal: false, amount: 500 },
})
const paladin: GameEvent = {
  type: 'actorProfileChanged',
  data: { actorId: 1, classJob: 19, level: 100, ownerId: null },
}

describe('toCombatInput', () => {
  it('keeps the damage and heal entries of an effect and reads the statuses it applies', () => {
    const event = effect(1, 900)
    event.data.targets[0].effects.push(
      { ...event.data.targets[0].effects[0], typeCode: 4, rawValue: 50, rawFlags: 0x80 },
      { ...event.data.targets[0].effects[0], typeCode: 1 },
    )
    event.data.targets[0].rawEntries = [[14 | (6 << 8), 1878 << 16]]
    expect(toCombatInput(event, meta(5))).toEqual({
      type: 'effect',
      time: 1,
      caster: 1,
      action: 10,
      sequence: 42,
      targets: [
        {
          id: 9,
          index: 0,
          hits: [
            { result: 'damage', amount: 900, critical: false, direct: false, bonusPercent: 0, onSource: false },
            { result: 'heal', amount: 50, critical: false, direct: false, bonusPercent: 0, onSource: true },
          ],
          applied: [{ status: 1878, onSource: false, byte1: 6, byte2: 0 }],
        },
      ],
    })
  })

  it('takes the receiver of a zone change from its packet, and the time of an event without one from its meta', () => {
    expect(
      toCombatInput(
        {
          type: 'zoneChanged',
          packet: { seq: 1, timestamp: 2000, sourceActorId: 1, targetActorId: 1 },
          data: { territoryTypeId: 339 },
        },
        meta(5),
      ),
    ).toEqual({ type: 'zone', time: 2000, territory: 339, receiver: 1 })
    expect(toCombatInput(paladin, meta(5))).toEqual({
      type: 'actor',
      time: 5,
      actorId: 1,
      classJob: 19,
      level: 100,
      ownerId: null,
    })
  })

  it('turns the slots and the status lists into the inputs of the statuses', () => {
    const packet = { seq: 1, timestamp: 3000, sourceActorId: 9, targetActorId: 1 }
    expect(
      toCombatInput(
        {
          type: 'statusSlotsChanged',
          packet,
          data: {
            actorId: 9,
            slots: [
              { slot: 0, status: { statusId: 1881, param: 2, sourceActorId: 1 } },
              { slot: 1, status: null },
            ],
            changes: [
              { kind: 'lost', slot: 1, statusId: 1228, sourceActorId: 2 },
              { kind: 'gained', slot: 0, statusId: 1881, sourceActorId: 1 },
            ],
          },
        },
        meta(5),
      ),
    ).toEqual({
      type: 'statuses',
      time: 3000,
      holder: 9,
      slots: [
        { slot: 0, status: { id: 1881, source: 1, stacks: 2 } },
        { slot: 1, status: null },
      ],
      changes: [
        { kind: 'lost', slot: 1, status: 1228, source: 2 },
        { kind: 'gained', slot: 0, status: 1881, source: 1 },
      ],
    })
    expect(
      toCombatInput(
        {
          type: 'statusesReplaced',
          packet,
          data: {
            actorId: 9,
            statuses: [{ statusId: 1881, param: 0, sourceActorId: null, durationMs: null, observedAt: 5, slot: 3 }],
          },
        },
        meta(5),
      ),
    ).toEqual({ type: 'statusList', time: 3000, holder: 9, statuses: [{ id: 1881, source: null }] })
  })

  it('gives null for the events the model does not read', () => {
    expect(
      toCombatInput(
        { type: 'playerCombatChanged', packet: effect(1).packet, data: { actorId: 1, inCombat: true } },
        meta(5),
      ),
    ).toBeNull()
  })
})

describe('CombatEngineRunner', () => {
  it('gives a generation after the one before, and never one before the current second', () => {
    const second = Math.floor(Date.now() / 1000)
    expect(runner().runner.generation).toBeGreaterThanOrEqual(second)
    expect(runner(second + 10).runner.generation).toBe(second + 11)
  })

  it('gives a tick and the split of its damage the meta and the packet of the tick', () => {
    const { runner: value } = runner()
    value.receive(sample(paladin, 0))
    const results = value.receive(sample(tick(2, 248, 1), 2000))
    expect(results.map((item) => item.value.type)).toEqual(['periodicTick', 'damageAttributed'])
    for (const result of results) {
      expect(result.meta.observedAt).toBe(2000)
      expect(result.value.packet).toEqual(tick(2, 248, 1).packet)
    }
    expect(results[0].value.data).toMatchObject({
      estimatorGeneration: value.generation,
      tickId: 1,
      occurredAt: 2000,
      target: 9,
      statusId: 248,
      total: 500,
    })
  })

  it('gives a potency sample and the split of a hit the meta and the packet of the effect', () => {
    const { runner: value } = runner()
    value.receive(sample(paladin, 0))
    const hit = effect(3, 9000)
    const results = value.receive(sample({ ...hit, data: { ...hit.data, actionId: 9 } }, 3000))
    expect(results.map((item) => item.value.type)).toEqual(['potencySample', 'damageAttributed'])
    expect(results[0]).toMatchObject({
      meta: { observedAt: 3000 },
      value: { packet: { ...hit.packet, timestamp: 3000 } },
    })
    expect(results[0].value.data).toMatchObject({ casterId: 1, targetId: 9, actionId: 9, amount: 9000, potency: 220 })
  })

  it('drains at the deadline of the model, and starts over without the state after reset', () => {
    const { runner: value, timers, drained, setNow } = runner()
    setNow(1000)
    value.receive(sample(tick(1, 0, null), 1000))
    // The summed tick waits 100 ms for its status list
    expect(timers.at(-1)).toMatchObject({ ms: 101, cancelled: false })
    setNow(1101)
    timers.at(-1)!.callback()
    expect(drained).toHaveLength(1)
    expect(drained[0].map((item) => item.value.type)).toEqual(['periodicTick'])
    expect(drained[0][0].value.data).toMatchObject({ tickId: 1, unknown: 500, occurredAt: 1000 })
    // Then the window closes after ten quiet seconds, with the revision of the tick
    expect(timers.at(-1)).toMatchObject({ ms: 9900, cancelled: false })
    setNow(11001)
    timers.at(-1)!.callback()
    expect(drained[1].map((item) => item.value.type)).toEqual(['periodicRevision'])
    expect(drained[1][0].meta.observedAt).toBe(11001)

    value.receive(sample(tick(12, 0, null), 12000))
    value.reset([])
    expect(timers.at(-1)?.cancelled).toBe(true)
    // The ids start over with the engine
    expect(value.receive(sample(tick(13, 248, 1), 13000))[0].value.data).toMatchObject({ tickId: 1 })
  })

  it('splits a summed tick among the statuses on the target before any calibration', () => {
    const { runner: value, timers, drained, setNow } = runner()
    const profile = (actorId: number, classJob: number): GameEvent => ({
      type: 'actorProfileChanged',
      data: { actorId, classJob, level: 100, ownerId: null },
    })
    /** Combust III of the astrologian and Higanbana of the samurai, which apply their statuses and hit nothing */
    const applies = (seq: number, source: number, action: number, status: number): GameEvent => {
      const event = effect(seq, 0, source)
      event.data.actionId = action
      event.data.targets[0].effects = []
      event.data.targets[0].rawEntries = [[14 | (6 << 8) | (250 << 16), status << 16]]
      return event
    }
    const packet = (seq: number) => ({ seq, timestamp: 0, sourceActorId: 9, targetActorId: 1 })
    const status = (statusId: number, sourceActorId: number) => ({ statusId, param: 0, sourceActorId })

    value.receive(sample(profile(1, 33), 0))
    value.receive(sample(profile(2, 34), 0))
    value.receive(sample(applies(1, 1, 16554, 1881), 1000))
    value.receive(sample(applies(2, 2, 7489, 1228), 1000))
    value.receive(
      sample(
        {
          type: 'statusSlotsChanged',
          packet: packet(3),
          data: {
            actorId: 9,
            slots: [
              { slot: 0, status: status(1881, 1) },
              { slot: 1, status: status(1228, 2) },
            ],
            changes: [
              { kind: 'gained', slot: 0, statusId: 1881, sourceActorId: 1 },
              { kind: 'gained', slot: 1, statusId: 1228, sourceActorId: 2 },
            ],
          },
        },
        1000,
      ),
    )
    setNow(2000)
    value.receive(sample(tick(4, 0, null), 2000))
    const results = value.receive(
      sample(
        {
          type: 'statusesReplaced',
          packet: packet(5),
          data: {
            actorId: 9,
            statuses: [
              { ...status(1881, 1), durationMs: null, observedAt: 2010, slot: 0 },
              { ...status(1228, 2), durationMs: null, observedAt: 2010, slot: 1 },
            ],
          },
        },
        2010,
      ),
    )
    const periodic = results.find((item) => item.value.type === 'periodicTick')
    if (!periodic) throw new Error('no tick')
    expect(periodic.value.data).toMatchObject({ confirmed: true, unknown: 0, total: 500 })
    const shares = (periodic.value.data as PeriodicTick).shares
    expect(shares.map((share) => [share.sourceId, share.basis])).toEqual([
      [1, 'estimated'],
      [2, 'estimated'],
    ])
    expect(shares.every((share) => share.amount > 0)).toBe(true)
    expect(shares.reduce((total, share) => total + share.amount, 0)).toBe(500)

    // The window closes after ten quiet seconds, and the revision splits the tick the same way
    setNow(12010)
    timers.at(-1)!.callback()
    const revision = drained.flat().find((item) => item.value.type === 'periodicRevision')
    if (!revision) throw new Error('no revision')
    const [revised] = (revision.value.data as { ticks: PeriodicTick[] }).ticks
    expect(revised.unknown).toBe(0)
    expect(revised.shares.reduce((total, share) => total + share.amount, 0)).toBe(500)
  })

  it('lets a deadline pass on the source clock, also when the next packet says it is before the deadline', () => {
    const { runner: value } = runner()
    value.receive(sample(paladin, 0))
    const first = sample(tick(1, 0, null), 1000)
    value.receive(first)
    // The status list, 50 ms after the tick by its packet, comes 150 ms after it
    const list = sample(
      {
        type: 'statusesReplaced',
        packet: { seq: 2, timestamp: 1050, sourceActorId: 9, targetActorId: 1 },
        data: { actorId: 9, statuses: [] },
      },
      1150,
    )
    list.value.packet = { seq: 2, timestamp: 1050, sourceActorId: 9, targetActorId: 1 }
    const results = value.receive(list)
    expect(results.map((item) => item.value.type)).toEqual(['periodicTick'])
    expect(results[0].value.data).toMatchObject({ confirmed: false })
  })

  it('reads the actors and their statuses the host knows when it starts over', () => {
    const { runner: value } = runner()
    const ok = <T>(item: T) => ({
      state: 'ok' as const,
      value: item,
      observedAt: 0,
      timeBase: 'packet-unix' as const,
      from: 'packet' as const,
    })
    value.reset([{ id: 1, classJob: ok(19), level: ok(100), ownerId: ok(null), statuses: ok([]) }])
    const hit = effect(3, 9000)
    expect(value.receive(sample({ ...hit, data: { ...hit.data, actionId: 9 } }, 3000))[0].value.type).toBe(
      'potencySample',
    )
  })

  it('records the inputs and the time of each second once when it is disposed', () => {
    const { runner: value, timing } = runner()
    value.receive(sample(paladin, 0))
    value.receive(sample(effect(1), 1000))
    value.receive(sample(effect(2), 1500))
    value.dispose()
    value.dispose()
    expect(timing).toEqual([{ inputsP99: 2, inputsMax: 2, msP99: expect.any(Number), msMax: expect.any(Number) }])
    expect(value.receive(sample(effect(3), 3000))).toEqual([])
  })
})

it('requires a complete status snapshot, captures it per input, and forgets it after a gap', () => {
  const { runner: value } = runner()
  value.setTelemetryEnabled(true)
  value.receive(sample(paladin, 0))
  const hit = effect(5, 22000)
  hit.data.actionId = 9
  value.receive(sample(hit, 100))
  expect(value.takeTelemetry()).toEqual([])
  const list = (actorId: number, ids: number[]) =>
    sample(
      {
        type: 'statusesReplaced' as const,
        packet: effect(2).packet,
        data: {
          actorId,
          statuses: ids.map((statusId, slot) => ({
            statusId,
            slot,
            param: 1,
            sourceActorId: 1,
            durationMs: null,
            observedAt: 1,
          })),
        },
      },
      1,
    )
  value.receive(list(9, []))
  value.receive(list(1, [40001]))
  value.receive(sample(hit, 101))
  expect(value.takeTelemetry()).toEqual([])
  value.receive(
    sample(
      {
        type: 'statusSlotsChanged',
        packet: effect(3).packet,
        data: {
          actorId: 1,
          slots: [{ slot: 0, status: { statusId: 40001, param: 1, sourceActorId: 1 } }],
          changes: [],
        },
      },
      2,
    ),
  )
  value.receive(sample(hit, 102))
  const captured = value.takeTelemetry()
  expect(captured).toHaveLength(1)
  value.receive(
    sample(
      {
        type: 'statusSlotsChanged',
        packet: effect(4).packet,
        data: { actorId: 1, slots: [{ slot: 0, status: null }], changes: [] },
      },
      3,
    ),
  )
  expect(captured[0].unknownStatuses).toEqual([{ id: 40001, param: 1 }])
  value.receive(sample(hit, 103))
  expect(value.takeTelemetry()[0].unknownStatuses).toEqual([])
  value.clearTelemetryState()
  value.receive(sample(hit, 104))
  expect(value.takeTelemetry()).toEqual([])
  value.dispose()
})
