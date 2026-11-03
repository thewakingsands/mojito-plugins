import type { CombatantState, Field, GameTopics, SessionSnapshot } from '@ffcafe/mojito-plugin-sdk'
import { describe, expect, it } from 'vitest'
import { castSpace, effect, actors as fixtureActors, meta } from '../fixtures.js'
import type { Summary } from '../model.js'
import { Recorder } from './recorder.js'
import type { Row } from './schema.js'
import type { Carry, LogEvent } from './types.js'

const field = <T>(value: T, observedAt = 0): Field<T> => ({
  state: 'ok',
  value,
  observedAt,
  from: 'packet',
  timeBase: 'packet-unix',
})
const session = (sessionId = 'source') =>
  ({
    state: 'replay',
    sessionId,
    characterGeneration: 1,
    clock: { generation: 1, source: 'replay', base: 'packet-unix' },
    character: { actorId: 1, contentId: null },
    dataLanguage: 'chs',
  }) as unknown as SessionSnapshot
const zone = (territoryType: number): GameTopics['zone'] => ({
  territoryType: field(territoryType),
  mapId: field(1),
})
/** A party whose members are the given ids, so each different list is a changed value. */
const party = (...ids: number[]): GameTopics['party'] => ({
  isInParty: field(true),
  members: field(ids.map((id, slot) => ({ slot, id, name: `P${id}`, ownParty: true }))),
})
const carry: Carry = {
  encounters: { localActorId: 1, inCombat: null, combatValue: null, packetSeq: null, combatSeq: null, combatAt: 0 },
  generations: [],
}
const summary = { durationMs: 5000, rows: [{ totals: { deaths: 2 } }, { totals: { deaths: 1 } }] } as unknown as Summary
const ENTER = new Date(2026, 9, 26, 20, 5, 12, 345).getTime()

function harness() {
  const calls: (Row | string)[] = []
  const actors = fixtureActors()
  const positions: (number[] | null)[] = []
  let truncated = false
  const recorder = new Recorder({
    sink: {
      beginVisit: (visit) => calls.push(`begin ${visit}`),
      append: (row) => calls.push(row),
      cut: () => calls.push('cut'),
      fightStarted: () => calls.push('fight+'),
      fightTruncated: () => truncated,
      fightEnded: () => calls.push('fight-'),
      endVisit: () => calls.push('end'),
    },
    actors: () => actors,
    names: { zone: (id) => (id === 1263 ? '登天斗技场' : null), job: (id) => (id === 19 ? '骑士' : null) },
    brief: () => ({ result: 'wipe', mainEnemy: { name: '暗黑领主', hpCur: 5, hpMax: 10, hpPercent: 50 } }),
    positions: (ids) => positions.push(ids),
  })
  recorder.source(session())
  recorder.settings({ mode: 'auto', quietSeconds: 10, mergePets: true, scope: 'party' })
  const rows = () => calls.filter((call): call is Row => typeof call !== 'string')
  /** Compact view: kind@t, #fight when inside a fight, and the bare sink calls. */
  const trace = () =>
    calls.map((call) =>
      typeof call === 'string' ? call : `${call.kind}@${call.t}${call.fight === undefined ? '' : `#${call.fight}`}`,
    )
  return {
    recorder,
    calls,
    rows,
    trace,
    actors,
    positions,
    setTruncated: (value: boolean) => {
      truncated = value
    },
    /** Enters a visit whose members all have names, so visitStart is written at once. */
    enter(at = ENTER, territoryType = 1263) {
      recorder.zone(zone(territoryType), at, carry)
      recorder.identities('entities', [], [], new Set([1, 2]), 'party', at)
      calls.length = 0
    },
    event: (value: LogEvent, at: number) => recorder.event({ meta: meta(at), value }),
  }
}

describe('recorder', () => {
  it('writes fight boundaries before the input that caused them, ending before starting', () => {
    const h = harness()
    h.enter()
    h.recorder.fightStarted({ id: 'enc-1', at: ENTER + 1000 })
    h.event(effect(1), ENTER + 1000)
    h.recorder.fightEnded({ id: 'enc-1', reason: 'quiet', at: ENTER + 11000, summary })
    h.recorder.fightStarted({ id: 'enc-2', at: ENTER + 12000 })
    h.event(effect(2), ENTER + 12000)
    expect(h.trace()).toEqual([
      'cut',
      'fight+',
      `fightStart@${ENTER + 1000}#1`,
      `action@${ENTER + 1000}#1`,
      `target@${ENTER + 1000}#1`,
      `effect@${ENTER + 1000}#1`,
      'cut',
      `fightEnd@${ENTER + 11000}#1`,
      'cut',
      'fight-',
      'cut',
      'fight+',
      `fightStart@${ENTER + 12000}#2`,
      `action@${ENTER + 12000}#2`,
      `target@${ENTER + 12000}#2`,
      `effect@${ENTER + 12000}#2`,
    ])
  })
  it('writes an end decided after an event was applied after that event', () => {
    const h = harness()
    h.enter()
    h.recorder.fightStarted({ id: 'enc-1', at: ENTER + 1000 })
    h.event(effect(1), ENTER + 1000)
    h.recorder.fightEnded({ id: 'enc-1', reason: 'quiet', at: ENTER + 11000, summary, afterInput: true })
    h.event(effect(2), ENTER + 2000)
    h.recorder.flushBoundaries()
    expect(h.trace().filter((call) => /^(action|fightEnd)/.test(call))).toEqual([
      `action@${ENTER + 1000}#1`,
      `action@${ENTER + 2000}#1`,
      `fightEnd@${ENTER + 11000}#1`,
    ])
  })
  it('writes a quiet end from a timer at the time Encounters decided', () => {
    const h = harness()
    h.enter()
    h.recorder.fightStarted({ id: 'enc-1', at: ENTER + 1000 })
    h.event(effect(1), ENTER + 1000)
    h.recorder.fightEnded({ id: 'enc-1', reason: 'quiet', at: ENTER + 11000, summary })
    h.recorder.flushBoundaries()
    const end = h.rows().at(-1)!
    expect(end).toMatchObject({ kind: 'fightEnd', t: ENTER + 11000, fight: 1 })
    expect(JSON.parse(String(end.note))).toMatchObject({
      note: 'fightEnd',
      reason: 'quiet',
      durationMs: 5000,
      deaths: 3,
      result: 'wipe',
      cleared: false,
      mainEnemy: { name: '暗黑领主', hpCur: 5, hpMax: 10, hpPercent: 50 },
      truncated: false,
      hash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
    })
    expect(h.calls.at(-1)).toBe('fight-')
  })
  it('marks a truncated fight without a hash', () => {
    const h = harness()
    h.enter()
    h.recorder.fightStarted({ id: 'enc-1', at: ENTER + 1000 })
    h.event(effect(1), ENTER + 1000)
    h.setTruncated(true)
    h.recorder.fightEnded({ id: 'enc-1', reason: 'manual', at: ENTER + 2000, summary })
    h.recorder.flushBoundaries()
    expect(JSON.parse(String(h.rows().at(-1)!.note))).toMatchObject({ truncated: true, hash: null })
  })
  it('cuts the row group when it would span more than 120 seconds', () => {
    const h = harness()
    h.enter()
    h.recorder.party(party(1), ENTER + 1000)
    h.recorder.party(party(1, 2), ENTER + 121_000)
    h.recorder.party(party(1, 2, 3), ENTER + 121_001)
    // The group opened with the entry snapshot at ENTER.
    expect(h.trace()).toEqual([`party@${ENTER + 1000}`, 'cut', `party@${ENTER + 121000}`, `party@${ENTER + 121001}`])
    h.recorder.party(party(1, 2, 3, 4), ENTER + 241_002)
    expect(h.trace().slice(-2)).toEqual(['cut', `party@${ENTER + 241002}`])
  })
  it('opens each visit with a snapshot of the state at entry', () => {
    const h = harness()
    h.recorder.player('get', { actorId: field(1) }, ENTER - 5000)
    h.recorder.party({ isInParty: field(true), members: field([{ slot: 0, id: 1, name: 'A', ownParty: true }]) }, 0)
    const entities: CombatantState[] = [
      { id: 1, objectKind: field(1), name: field('同名'), homeWorldId: field(1), classJob: field(19) },
      { id: 9, objectKind: field(2), bNpcBase: field(5), ownerId: field(null) },
    ]
    h.recorder.identities('combatants', entities, [], new Set([1]), 'party', ENTER - 4000)
    h.recorder.identities(
      'entities',
      [{ id: 1, name: { state: 'unknown', reason: 'x' } }],
      [],
      new Set([1]),
      'party',
      0,
    )
    h.recorder.zone(zone(1263), ENTER, { ...carry, generations: [[9, 3]] })
    h.recorder.identities('entities', [], [], new Set([1, 2]), 'party', ENTER)
    expect(h.trace()).toEqual([
      'begin 20261026-200512-1263',
      `visitStart@${ENTER}`,
      `source@${ENTER}`,
      `settings@${ENTER}`,
      `carry@${ENTER}`,
      `player@${ENTER}`,
      `party@${ENTER}`,
      `identities@${ENTER}`,
      `entity@${ENTER}`,
      `entity@${ENTER}`,
      `zone@${ENTER}`,
      `identities@${ENTER}`,
    ])
    const rows = h.rows()
    expect(JSON.parse(String(rows[6].data))).toEqual({ origin: 'snapshot' })
    // The name stays the last known one, as Identities keeps it.
    expect(rows[7]).toMatchObject({ actor: 1, generation: 0 })
    expect(JSON.parse(String(rows[7].data)).name.value).toBe('同名')
    expect(rows[8]).toMatchObject({ actor: 9, generation: 3 })
    expect(JSON.parse(String(rows[3].data))).toEqual({ ...carry, generations: [[9, 3]] })
  })
  it('holds a visit back until member names are known, the first fight starts or ten seconds pass', () => {
    const named = harness()
    named.actors.set(2, { ...named.actors.get(2)!, name: null })
    named.recorder.zone(zone(1263), ENTER, carry)
    named.recorder.identities('entities', [], [], new Set([1]), 'party', ENTER + 100)
    expect(named.calls).toEqual([])
    named.actors.set(2, { ...named.actors.get(2)!, name: '有名' })
    named.recorder.identities(
      'entities',
      [{ id: 2, objectKind: field(1), name: field('有名') }],
      [],
      new Set([1]),
      'party',
      ENTER + 200,
    )
    expect(named.trace().slice(0, 2)).toEqual(['begin 20261026-200512-1263', `visitStart@${ENTER}`])
    expect(named.trace().slice(-2)).toEqual([`identities@${ENTER + 200}`, `entity@${ENTER + 200}`])

    const fight = harness()
    fight.actors.set(2, { ...fight.actors.get(2)!, name: null })
    fight.recorder.zone(zone(1263), ENTER, carry)
    fight.recorder.fightStarted({ id: 'enc-1', at: ENTER + 500 })
    expect(fight.trace()[1]).toBe(`visitStart@${ENTER}`)
    expect(JSON.parse(String(fight.rows()[0].note)).members).toEqual([
      { actorId: 1, name: '同名', worldId: 1, job: 19, jobName: '骑士' },
      { actorId: 2, name: null, worldId: 2, job: 24, jobName: null },
    ])

    const timed = harness()
    timed.actors.set(2, { ...timed.actors.get(2)!, name: null })
    timed.recorder.zone(zone(1263), ENTER, carry)
    timed.recorder.tick(ENTER + 9999)
    expect(timed.calls).toEqual([])
    timed.recorder.tick(ENTER + 10_000)
    expect(timed.trace().slice(0, 2)).toEqual(['begin 20261026-200512-1263', `visitStart@${ENTER}`])
    expect(timed.trace().at(-1)).toBe(`zone@${ENTER}`)
  })
  it('writes readable local times in notes and exact times in t', () => {
    const h = harness()
    h.recorder.zone(zone(1263), ENTER, carry)
    h.recorder.identities('entities', [], [], new Set([1, 2]), 'party', ENTER)
    h.recorder.zone(zone(339), ENTER + 60_000, carry)
    h.recorder.tick(ENTER + 70_000)
    const rows = h.rows()
    const start = JSON.parse(String(rows[0].note)),
      end = rows.find((row) => row.kind === 'visitEnd')!
    expect(start).toMatchObject({
      note: 'visitStart',
      visit: '20261026-200512-1263',
      territoryType: 1263,
      zone: '登天斗技场',
      enteredAt: expect.stringMatching(/^2026-10-26 20:05:12\.345 [+-]\d\d:\d\d$/),
      scope: 'party',
    })
    expect(end.t).toBe(ENTER + 60_000)
    expect(JSON.parse(String(end.note))).toMatchObject({
      note: 'visitEnd',
      reason: 'zoneChanged',
      fights: 0,
      leftAt: expect.stringMatching(/^2026-10-26 20:06:12\.345/),
    })
    expect(h.trace()).toContain('begin 20261026-200612-339')
  })
  it('keeps the visit while the territory is unknown between zones', () => {
    const h = harness()
    h.enter(ENTER, 144)
    const between = { state: 'unknown', reason: 'Between territories' } as const
    h.recorder.zone({ territoryType: between, mapId: between }, ENTER + 1000, carry)
    h.recorder.zone(zone(845), ENTER + 3000, carry)
    h.recorder.identities('entities', [], [], new Set([1, 2]), 'party', ENTER + 3000)
    const notes = h
      .rows()
      .filter((row) => row.kind === 'visitStart' || row.kind === 'visitEnd')
      .map((row) => ({ t: row.t, ...JSON.parse(String(row.note)) }))
    expect(notes).toMatchObject([
      { note: 'visitEnd', visit: '20261026-200512-144', reason: 'zoneChanged', t: ENTER + 3000 },
      { note: 'visitStart', visit: '20261026-200515-845', territoryType: 845 },
    ])
    expect(h.calls.filter((call) => typeof call === 'string' && call.startsWith('begin'))).toEqual([
      'begin 20261026-200515-845',
    ])
  })
  it('writes only changed identities and skips a call that changes nothing', () => {
    const h = harness()
    h.enter()
    const alice: CombatantState = { id: 1, objectKind: field(1), name: field('Alice', 1) }
    h.recorder.identities(
      'entities',
      [alice, { id: 9, objectKind: field(2), name: field('Boss') }],
      [],
      new Set([1, 2]),
      'party',
      ENTER + 1,
    )
    h.recorder.identities(
      'entities',
      [{ id: 1, objectKind: field(1), name: field('Alice', 2) }],
      [],
      new Set([1, 2]),
      'party',
      ENTER + 2,
    )
    h.recorder.identities(
      'entities',
      [{ id: 1, objectKind: field(1), name: field('Alicia') }],
      [],
      new Set([1, 2]),
      'party',
      ENTER + 3,
    )
    h.recorder.identities('combatants', [], [], new Set([1, 2, 5]), 'party', ENTER + 4)
    h.recorder.identities('combatants', [], [404, 9], new Set([1, 2, 5]), 'party', ENTER + 5)
    h.recorder.identities('combatants', [], [], new Set([1, 2, 5]), 'all', ENTER + 6)
    expect(h.trace()).toEqual([
      `identities@${ENTER + 1}`,
      `entity@${ENTER + 1}`,
      `entity@${ENTER + 1}`,
      `identities@${ENTER + 3}`,
      `entity@${ENTER + 3}`,
      `identities@${ENTER + 4}`,
      `identities@${ENTER + 5}`,
      `missing@${ENTER + 5}`,
      `identities@${ENTER + 6}`,
    ])
    expect(h.rows()[7]).toMatchObject({ actor: 9 })
  })
  it('samples members and engaged enemies during a fight and drops unchanged positions', () => {
    const h = harness()
    h.enter()
    h.recorder.fightStarted({ id: 'enc-1', at: ENTER + 1000 })
    h.event(effect(1, 100, 1, 10), ENTER + 1000)
    expect(h.positions).toEqual([[1, 2]])
    h.event(effect(2, 100, 9, 2), ENTER + 1100)
    h.event(effect(3, 100, 1, 9), ENTER + 1200)
    expect(h.positions).toEqual([
      [1, 2],
      [1, 2, 9],
    ])
    const entity = (id: number, x: number, hp?: number): CombatantState => ({
      id,
      objectKind: field(id === 9 ? 2 : 1),
      position: field({ x, y: 0, z: 2 }),
      rotation: field(0.5),
      ...(hp === undefined ? {} : { hpCur: field(hp), hpMax: field(100) }),
    })
    const positions = (at: number, entities: CombatantState[]) =>
      h.recorder.positions({ meta: meta(at), value: { entities, missingIds: [] } })
    positions(ENTER + 1250, [entity(1, 1, 50), entity(9, 5), { id: 2, position: { state: 'unknown', reason: 'x' } }])
    positions(ENTER + 1500, [entity(1, 1, 50), entity(9, 6)])
    positions(ENTER + 1750, [entity(1, 1, 50), entity(9, 6)])
    const pos = h.rows().filter((row) => row.kind === 'pos')
    expect(pos).toEqual([
      expect.objectContaining({ t: ENTER + 1250, actor: 1, x: 1, z: 2, rotation: 0.5, hpCur: 50, hpMax: 100 }),
      expect.objectContaining({ t: ENTER + 1250, actor: 9, x: 5, hpCur: null, hpMax: null }),
      expect.objectContaining({ t: ENTER + 1500, actor: 9, x: 6 }),
    ])
    h.recorder.fightEnded({ id: 'enc-1', reason: 'manual', at: ENTER + 2000, summary })
    h.recorder.flushBoundaries()
    expect(h.positions.at(-1)).toBeNull()
  })
  it('keeps enemy casts and the statuses of members, pets and enemies only', () => {
    const h = harness()
    h.enter()
    const packet = effect(1).packet
    h.event(
      { type: 'castStarted', packet, data: { ...castSpace, casterId: 9, actionId: 1, targetId: 1, durationMs: 1 } },
      ENTER + 1,
    )
    h.event(
      { type: 'castStarted', packet, data: { ...castSpace, casterId: 1, actionId: 1, targetId: 9, durationMs: 1 } },
      ENTER + 2,
    )
    h.event({ type: 'castCancelled', packet, data: { casterId: 9, actionId: 1, interrupted: true } }, ENTER + 3)
    for (const [index, actorId] of [1, 3, 9, 10].entries())
      h.event({ type: 'statusChanged', packet, data: { actorId, slot: 0, status: null } }, ENTER + 10 + index)
    h.event({ type: 'statusesReplaced', packet, data: { actorId: 10, statuses: [] } }, ENTER + 20)
    h.event({ type: 'statusesReplaced', packet, data: { actorId: 2, statuses: [] } }, ENTER + 21)
    expect(h.trace()).toEqual([
      `castStart@${ENTER + 1}`,
      `castCancel@${ENTER + 3}`,
      `status@${ENTER + 10}`,
      `status@${ENTER + 11}`,
      `status@${ENTER + 12}`,
      `statuses@${ENTER + 21}`,
    ])
  })
  it('keeps whether enemies are targetable and every cutscene change', () => {
    const h = harness()
    h.enter()
    for (const [index, actorId] of [1, 3, 9, 10, 99].entries())
      h.event({ type: 'targetableChanged', data: { actorId, targetable: false } }, ENTER + 1 + index)
    h.event({ type: 'cutsceneChanged', data: { playing: true } }, ENTER + 10)
    h.event({ type: 'cutsceneChanged', data: { playing: false } }, ENTER + 11)
    expect(h.trace()).toEqual([`targetable@${ENTER + 3}`, `cutscene@${ENTER + 10}`, `cutscene@${ENTER + 11}`])
  })
  it('keeps only the potency samples of members', () => {
    const h = harness()
    h.enter()
    // A member, a pet, an enemy, an actor outside the party, and an unknown caster
    for (const [index, casterId] of [1, 3, 9, 10, 99, null].entries())
      h.event(
        {
          type: 'potencySample',
          data: {
            casterId,
            targetId: 9,
            actionId: 7477,
            sequence: index,
            amount: 9000,
            potency: 200,
            multiplier: 1,
            factors: [],
          },
        },
        ENTER + 1 + index,
      )
    expect(h.trace()).toEqual([`potency@${ENTER + 1}`])
  })
  it('ends the visit on a source change and on stop', () => {
    const h = harness()
    h.enter()
    h.recorder.source(session('other'))
    expect(h.trace().slice(-3)).toEqual([`visitEnd@${ENTER}`, 'cut', 'end'])
    expect(JSON.parse(String(h.rows().at(-1)!.note)).reason).toBe('sourceChanged')
    h.recorder.zone(zone(1263), ENTER + 5000, carry)
    h.recorder.stop(ENTER + 6000)
    expect(JSON.parse(String(h.rows().at(-1)!.note))).toMatchObject({ note: 'visitEnd', reason: 'stopped' })
    expect(h.trace()).toContain('begin 20261026-200517-1263')
  })
  it('writes a zone, party or player value only when it differs from the last one written', () => {
    const h = harness()
    h.enter()
    for (const at of [ENTER + 100, ENTER + 200]) {
      h.recorder.zone({ territoryType: field(1263, at), mapId: field(1, at) }, at, carry)
      h.recorder.party({ ...party(1, 2), isInParty: field(true, at) }, at)
      h.recorder.player('watch', { actorId: field(1, at), inCombat: field(false, at) }, at)
    }
    h.recorder.zone(zone(1263), ENTER + 300, carry)
    h.recorder.zone({ territoryType: field(1263), mapId: field(2) }, ENTER + 400, carry)
    h.recorder.party(party(1), ENTER + 500)
    h.recorder.player('watch', { actorId: field(1), inCombat: field(true) }, ENTER + 600)
    // The zone from enter() was written, so the first zone here repeats it.
    expect(h.trace()).toEqual([
      `party@${ENTER + 100}`,
      `player@${ENTER + 100}`,
      `zone@${ENTER + 400}`,
      `party@${ENTER + 500}`,
      `player@${ENTER + 600}`,
    ])
  })
  it('compares watched and read player states each with its own last row', () => {
    const h = harness()
    h.enter()
    const state = { actorId: field(1), inCombat: field(false) }
    for (const at of [ENTER + 100, ENTER + 200]) {
      h.recorder.player('watch', state, at)
      h.recorder.player('get', state, at + 50)
    }
    expect(h.trace()).toEqual([`player@${ENTER + 100}`, `player@${ENTER + 150}`])
    expect(h.rows().map((row) => JSON.parse(String(row.data)).origin)).toEqual(['watch', 'get'])
  })
  it('writes a repeated player state that changes the combat state or has no usable inCombat', () => {
    const h = harness()
    h.enter()
    const state = { actorId: field(1), inCombat: field(false) }
    h.recorder.player('watch', state, ENTER + 100)
    h.recorder.player('watch', state, ENTER + 200, true)
    h.recorder.player('watch', state, ENTER + 300)
    const unavailable = { actorId: field(1), inCombat: { state: 'unavailable', reason: 'x' } as const }
    h.recorder.player('watch', unavailable, ENTER + 400)
    h.recorder.player('watch', unavailable, ENTER + 500)
    expect(h.trace()).toEqual([
      `player@${ENTER + 100}`,
      `player@${ENTER + 200}`,
      `player@${ENTER + 400}`,
      `player@${ENTER + 500}`,
    ])
  })
  it('writes the first zone, party and player of a visit even when they repeat the last visit', () => {
    const h = harness()
    h.enter()
    const state = { actorId: field(1), inCombat: field(false) }
    h.recorder.party(party(1, 2), ENTER + 100)
    h.recorder.player('watch', state, ENTER + 100)
    h.recorder.zone(zone(1264), ENTER + 1000, carry)
    h.recorder.identities('entities', [], [], new Set([1, 2]), 'party', ENTER + 1000)
    h.recorder.party(party(1, 2), ENTER + 1100)
    h.recorder.player('watch', state, ENTER + 1100)
    expect(h.trace().slice(-2)).toEqual([`party@${ENTER + 1100}`, `player@${ENTER + 1100}`])
    // A source change starts over too.
    h.recorder.source(session('other'))
    h.recorder.zone(zone(1264), ENTER + 2000, carry)
    h.recorder.identities('entities', [], [], new Set([1, 2]), 'party', ENTER + 2000)
    const before = h.rows().length
    h.recorder.party(party(1, 2), ENTER + 2100)
    h.recorder.player('watch', state, ENTER + 2100)
    expect(h.rows().length).toBe(before + 2)
  })
  it('writes the same values again after the source changes within a visit', () => {
    const h = harness()
    h.enter()
    const state = { actorId: field(1), inCombat: field(false) }
    h.recorder.party(party(1, 2), ENTER + 100)
    h.recorder.player('get', state, ENTER + 100)
    h.recorder.source(session('other'))
    h.recorder.zone(zone(1263), ENTER + 200, carry)
    h.recorder.identities('entities', [], [], new Set([1, 2]), 'party', ENTER + 200)
    h.calls.length = 0
    h.recorder.zone(zone(1263), ENTER + 300, carry)
    h.recorder.party(party(1, 2), ENTER + 300)
    h.recorder.player('get', state, ENTER + 300)
    // The zone was written on entering again; party and player were last written in the old source.
    expect(h.trace()).toEqual([`party@${ENTER + 300}`, `player@${ENTER + 300}`])
  })
  it('does not reuse a visit id within the same second', () => {
    const h = harness()
    h.recorder.reserve(['20261026-200512-1263'])
    h.recorder.zone(zone(1263), ENTER, carry)
    h.recorder.stop(ENTER)
    expect(h.trace()[0]).toBe('begin 20261026-200512-1263-2')
  })
})

it('excludes scene objects from character identity and position log rows', () => {
  const h = harness()
  h.enter()
  const scene: CombatantState = {
    id: 7,
    objectKind: field(7),
    name: field('Scene'),
    bNpcBase: field(0x1eb0ff),
    position: field({ x: 1, y: 2, z: 3 }),
    rotation: field(0),
  }
  h.recorder.identities('entities', [scene], [], new Set([1, 2]), 'party', ENTER + 1)
  expect(h.rows().filter((row) => row.kind === 'entity')).toEqual([])
  h.recorder.fightStarted({ id: 'enc-1', at: ENTER + 1000 })
  h.recorder.positions({ meta: meta(ENTER + 1100), value: { entities: [scene], missingIds: [] } })
  expect(h.rows().filter((row) => row.kind === 'positions')).toEqual([])
})
