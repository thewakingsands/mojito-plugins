import { periodicDefs } from '@ffcafe/mojito-combat-model/defs'
import type { Batch, GameTopics, PluginContext, Sample, SessionSnapshot, Value } from '@ffcafe/mojito-plugin-sdk'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { GameEvent } from './combat-events.js'
import { activate, PUBLISH_MS } from './entry.js'
import { castSpace, combat, effect, meta, sample } from './fixtures.js'
import { Recorder } from './log/recorder.js'
import { localDate } from './log/schema.js'
import { fileRows, memoryStorage } from './log/storage.test-helper.js'
import { LogStore } from './log/store.js'
import type { Summary } from './model.js'
import { type Command, ENTRY_FIELDS, type ReplayResult, type StatisticsState, type VisitsState } from './view-model.js'
import { DEFAULT_QUERY } from './visit-filter.js'

const batch = <T>(items: T[]): Batch<T> => ({
  subscriptionId: 'test',
  batchId: 1,
  firstSeq: 1,
  lastSeq: items.length,
  initial: false,
  complete: true,
  items,
})
beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})
/** Runs the publication the plugin delays after events and player changes. */
const settle = () => vi.advanceTimersByTimeAsync(PUBLISH_MS)
const subscription = () => ({
  ready: Promise.resolve(),
  closed: new Promise<{ reason: string }>(() => {}),
  dispose() {},
})
/** The fights the statistics channel published as ended, by id */
const endedFights = (frames: { channel: string; value: Value }[]) => {
  const ended = new Map<string, Summary>()
  for (const frame of frames) {
    const current = frame.channel === 'statistics' ? (frame.value as unknown as StatisticsState).current : null
    if (current?.ended) ended.set(current.id, current)
  }
  return [...ended.values()]
}
/**
 * unavailable: the event types the host rejects, with rejection as the code; files: the storage of an earlier run;
 * partyData: whether the host gives the party, solo, right after connecting
 */
async function setup(
  delayedIdentity = false,
  players = false,
  unavailable: string[] = [],
  rejection = 'unavailable',
  files = new Map<string, Uint8Array>(),
  partyData = true,
  opcodeVersion = periodicDefs.version,
) {
  let serviceRequest!: (method: string, payload: Value) => Promise<Value>
  let playerAvailable = !delayedIdentity
  let receiveSession!: (batch: Batch<SessionSnapshot>) => Promise<void>
  let receiveReview: ((batch: Batch<Sample<GameEvent>>) => Promise<void>) | null = null
  let receiveScene: ((batch: Batch<Sample<GameEvent>>) => Promise<void>) | null = null
  const warnings: string[] = []
  let receiveEvents!: (batch: Batch<ReturnType<typeof sample<GameEvent>>>) => Promise<void>
  let receiveZone!: (batch: Batch<Sample<GameTopics['zone']>>) => Promise<void>
  let receivePlayer!: (batch: Batch<Sample<GameTopics['player']>>) => Promise<void>
  let receiveParty!: (batch: Batch<Sample<GameTopics['party']>>) => Promise<void>
  const frames: { channel: string; value: Value }[] = []
  /** set and flush calls of the views, in order */
  const calls: string[] = []
  /** Paths the plugin read from its storage, in order */
  const reads: string[] = []
  const debugs: { message: string; fields: unknown }[] = []
  /** Notifications the plugin sent, in order */
  const notices: { title: string; detail?: string }[] = []
  // While set, notifications.send rejects as a host older than Plugin API 1.6.0 does.
  let noticeRejection: string | null = null
  // While set, every storage write fails with this message.
  let writeError: string | null = null
  const timers: (() => Promise<void>)[] = []
  let paused = false
  // The source clock reports no source unless a test sets one, as live captures did before replay had its own rule.
  let source: 'live' | 'replay' | undefined
  let types: unknown
  /** Every event selection the plugin subscribed, including the rejected ones */
  const selections: string[][] = []
  let closeEvents: ((result: { reason: string }) => void) | null = null
  let playerFails = false
  let now = 1000
  const icons: number[] = []
  // While set, every game data request fails as it does when the host has no game data open.
  let dataClosed = false
  const open = () => {
    if (dataClosed) throw { code: 'unavailable' }
  }
  const snapshots = new Map<string, Value>(),
    commands = new Map<string, (input: Value) => Promise<Value>>()
  const field = <T>(value: T) => ({ state: 'ok', value, observedAt: now, from: 'packet', timeBase: 'packet-unix' })
  const ctx = {
    identity: { activationId: 'test' },
    limits: { values: { 'game.entities': 512 } },
    capabilities: { get: () => ({ granted: ['data.read'], supported: {} }) },
    log: {
      debug: (message: string, fields: unknown) => debugs.push({ message, fields }),
      error() {},
      info() {},
      warn: (message: string) => {
        warnings.push(message)
      },
    },
    config: { get: async () => null, set: async () => {} },
    notifications: {
      send: async (notice: { title: string; detail?: string }) => {
        if (noticeRejection !== null) throw { code: noticeRejection }
        notices.push(notice)
      },
    },
    storage: {
      read: async (path: string) => {
        reads.push(path)
        const file = files.get(path)
        if (!file) throw { code: 'not_found' }
        return file
      },
      write: async (path: string, bytes: Uint8Array) => {
        if (writeError !== null) throw new Error(writeError)
        files.set(path, bytes.slice())
      },
      delete: async (path: string) => {
        files.delete(path)
      },
      list: async (path: string) => [...files.keys()].filter((name) => name.startsWith(`${path}/`)),
    },
    session: {
      subscribe: (listener: typeof receiveSession) => {
        receiveSession = listener
        return subscription()
      },
    },
    events: {
      subscribe: (selection: string[], listener: typeof receiveEvents) => {
        selections.push(selection)
        if (selection.some((type) => unavailable.includes(type)))
          return { ...subscription(), ready: Promise.reject({ code: rejection }) }
        // The combat log's cast and status subscription is separate from the ordered statistics one.
        if (selection.includes('actionEffect')) {
          types = selection
          receiveEvents = listener
          return {
            ...subscription(),
            closed: new Promise<{ reason: string }>((resolve) => {
              closeEvents = resolve
            }),
          }
        }
        if (selection.includes('targetableChanged')) receiveScene = listener
        else receiveReview = listener
        return subscription()
      },
    },
    data: {
      name: async (kind: string) => {
        open()
        return kind === 'action' ? '技能' : kind === 'status' ? '状态' : '海雾村'
      },
      // Action 10 has icon 405; every other row has none. Territory 1001 holds the duty 77. Status 49 is a buff.
      rows: async (sheet: string, ids: number[], language: string) => {
        open()
        return ids.map((rowId) => {
          if ((sheet === 'TerritoryType') !== (language === 'none'))
            throw new Error(`${sheet} does not support ${language}`)
          const cells: unknown[] = [
            { type: 'string', value: sheet },
            { type: 'number', value: 0 },
            { type: 'number', value: sheet === 'Action' && rowId === 10 ? 405 : 0 },
          ]
          if (sheet === 'TerritoryType' && rowId === 1001) cells[10] = { type: 'number', value: 77 }
          if (sheet === 'Status' && rowId === 49) cells[6] = { type: 'number', value: 1 }
          if (sheet === 'ContentFinderCondition' && rowId === 77) {
            cells[1] = { type: 'number', value: 1001 }
            cells[43] = { type: 'string', value: '海德林歼灭战' }
          }
          return { rowId, subrows: [{ subrowId: null, cells }] }
        })
      },
      version: async () => {
        open()
        return '2026.10.06.0000.0000'
      },
      icon: async (id: number) => {
        open()
        icons.push(id)
        if (id === 62125) return null
        return { mime: 'image/png', width: 1, height: 1, data: Uint8Array.of(id % 256) }
      },
    },
    game: {
      getPlayer: async () => {
        if (playerFails) throw { code: 'unavailable' }
        return {
          meta: meta(now),
          value: {
            actorId: playerAvailable ? field(1) : { state: 'unavailable' },
            name: field('Synthetic'),
            inCombat: { state: 'unavailable', reason: 'not provided' },
          },
        }
      },
      subscribe: (topic: string, listener: typeof receiveZone) => {
        if (topic === 'zone') receiveZone = listener
        if (topic === 'player') receivePlayer = listener as unknown as typeof receivePlayer
        if (topic === 'party') receiveParty = listener as unknown as typeof receiveParty
        return subscription()
      },
      getCombatants: async () => ({
        meta: meta(now),
        value: {
          missingIds: [],
          entities: [
            { id: 1, objectKind: field(1), name: field('Synthetic'), ownerId: field(null), bNpcBase: field(0) },
            { id: 9, objectKind: field(2), name: field('Enemy'), ownerId: field(null), bNpcBase: field(1) },
            ...(players
              ? [5, 6].map((id) => ({
                  id,
                  name: field(`Player ${id}`),
                  objectKind: field(1),
                  ownerId: field(null),
                  bNpcBase: field(0),
                }))
              : []),
          ],
        },
      }),
    },
    clock: {
      now: () => now,
      state: () => ({ paused, source }),
      setTimeout: (callback: () => Promise<void>) => {
        timers.push(callback)
        return () => {}
      },
    },
    services: {
      provide: async (
        _definition: unknown,
        handler: (request: { method: string; payload: Value }) => Promise<Value>,
      ) => {
        serviceRequest = (method: string, payload: Value) => handler({ method, payload })
        return () => {}
      },
      publish: async (_name: string, _event: string, envelope: { state: Value }) => {
        calls.push('publish:combat')
        snapshots.set('combat', envelope.state)
        frames.push({ channel: 'combat', value: envelope.state })
      },
    },
    views: {
      set: (channel: string, value: Value) => {
        calls.push(`set:${channel}`)
        snapshots.set(channel, value)
        frames.push({ channel, value })
      },
      flush: async () => {
        calls.push('flush')
      },
      onCommand: async (channel: string, handler: (input: Value) => Promise<Value>) => {
        commands.set(channel, handler)
        return () => {}
      },
    },
    ui: { registerFeature: async () => () => {} },
  } as unknown as PluginContext
  const dispose = await activate(ctx)
  const connect = async (dataLanguage: string | null = 'cn') =>
    receiveSession(
      batch([
        {
          state: 'replay',
          opcodeVersion,
          sessionId: 'source',
          characterGeneration: 1,
          clock: { generation: 1 },
          character: { actorId: delayedIdentity ? null : 1 },
          dataLanguage,
        } as SessionSnapshot,
      ]),
    )
  const sendParty = (members: unknown) =>
    receiveParty(
      batch([
        { meta: meta(now), value: { isInParty: field(true), members } } as unknown as Sample<GameTopics['party']>,
      ]),
    )
  await connect()
  if (partyData) await sendParty(field([]))
  return {
    setPlayerAvailable: (value: boolean) => {
      playerAvailable = value
    },
    refreshSession: connect,
    setDataClosed: (value: boolean) => {
      dataClosed = value
    },
    idle: () =>
      receiveSession(
        batch([
          {
            state: 'idle',
            sessionId: null,
            characterGeneration: 0,
            clock: { generation: 0 },
            character: null,
            dataLanguage: 'cn',
          } as unknown as SessionSnapshot,
        ]),
      ),
    dispose,
    serviceRequest,
    snapshots,
    icons,
    files,
    reads,
    debugs,
    notices,
    /** Titles of the notifications sent so far */
    noticeTitles: () => notices.map((notice) => notice.title),
    setNoticeRejection: (code: string | null) => {
      noticeRejection = code
    },
    setWriteError: (message: string | null) => {
      writeError = message
    },
    commands,
    frames,
    calls,
    timers,
    field,
    types: () => types,
    selections,
    /** Closes the statistics event subscription from the host side */
    closeEvents: (reason: string) => closeEvents?.({ reason }),
    setUnavailable: (types: string[]) => {
      unavailable.splice(0, unavailable.length, ...types)
    },
    setPlayerFails: (value: boolean) => {
      playerFails = value
    },
    paused: () => (snapshots.get('statistics') as unknown as StatisticsState).paused,
    setNow: (value: number) => {
      now = value
    },
    setPaused: (value: boolean) => {
      paused = value
    },
    setSource: (value: 'live' | 'replay') => {
      source = value
    },
    /** Delivers events without waiting for the delayed publication */
    send: (items: Sample<GameEvent>[]) => receiveEvents(batch(items)),
    events: async (items: Sample<GameEvent>[]) => {
      await receiveEvents(batch(items))
      await settle()
    },
    review: (items: Sample<GameEvent>[]) => receiveReview?.(batch(items)),
    scene: (items: Sample<GameEvent>[]) => receiveScene?.(batch(items)),
    warnings,
    player: async (inCombat: boolean | null, at = now) => {
      await receivePlayer(
        batch([
          {
            meta: meta(at),
            value: {
              actorId: field(1),
              name: field('Synthetic'),
              inCombat:
                inCombat === null
                  ? { state: 'unavailable', reason: 'missing' }
                  : { ...field(inCombat), observedAt: at },
            },
          } as Sample<GameTopics['player']>,
        ]),
      )
      await settle()
    },
    zone: (items: Sample<GameTopics['zone']>[]) => receiveZone(batch(items)),
    party: (members: { id: number; ownParty: boolean }[]) =>
      sendParty(field(members.map((member, slot) => ({ ...member, slot, name: `Player ${member.id}` })))),
    /** A party sample whose members the host does not know */
    partyUnknown: () => sendParty({ state: 'unknown', reason: 'changing area' }),
  }
}
it.each(['event', 'watch'] as const)('ends combat with a delayed replay identity learned by %s', async (route) => {
  const h = await setup(true)
  h.setPlayerAvailable(true)
  if (route === 'watch') await h.player(null)
  await h.events([sample(effect(1), 1000), sample(combat(2, true), 1100)])
  h.setPlayerAvailable(false)
  await h.refreshSession()
  await h.events([sample(combat(3, false), 1200)])
  expect(endedFights(h.frames).map((summary) => summary.reason)).toContain('outOfCombat')
  await h.dispose()
})
it('clears every visit but the current one, runs one ordered subscription and keeps real combat state unavailable', async () => {
  const { dispose, snapshots, commands, serviceRequest, field, types, zone, events, setNow } = await setup()
  let now = 1000
  await zone([
    { meta: meta(now), value: { territoryType: field(339), mapId: field(1) } } as unknown as Sample<GameTopics['zone']>,
  ])
  expect(snapshots.get('combat')).toMatchObject({ zone: { id: 339, name: '海雾村' } })
  expect(types()).toEqual([
    'hpChanged',
    'playerCombatChanged',
    'actionEffect',
    'actorDied',
    'zoneChanged',
    'castStarted',
    'castCancelled',
    'statusesReplaced',
    'statusSlotsChanged',
    'actorProfileChanged',
    'overTimeTick',
    'jobGaugeChanged',
    'playerStatsChanged',
  ])
  await events([sample(effect(1), 1000)])
  expect(snapshots.get('combat')).toMatchObject({ inCombat: null, combatData: { Encounter: { damage: '100' } } })
  const state = snapshots.get('statistics') as unknown as { current: { id: string } }
  await commands.get('statistics')!({ kind: 'end', id: state.current.id })
  const visits = () => (snapshots.get('visits') as unknown as VisitsState).visits
  expect(visits().map((visit) => [visit.territoryType, visit.fights.length])).toEqual([[339, 1]])
  now = 2000
  setNow(now)
  await zone([
    { meta: meta(now), value: { territoryType: field(340), mapId: field(1) } } as unknown as Sample<GameTopics['zone']>,
  ])
  await events([sample(effect(2, 200), now)])
  const next = snapshots.get('statistics') as unknown as { current: { id: string } }
  await serviceRequest('endEncounter', { encounterId: next.current.id })
  expect(visits().map((visit) => [visit.territoryType, visit.fights.length])).toEqual([
    [340, 1],
    [339, 1],
  ])
  await commands.get('statistics')!({ kind: 'clear' })
  expect(visits().map((visit) => [visit.territoryType, visit.fights.length])).toEqual([[340, 1]])
  expect(snapshots.get('statistics')).toMatchObject({ following: true, selection: { fightId: next.current.id } })
  await dispose()
})
it('publishes the old terminal frame and history before new activity in the same batch', async () => {
  const h = await setup()
  await h.player(false)
  await h.events([
    sample(effect(1), 1000),
    sample(combat(2, false), 1000),
    sample(effect(3, 200), 1000),
    sample(combat(4, true), 1000),
  ])
  const combatFrames = h.frames
    .filter((frame) => frame.channel === 'combat')
    .map((frame) => frame.value) as unknown as {
    encounterId: string
    combatData: { isActive: string; Encounter: { damage: string } } | null
  }[]
  const ended = combatFrames.filter((frame) => frame.combatData?.isActive === 'false')
  expect(ended).toHaveLength(1)
  expect(ended[0].combatData?.Encounter.damage).toBe('100')
  expect(combatFrames.at(-1)).toMatchObject({ combatData: { isActive: 'true', Encounter: { damage: '200' } } })
  expect(combatFrames.at(-1)?.encounterId).not.toBe(ended[0].encounterId)
  expect(endedFights(h.frames).map((summary) => summary.encounterDamage.value)).toEqual([100])
  await h.player(false, 999)
  expect(h.snapshots.get('combat')).toMatchObject({ inCombat: true })
  await h.dispose()
})
it('publishes a quiet terminal even when one accept both closes and opens an encounter', async () => {
  const h = await setup()
  await h.events([sample(effect(1), 1000)])
  h.setNow(12000)
  await h.events([sample(effect(2, 200), 12000)])
  const values = h.frames.filter((frame) => frame.channel === 'combat').map((frame) => frame.value) as unknown as {
    combatData: { isActive: string } | null
  }[]
  expect(values.slice(-2).map((frame) => frame.combatData?.isActive)).toEqual(['false', 'true'])
  await h.dispose()
})
it('ignores a cancelled quiet timer for a new true encounter and falls back immediately when state becomes unavailable', async () => {
  const h = await setup()
  await h.events([sample(effect(1), 1000)])
  const oldTimer = h.timers.at(-1)!
  await h.events([sample(combat(2, false), 2000), sample(effect(3), 2100), sample(combat(4, true), 2200)])
  h.setNow(100000)
  await oldTimer()
  expect(h.snapshots.get('combat')).toMatchObject({ combatData: { isActive: 'true' }, inCombat: true })
  await h.player(null)
  expect(h.snapshots.get('combat')).toMatchObject({ combatData: { isActive: 'false' }, inCombat: null })
  expect(endedFights(h.frames)).toHaveLength(2)
  await h.dispose()
})
it('does not finish from a paused callback and can resume with a recalculated timer', async () => {
  const h = await setup()
  await h.events([sample(effect(1), 1000)])
  h.setNow(15000)
  h.setPaused(true)
  await h.timers.at(-1)!()
  expect(h.snapshots.get('combat')).toMatchObject({ combatData: { isActive: 'true' } })
  h.setPaused(false)
  await h.player(null)
  expect(h.snapshots.get('combat')).toMatchObject({ combatData: { isActive: 'false' } })
  await h.dispose()
})
it('keeps a replayed fight open for its events when the source clock is already past the quiet deadline', async () => {
  const h = await setup()
  h.setSource('replay')
  await h.events([sample(effect(1), 1000)])
  h.setNow(20000)
  await h.events([sample(effect(2), 5000)])
  await h.events([sample(effect(3), 9000)])
  expect(endedFights(h.frames)).toEqual([])
  const state = h.snapshots.get('statistics') as unknown as StatisticsState
  expect(state.current).toMatchObject({ ended: false, encounterDamage: { value: 300 } })
  await h.dispose()
})
const scopeSettings = (scope: string) => ({
  kind: 'settings',
  value: { mode: 'auto', quietSeconds: 10, mergePets: true, scope },
})
it.each([
  ['party', 0, 0],
  ['alliance', 50, 0],
  ['all', 50, 30],
] as const)('counts players within the %s scope after switching', async (scope, otherParty, outside) => {
  const h = await setup(false, true)
  await h.party([
    { id: 1, ownParty: true },
    { id: 5, ownParty: false },
  ])
  await h.events([sample(effect(1), 1000)])
  await h.commands.get('statistics')!(scopeSettings(scope))
  await h.events([sample(effect(2, 50, 5), 1100), sample(effect(3, 30, 6), 1200)])
  const state = h.snapshots.get('statistics') as unknown as StatisticsState
  const damage = (id: number) => state.current!.rows.find((row) => row.actor.id === id)?.totals.damage ?? 0
  expect(state.settings.scope).toBe(scope)
  expect(damage(1)).toBe(100)
  expect(damage(5)).toBe(otherParty)
  expect(damage(6)).toBe(outside)
  await h.dispose()
})
it('pauses in the party scope until the party is known, and not in the all scope', async () => {
  const h = await setup(false, true, [], 'unavailable', new Map(), false)
  expect(h.paused()).toBe(true)
  await h.events([sample(effect(1), 1000)])
  expect((h.snapshots.get('statistics') as unknown as StatisticsState).current).toBeNull()
  // Playing solo gives an empty list, which is a known party.
  await h.party([])
  expect(h.paused()).toBe(false)
  await h.events([sample(effect(2), 1100)])
  expect((h.snapshots.get('statistics') as unknown as StatisticsState).current).not.toBeNull()
  await h.dispose()
  const all = await setup(false, true, [], 'unavailable', new Map(), false)
  await all.commands.get('statistics')!(scopeSettings('all'))
  expect(all.paused()).toBe(false)
  await all.dispose()
})
it('keeps the fight in progress and the last party when a party sample lacks its members', async () => {
  const h = await setup()
  await h.events([sample(effect(1), 1000)])
  await h.partyUnknown()
  await h.events([sample(effect(2), 1100)])
  const state = h.snapshots.get('statistics') as unknown as StatisticsState
  expect(state.paused).toBe(false)
  expect(state.current).toMatchObject({ ended: false, encounterDamage: { value: 200 } })
  expect(endedFights(h.frames)).toEqual([])
  await h.dispose()
})
it('pauses when the host rejects the complete event set, without trying a smaller one', async () => {
  const h = await setup(false, false, ['overTimeTick'])
  expect(h.paused()).toBe(true)
  expect(h.selections.filter((selection) => selection.includes('actionEffect'))).toHaveLength(1)
  await h.dispose()
  expect(endedFights(h.frames)).toEqual([])
  expect([...h.files.keys()].filter((name) => name.startsWith('log/'))).toEqual([])
})
it('ends the fight when the host closes the events, and counts again once they are subscribed again', async () => {
  const h = await setup()
  await h.events([sample(effect(1), 1000)])
  h.setUnavailable(['actionEffect'])
  h.closeEvents('source_incomplete')
  await vi.advanceTimersByTimeAsync(0)
  expect(endedFights(h.frames).map((summary) => summary.reason)).toEqual(['source_incomplete'])
  expect(h.paused()).toBe(true)
  h.setUnavailable([])
  await vi.advanceTimersByTimeAsync(10_000)
  expect(h.paused()).toBe(false)
  await h.events([sample(effect(2), 2000)])
  expect((h.snapshots.get('statistics') as unknown as StatisticsState).current).toMatchObject({
    ended: false,
    encounterDamage: { value: 100 },
  })
  await h.dispose()
})
it('pauses while the player cannot be read and resumes once a retry reads it', async () => {
  const h = await setup(false, false, [], 'unavailable', new Map(), true)
  h.setPlayerFails(true)
  await h.refreshSession()
  expect(h.paused()).toBe(true)
  await vi.advanceTimersByTimeAsync(10_000)
  expect(h.paused()).toBe(true)
  h.setPlayerFails(false)
  await vi.advanceTimersByTimeAsync(10_000)
  expect(h.paused()).toBe(false)
  await h.dispose()
})
it('notifies a pause that outlasts the first retry once, and its end', async () => {
  const h = await setup(false, false, [], 'unavailable', new Map(), true)
  h.setPlayerFails(true)
  await h.refreshSession()
  expect(h.paused()).toBe(true)
  expect(h.notices).toEqual([])
  await vi.advanceTimersByTimeAsync(10_000)
  expect(h.notices).toEqual([{ title: '统计已暂停', detail: 'Mojito没有正常返回游戏数据，恢复后会自动继续统计。' }])
  await vi.advanceTimersByTimeAsync(10_000)
  expect(h.noticeTitles()).toEqual(['统计已暂停'])
  h.setPlayerFails(false)
  await vi.advanceTimersByTimeAsync(10_000)
  expect(h.paused()).toBe(false)
  expect(h.notices.at(-1)).toEqual({ title: '统计已恢复', detail: 'Mojito已恢复返回游戏数据。' })
  expect(h.noticeTitles()).toEqual(['统计已暂停', '统计已恢复'])
  await h.dispose()
})
it('does not notify the pause before the party arrives right after connecting', async () => {
  const h = await setup(false, true, [], 'unavailable', new Map(), false)
  expect(h.paused()).toBe(true)
  await vi.advanceTimersByTimeAsync(5_000)
  await h.party([])
  expect(h.paused()).toBe(false)
  await vi.advanceTimersByTimeAsync(20_000)
  expect(h.notices).toEqual([])
  await h.dispose()
})
it('does not notify a resume when the game disconnects during a notified pause', async () => {
  const h = await setup(false, false, [], 'unavailable', new Map(), true)
  h.setPlayerFails(true)
  await h.refreshSession()
  await vi.advanceTimersByTimeAsync(10_000)
  expect(h.noticeTitles()).toEqual(['统计已暂停'])
  await h.idle()
  expect(h.paused()).toBe(false)
  expect(h.noticeTitles()).toEqual(['统计已暂停'])
  await h.dispose()
})
it('goes on pausing and resuming when the host has no notifications', async () => {
  const h = await setup(false, false, [], 'unavailable', new Map(), true)
  h.setNoticeRejection('unavailable')
  h.setPlayerFails(true)
  await h.refreshSession()
  await vi.advanceTimersByTimeAsync(10_000)
  expect(h.paused()).toBe(true)
  h.setPlayerFails(false)
  await vi.advanceTimersByTimeAsync(10_000)
  expect(h.paused()).toBe(false)
  expect(h.notices).toEqual([])
  expect(h.debugs.filter((item) => item.message === '发送通知失败')).toHaveLength(2)
  await h.dispose()
})
it('notifies a log write failure once until a write succeeds again', async () => {
  const h = await setup()
  const logNotices = () => h.notices.filter((notice) => notice.title === '战斗日志没有保存')
  // A visit starts with the zone; the combat log is written every ten seconds during one.
  await h.zone([
    { meta: meta(1000), value: { territoryType: h.field(339), mapId: h.field(1) } } as unknown as Sample<
      GameTopics['zone']
    >,
  ])
  h.setWriteError('disk')
  await h.events([sample(effect(1), 1000)])
  await vi.advanceTimersByTimeAsync(10_000)
  expect(logNotices()).toEqual([{ title: '战斗日志没有保存', detail: '日志写入失败：disk' }])
  await h.events([sample(effect(2), 1100)])
  await vi.advanceTimersByTimeAsync(10_000)
  expect(logNotices()).toHaveLength(1)
  h.setWriteError(null)
  await h.events([sample(effect(3), 1200)])
  await vi.advanceTimersByTimeAsync(10_000)
  expect(logNotices()).toHaveLength(1)
  h.setWriteError('disk')
  await h.events([sample(effect(4), 1300)])
  await vi.advanceTimersByTimeAsync(10_000)
  expect(logNotices()).toHaveLength(2)
  await h.dispose()
})
it('publishes the overheal of a heal measured against the target HP', async () => {
  const h = await setup()
  const hp = (seq: number, hpCur: number, hpMax: number | null, sequence: number): GameEvent<'hpChanged'> => ({
    type: 'hpChanged',
    packet: { seq, timestamp: seq, sourceActorId: 1, targetActorId: 1 },
    data: { origin: 'effectResult' as const, actorId: 1, hpCur, hpMax, sequence },
  })
  const heal = effect(3, 8000, 1, 1, 4)
  heal.data.sequence = 8
  await h.events([
    sample(effect(1), 1000),
    sample(hp(2, 5000, 10000, 7), 1100),
    sample(heal, 1200),
    sample(hp(4, 10000, 10000, 8), 1300),
  ])
  const state = h.snapshots.get('statistics') as unknown as {
    current: { rows: { actor: { id: number }; metrics: Record<string, { value: number | null }> }[] }
  }
  const row = state.current.rows.find((item) => item.actor.id === 1)!
  expect(row.metrics.overheal.value).toBe(3000)
  expect(row.metrics.effectiveHealing.value).toBe(5000)
  await h.dispose()
})
it('writes the combat log to a daily Parquet file with readable notes', async () => {
  const h = await setup()
  await h.zone([
    { meta: meta(1000), value: { territoryType: h.field(339), mapId: h.field(1) } } as unknown as Sample<
      GameTopics['zone']
    >,
  ])
  await h.events([sample(effect(1), 1000)])
  await h.events([
    sample(
      {
        type: 'castStarted',
        packet: effect(2).packet,
        data: { ...castSpace, casterId: 9, actionId: 7, targetId: 1, durationMs: 3000 },
      },
      1100,
    ),
  ])
  h.setNow(12000)
  await h.timers.at(-1)!()
  await h.dispose()
  const name = `log/${localDate(1000)}.parquet`
  const bytes = h.files.get(name)!
  const rows = await fileRows(bytes)
  expect(rows.map((row) => row.kind)).toEqual(
    expect.arrayContaining(['visitStart', 'zone', 'fightStart', 'action', 'castStart', 'fightEnd', 'visitEnd']),
  )
  const text = new TextDecoder().decode(bytes)
  expect(text).toContain('"note":"visitStart"')
  expect(text).toContain('"zone":"海雾村"')
  expect(JSON.parse(rows.find((row) => row.kind === 'fightEnd')!.note)).toMatchObject({
    reason: 'quiet',
    hash: expect.stringMatching(/^sha256:/),
  })
})
it('writes whether enemies are targetable and the cutscenes to the combat log', async () => {
  const h = await setup()
  await h.zone([
    { meta: meta(1000), value: { territoryType: h.field(339), mapId: h.field(1) } } as unknown as Sample<
      GameTopics['zone']
    >,
  ])
  await h.events([sample(effect(1), 1000)])
  await h.scene([
    sample({ type: 'targetableChanged', data: { actorId: 9, targetable: false } }, 1100),
    sample({ type: 'cutsceneChanged', data: { playing: true } }, 1200),
  ])
  h.setNow(12000)
  await h.timers.at(-1)!()
  await h.dispose()
  const rows = await fileRows(h.files.get(`log/${localDate(1000)}.parquet`)!)
  expect(rows.filter((row) => row.kind === 'targetable' || row.kind === 'cutscene')).toEqual([
    expect.objectContaining({ kind: 'targetable', t: 1100n, actor: 9n, flag: false, pseq: null }),
    expect.objectContaining({ kind: 'cutscene', t: 1200n, actor: null, flag: true, pseq: null }),
  ])
  expect(h.warnings).not.toContain('可选中状态和过场动画订阅失败')
})
it('keeps the statistics and the cast log when the host rejects the targetable and cutscene events', async () => {
  const h = await setup(false, false, ['targetableChanged'], 'invalid_argument')
  await settle()
  expect(h.warnings.filter((message) => message === '可选中状态和过场动画订阅失败')).toHaveLength(1)
  expect(h.selections.filter((selection) => selection.includes('castStarted'))).toHaveLength(1)
  await h.zone([
    { meta: meta(1000), value: { territoryType: h.field(339), mapId: h.field(1) } } as unknown as Sample<
      GameTopics['zone']
    >,
  ])
  await h.events([sample(effect(1), 1000)])
  await h.review([
    sample(
      {
        type: 'castStarted',
        packet: effect(2).packet,
        data: { ...castSpace, casterId: 9, actionId: 7, targetId: 1, durationMs: 3000 },
      },
      1100,
    ),
  ])
  expect((h.snapshots.get('statistics') as unknown as StatisticsState).current!.rows.length).toBeGreaterThan(0)
  h.setNow(12000)
  await h.timers.at(-1)!()
  await h.dispose()
  const rows = await fileRows(h.files.get(`log/${localDate(1000)}.parquet`)!)
  expect(rows.map((row) => row.kind)).toEqual(expect.arrayContaining(['action', 'castStart', 'fightEnd']))
})
/** The level and job of a paladin, which the combat model reads */
const paladin = (actorId: number): GameEvent => ({
  type: 'actorProfileChanged',
  data: { actorId, classJob: 19, level: 100, ownerId: null },
})
/** Fast Blade, an action of the paladin with a potency of 220 at level 100 */
const fastBlade = (seq: number, source: number): GameEvent<'actionEffect'> => {
  const event = effect(seq, 9000, source)
  return { ...event, data: { ...event.data, actionId: 9 } }
}
it('writes the potency samples the combat model takes from the members to the combat log only', async () => {
  const h = await setup()
  await h.zone([
    { meta: meta(1000), value: { territoryType: h.field(339), mapId: h.field(1) } } as unknown as Sample<
      GameTopics['zone']
    >,
  ])
  await h.events([
    sample(paladin(1), 900),
    sample(paladin(10), 900),
    sample(fastBlade(1, 1), 1000),
    sample(fastBlade(2, 10), 1100),
  ])
  // The samples do not count as damage: only the two hits do
  expect((h.snapshots.get('statistics') as unknown as StatisticsState).current).toMatchObject({
    encounterDamage: { value: 9000 },
  })
  h.setNow(12000)
  await h.timers.at(-1)!()
  await h.dispose()
  const rows = await fileRows(h.files.get(`log/${localDate(1000)}.parquet`)!)
  expect(rows.filter((row) => row.kind === 'potency')).toEqual([
    expect.objectContaining({ kind: 'potency', t: 1000n, actor: 1n, target: 9n, amount: 9000, retained: 220 }),
  ])
})
it('logs the status lists of the main subscription for the review', async () => {
  const h = await setup()
  await h.zone([
    { meta: meta(1000), value: { territoryType: h.field(339), mapId: h.field(1) } } as unknown as Sample<
      GameTopics['zone']
    >,
  ])
  await h.events([
    sample(effect(1), 1000),
    sample(
      {
        type: 'statusesReplaced',
        packet: effect(2).packet,
        data: {
          actorId: 9,
          statuses: [{ statusId: 7, param: 0, sourceActorId: 1, durationMs: 30000, observedAt: 1100, slot: 0 }],
        },
      },
      1100,
    ),
  ])
  h.setNow(12000)
  await h.timers.at(-1)!()
  await h.dispose()
  const rows = await fileRows(h.files.get(`log/${localDate(1000)}.parquet`)!)
  expect(rows.filter((row) => row.kind === 'statuses' || row.kind === 'statusItem')).toEqual([
    expect.objectContaining({ kind: 'statuses', t: 1100n, actor: 9n }),
    expect.objectContaining({ kind: 'statusItem', status: 7 }),
  ])
})
it('pauses when the status data of the combat model is for another opcode version', async () => {
  const h = await setup(false, false, [], 'unavailable', new Map(), true, '7.0')
  expect(h.paused()).toBe(true)
  expect(h.selections.filter((selection) => selection.includes('actionEffect'))).toEqual([])
  await h.dispose()
})
it('reads job icons and the icons of Action and Status rows once each', async () => {
  const h = await setup()
  const icon = (key: string) => h.commands.get('statistics')!({ kind: 'icon', key })
  expect(await icon('job:24')).toMatchObject({ mime: 'image/png', data: Uint8Array.of(62124 % 256) })
  expect(await icon('job:24')).toMatchObject({ mime: 'image/png' })
  expect(await icon('action:10')).toMatchObject({ data: Uint8Array.of(405 % 256) })
  // A skill of the limit break row has the icon of its action
  expect(await icon('action:10@source:1:1')).toMatchObject({ data: Uint8Array.of(405 % 256) })
  expect(await icon('status:7')).toBeNull()
  expect(await icon('job:25')).toBeNull()
  expect(await icon('job:25')).toBeNull()
  expect(await icon('unknown')).toBeNull()
  expect(h.icons).toEqual([62124, 405, 62125])
  await h.dispose()
})
it('does not pause while no game is connected', async () => {
  const h = await setup(false, false, ['overTimeTick'])
  expect(h.paused()).toBe(true)
  expect(h.snapshots.get('statistics')).toMatchObject({ inputError: null })
  await h.idle()
  expect(h.paused()).toBe(false)
  await h.dispose()
})
it('lists only the visits with a fight, by the name of their duty, the current one from its first fight', async () => {
  const h = await setup()
  const visits = () => (h.snapshots.get('visits') as unknown as VisitsState).visits
  const enter = async (territoryType: number, at: number) => {
    h.setNow(at)
    await h.zone([
      {
        meta: meta(at),
        value: { territoryType: h.field(territoryType), mapId: h.field(1) },
      } as unknown as Sample<GameTopics['zone']>,
    ])
  }
  const fight = async (seq: number, at: number) => {
    await h.events([sample(effect(seq), at)])
    const state = h.snapshots.get('statistics') as unknown as StatisticsState
    await h.serviceRequest('endEncounter', { encounterId: state.current!.id })
  }
  await enter(128, 1000)
  await enter(1001, 2000)
  await fight(1, 2100)
  await enter(339, 3000)
  expect(visits().map((visit) => [visit.territoryType, visit.zoneName])).toEqual([[1001, '海德林歼灭战']])
  await h.events([sample(effect(2), 3100)])
  expect(visits().map((visit) => [visit.territoryType, visit.current, visit.zoneName])).toEqual([
    [339, true, '海雾村'],
    [1001, false, '海德林歼灭战'],
  ])
  const state = h.snapshots.get('statistics') as unknown as StatisticsState
  await h.serviceRequest('endEncounter', { encounterId: state.current!.id })
  expect(visits().map((visit) => visit.territoryType)).toEqual([339, 1001])
  await h.dispose()
})
it('publishes the newest 100 visits with a fight, and visits without one take no place', async () => {
  const h = await setup()
  const visits = () => (h.snapshots.get('visits') as unknown as VisitsState).visits
  let at = 1000
  for (let index = 0; index < 101; index++) {
    at += 1000
    h.setNow(at)
    await h.zone([
      { meta: meta(at), value: { territoryType: h.field(500 + index), mapId: h.field(1) } } as unknown as Sample<
        GameTopics['zone']
      >,
    ])
    await h.events([sample(effect(index + 1), at + 100)])
    const state = h.snapshots.get('statistics') as unknown as StatisticsState
    await h.serviceRequest('endEncounter', { encounterId: state.current!.id })
    at += 1000
    h.setNow(at)
    await h.zone([
      { meta: meta(at), value: { territoryType: h.field(128), mapId: h.field(1) } } as unknown as Sample<
        GameTopics['zone']
      >,
    ])
  }
  const state = () => h.snapshots.get('visits') as unknown as VisitsState
  const command = (input: Command) => h.commands.get('statistics')!(input as unknown as Value)
  expect(visits()).toHaveLength(100)
  expect(visits()[0].territoryType).toBe(600)
  expect(visits().at(-1)!.territoryType).toBe(501)
  expect(state()).toMatchObject({ page: 0, hasPrevious: false, hasNext: true })
  await command({ kind: 'visits', query: DEFAULT_QUERY, page: 1 })
  expect(visits().map((visit) => visit.territoryType)).toEqual([500])
  expect(state()).toMatchObject({ page: 1, hasPrevious: true, hasNext: false })
  // The visit of the selected fight stays known on another page.
  const oldest = visits()[0]
  await command({ kind: 'select', visitId: oldest.id, fightId: oldest.fights[0].id })
  await command({ kind: 'visits', query: DEFAULT_QUERY, page: 0 })
  expect(visits()[0].territoryType).toBe(600)
  expect(state().selected?.id).toBe(oldest.id)
  await h.dispose()
}, 120_000)
it('has no other page with fewer than 100 visits', async () => {
  const h = await setup()
  await h.events([sample(effect(1), 1000)])
  expect(h.snapshots.get('visits')).toMatchObject({ page: 0, hasPrevious: false, hasNext: false, reading: false })
  await h.dispose()
})
it('publishes the visits of a duty search with its query, and all of them again without one', async () => {
  const h = await setup()
  const visits = () => (h.snapshots.get('visits') as unknown as VisitsState).visits
  const command = (input: Command) => h.commands.get('statistics')!(input as unknown as Value)
  for (const [territoryType, at] of [
    [1001, 2000],
    [339, 3000],
  ]) {
    h.setNow(at)
    await h.zone([
      { meta: meta(at), value: { territoryType: h.field(territoryType), mapId: h.field(1) } } as unknown as Sample<
        GameTopics['zone']
      >,
    ])
    await h.events([sample(effect(at), at + 100)])
    const state = h.snapshots.get('statistics') as unknown as StatisticsState
    await h.serviceRequest('endEncounter', { encounterId: state.current!.id })
  }
  expect(visits().map((visit) => visit.territoryType)).toEqual([339, 1001])
  const query = { ...DEFAULT_QUERY, duty: '海德林' }
  await command({ kind: 'visits', query, page: 0 })
  expect(visits().map((visit) => visit.territoryType)).toEqual([1001])
  expect((h.snapshots.get('visits') as unknown as VisitsState).query).toEqual(query)
  await command({ kind: 'visits', query: DEFAULT_QUERY, page: 0 })
  expect(visits().map((visit) => visit.territoryType)).toEqual([339, 1001])
  await h.dispose()
})
it('refuses a visits command with an invalid query and keeps the published list', async () => {
  const h = await setup()
  await h.events([sample(effect(1), 1000)])
  const before = h.snapshots.get('visits')
  const command = h.commands.get('statistics')!
  await expect(command({ kind: 'visits', query: { ...DEFAULT_QUERY, jobs: 'x' }, page: 0 })).rejects.toThrow('无效命令')
  await expect(command({ kind: 'visits', query: { ...DEFAULT_QUERY }, page: -1 })).rejects.toThrow('无效命令')
  await expect(command({ kind: 'visits', query: { ...DEFAULT_QUERY }, page: 0.5 })).rejects.toThrow('无效命令')
  expect(h.snapshots.get('visits')).toBe(before)
  await h.dispose()
})
/**
 * A log written before the activation: one visit on October 19 with a member named Alice, one on the 20th and 100 on
 * the 21st, each with a fight. Opening it reads the 21st only.
 */
async function storedLog() {
  const memory = memoryStorage()
  const at = (day: number, minute: number) => new Date(2026, 9, day, 10, minute).getTime()
  const field = <T>(value: T) => ({ state: 'ok', value, observedAt: 0, from: 'packet', timeBase: 'packet-unix' })
  let name = '同名'
  const store = new LogStore(memory.storage, { values: {} } as never, 'test')
  const recorder = new Recorder({
    sink: store,
    actors: () =>
      new Map([[1, { key: 'source:1:1', id: 1, name, worldId: 1, job: 19, kind: 'member' as const, ownerKey: null }]]),
    names: { zone: () => '区域', job: () => null },
    brief: () => ({ result: null, mainEnemy: null }),
    positions: () => {},
  })
  recorder.source({
    state: 'replay',
    sessionId: 's',
    characterGeneration: 1,
    clock: { generation: 1 },
    character: { actorId: 1 },
    dataLanguage: 'chs',
  } as unknown as SessionSnapshot)
  const carry = {
    encounters: {
      localActorId: 1,
      inCombat: null,
      combatValue: null,
      packetSeq: null,
      combatSeq: null,
      combatAt: null,
    },
    generations: [],
  }
  const visit = async (day: number, minute: number, territoryType: number) => {
    const t = at(day, minute)
    vi.setSystemTime(t)
    recorder.zone({ territoryType: field(territoryType), mapId: field(1) } as never, t, carry)
    recorder.identities('entities', [], [], new Set([1]), 'party', t)
    recorder.fightStarted({ id: `enc-${day}-${minute}`, at: t + 1000 })
    recorder.fightEnded({
      id: `enc-${day}-${minute}`,
      reason: 'manual',
      at: t + 2000,
      summary: { durationMs: 1, rows: [] } as unknown as Summary,
    })
    recorder.stop(t + 3000)
    await store.flush()
  }
  name = 'Alice'
  await visit(19, 0, 900)
  name = '同名'
  await visit(20, 0, 901)
  for (let index = 0; index < 100; index++) await visit(21, index, 500 + index)
  vi.setSystemTime(new Date(2026, 9, 22, 9).getTime())
  return memory.files
}
it('filters self only by the member the log recorded rather than the logged-in character', async () => {
  const memory = memoryStorage()
  const t = new Date(2026, 9, 21, 10).getTime()
  const field = <T>(value: T) => ({ state: 'ok', value, observedAt: 0, from: 'packet', timeBase: 'packet-unix' })
  const store = new LogStore(memory.storage, { values: {} } as never, 'test')
  const member = (id: number, job: number) => ({
    key: `source:${id}:1`,
    id,
    name: `P${id}`,
    worldId: 1,
    job,
    kind: 'member' as const,
    ownerKey: null,
  })
  const recorder = new Recorder({
    sink: store,
    actors: () => new Map([member(1, 24), member(2, 19)].map((actor) => [actor.id, actor])),
    names: { zone: () => '区域', job: () => null },
    brief: () => ({ result: null, mainEnemy: null }),
    positions: () => {},
  })
  // Recorded while playing actor 2, the Paladin; the worker below runs as actor 1, a White Mage in this visit.
  recorder.source({
    state: 'replay',
    sessionId: 's',
    characterGeneration: 1,
    clock: { generation: 1 },
    character: { actorId: 2 },
    dataLanguage: 'chs',
  } as unknown as SessionSnapshot)
  vi.setSystemTime(t)
  const carry = {
    encounters: {
      localActorId: 2,
      inCombat: null,
      combatValue: null,
      packetSeq: null,
      combatSeq: null,
      combatAt: null,
    },
    generations: [],
  }
  recorder.zone({ territoryType: field(777), mapId: field(1) } as never, t, carry)
  recorder.identities('entities', [], [], new Set([1, 2]), 'party', t)
  recorder.fightStarted({ id: 'enc-1', at: t + 1000 })
  recorder.fightEnded({ id: 'enc-1', reason: 'manual', at: t + 2000, summary: { durationMs: 1, rows: [] } as never })
  recorder.stop(t + 3000)
  await store.flush()
  vi.setSystemTime(new Date(2026, 9, 22, 9).getTime())
  const h = await setup(false, false, [], 'unavailable', memory.files)
  const visits = () => (h.snapshots.get('visits') as unknown as VisitsState).visits
  const command = (input: Command) => h.commands.get('statistics')!(input as unknown as Value)
  await command({ kind: 'visits', query: { ...DEFAULT_QUERY, jobs: [19] }, page: 0 })
  expect(visits().map((visit) => visit.territoryType)).toEqual([777])
  await command({ kind: 'visits', query: { ...DEFAULT_QUERY, jobs: [24] }, page: 0 })
  expect(visits()).toEqual([])
  await h.dispose()
})
it('reads older log files for a search until the page is full, and tells the page meanwhile', async () => {
  const files = await storedLog()
  const h = await setup(false, false, [], 'unavailable', files)
  const state = () => h.snapshots.get('visits') as unknown as VisitsState
  const until = async (done: () => boolean) => {
    for (let i = 0; i < 100 && !done(); i++) await vi.advanceTimersByTimeAsync(10)
    expect(done()).toBe(true)
  }
  // The file of the 20th tells that there is a second page.
  await until(() => state().hasNext && !state().reading)
  expect(h.reads).not.toContain('log/2026-10-19.parquet')
  const published = h.frames.length
  await h.commands.get('statistics')!({ kind: 'visits', query: { ...DEFAULT_QUERY, character: 'alice' }, page: 0 })
  await until(() => !state().reading && state().visits.length > 0)
  const frames = h.frames
    .slice(published)
    .filter((frame) => frame.channel === 'visits')
    .map((frame) => frame.value as unknown as VisitsState)
  expect(frames.some((frame) => frame.reading)).toBe(true)
  expect(state().visits.map((visit) => visit.territoryType)).toEqual([900])
  expect(state()).toMatchObject({ hasNext: false, reading: false })
  await h.dispose()
}, 60_000)
it('publishes several batches of events within the interval once, with all of their statistics', async () => {
  const h = await setup()
  await h.events([sample(effect(1), 1000)])
  // The first batch after a quiet interval is published at once; the next ones wait for the interval.
  await h.send([sample(effect(2, 200), 1050)])
  await vi.advanceTimersByTimeAsync(0)
  h.calls.length = 0
  await h.send([sample(effect(3, 300), 1100)])
  await h.send([sample(effect(4, 400), 1150)])
  await vi.advanceTimersByTimeAsync(PUBLISH_MS - 1)
  expect(h.calls.filter((call) => call === 'set:statistics')).toHaveLength(0)
  await settle()
  expect(h.calls.filter((call) => call === 'set:statistics')).toHaveLength(1)
  const state = h.snapshots.get('statistics') as unknown as StatisticsState
  expect(state.current!.encounterDamage.value).toBe(1000)
  await h.dispose()
})
it('a command publishes and flushes before it returns, without waiting for the interval', async () => {
  const h = await setup()
  await h.events([sample(effect(1), 1000)])
  const state = h.snapshots.get('statistics') as unknown as StatisticsState
  const visitId = (h.snapshots.get('visits') as unknown as VisitsState).visits[0]?.id ?? 'visit'
  h.calls.length = 0
  await h.commands.get('statistics')!({ kind: 'select', visitId, fightId: state.current!.id })
  expect(h.calls.at(-1)).toBe('flush')
  expect(h.snapshots.get('statistics')).toMatchObject({ following: true, selection: { fightId: state.current!.id } })
  h.calls.length = 0
  await h.commands.get('statistics')!({ kind: 'select', visitId, fightId: 'older' })
  expect(h.calls.at(-1)).toBe('flush')
  expect(h.snapshots.get('statistics')).toMatchObject({ following: false })
  await h.dispose()
})
it('publishes the ended fight before the next one on the ordered overlay service', async () => {
  const h = await setup()
  await h.events([sample(effect(1), 1000), sample(combat(2, true), 1000)])
  h.calls.length = 0
  await h.send([sample(combat(3, false), 1100), sample(effect(4, 200), 1200), sample(combat(5, true), 1200)])
  await settle()
  const combatCalls = h.calls.filter((call) => call === 'publish:combat')
  const ended = h.frames
    .filter((frame) => frame.channel === 'combat')
    .map((frame) => frame.value as unknown as { encounterId: string; combatData: { isActive: string } | null })
  const last = ended.findLastIndex((frame) => frame.combatData?.isActive === 'false')
  expect(last).toBeGreaterThanOrEqual(0)
  expect(ended.at(-1)).toMatchObject({ combatData: { isActive: 'true' } })
  expect(ended.at(-1)!.encounterId).not.toBe(ended[last].encounterId)
  expect(combatCalls.slice(-2)).toEqual(['publish:combat', 'publish:combat'])
  await h.dispose()
})
it('publishes at once only when the session or the zone really changes', async () => {
  const h = await setup()
  const zone = (territoryType: number) =>
    h.zone([
      { meta: meta(1000), value: { territoryType: h.field(territoryType), mapId: h.field(1) } } as unknown as Sample<
        GameTopics['zone']
      >,
    ])
  await zone(339)
  await settle()
  h.calls.length = 0
  await h.refreshSession()
  await zone(339)
  expect(h.calls).not.toContain('flush')
  await settle()
  expect(h.calls).toContain('set:statistics')
  h.calls.length = 0
  await zone(340)
  expect(h.calls.at(-1)).toBe('flush')
  h.calls.length = 0
  await h.idle()
  expect(h.calls.at(-1)).toBe('flush')
  await h.dispose()
})
it('replays an ended fight from the log for its review, once until another fight is asked for', async () => {
  const first = await setup()
  const zone = (territoryType: number, at: number) =>
    first.zone([
      {
        meta: meta(at),
        value: { territoryType: first.field(territoryType), mapId: first.field(1) },
      } as unknown as Sample<GameTopics['zone']>,
    ])
  await zone(339, 1000)
  await first.events([sample(effect(1), 1000), sample(effect(2, 300, 9, 1), 1500)])
  first.setNow(12000)
  await first.timers.at(-1)!()
  await zone(340, 13000)
  const [visit] = (first.snapshots.get('visits') as unknown as VisitsState).visits
  const fightId = visit.fights[0].id
  await first.dispose()

  const h = await setup(false, false, [], 'unavailable', first.files)
  const command = (input: Command) => h.commands.get('statistics')!(input as unknown as Value)
  const result = (await command({ kind: 'replay', visitId: visit.id, fightId })) as unknown as ReplayResult
  if (!result.ok) throw new Error(result.reason)
  // The fight ends quietly ten seconds after its last hit
  expect(result.data.fight).toEqual({ visitId: visit.id, fightId, durationMs: 10_500 })
  expect(result.data.actors.map((actor) => [actor.name, actor.kind])).toEqual([
    ['Synthetic', 'member'],
    ['Enemy', 'enemy'],
  ])
  const { entries } = result.data
  expect([...entries.field].map((field) => ENTRY_FIELDS[field])).toEqual(['damage', 'taken'])
  expect(new Set(Object.values(entries).map((column: ArrayLike<number>) => column.length))).toEqual(new Set([2]))
  expect(result.data.actions).toEqual([{ actionId: 10, name: '技能', gcd: false, lane: null, durationMs: null }])
  // Kept: the same data without reading the log again
  expect(await command({ kind: 'replay', visitId: visit.id, fightId })).toBe(result)
  expect(await command({ kind: 'replay', visitId: visit.id, fightId: 'missing' })).toEqual({
    ok: false,
    reason: '日志中找不到这场战斗',
  })
  await h.dispose()
})

/** The log of one ended fight in which the player hit with action 10 and put the buff 49 on the enemy. */
async function recordedFight() {
  const h = await setup()
  await h.zone([
    { meta: meta(1000), value: { territoryType: h.field(339), mapId: h.field(1) } } as unknown as Sample<
      GameTopics['zone']
    >,
  ])
  await h.events([sample(effect(1), 1000)])
  await h.review([
    sample(
      {
        type: 'statusChanged',
        packet: effect(2).packet,
        data: {
          actorId: 9,
          slot: 0,
          status: { statusId: 49, param: 0, sourceActorId: 1, durationMs: 5000, observedAt: 1200 },
        },
      },
      1200,
    ),
  ])
  await h.events([sample(effect(3), 1500)])
  h.setNow(12000)
  await h.timers.at(-1)!()
  const [visit] = (h.snapshots.get('visits') as unknown as VisitsState).visits
  await h.dispose()
  return { files: h.files, request: { kind: 'replay', visitId: visit.id, fightId: visit.fights[0].id } as Command }
}
const reviewNames = (result: ReplayResult) => {
  if (!result.ok) throw new Error(result.reason)
  return { actions: result.data.actions.map((action) => action.name), statuses: result.data.statusInfo }
}

/**
 * The log of two visits with one ended fight each. A new activation opens on the newest fight, so it reads the second
 * visit by itself; the first is read only when the page asks for it.
 */
async function recordedVisits() {
  const h = await setup()
  const zone = (territoryType: number, at: number) =>
    h.zone([
      { meta: meta(at), value: { territoryType: h.field(territoryType), mapId: h.field(1) } } as unknown as Sample<
        GameTopics['zone']
      >,
    ])
  await zone(339, 1000)
  await h.events([sample(effect(1), 1000), sample(effect(2, 300, 9, 1), 1500)])
  h.setNow(12000)
  await h.timers.at(-1)!()
  await zone(340, 13000)
  await h.events([sample(effect(3), 14000)])
  h.setNow(25000)
  await h.timers.at(-1)!()
  const visits = (h.snapshots.get('visits') as unknown as VisitsState).visits
  await h.dispose()
  const older = visits.find((visit) => visit.territoryType === 339)!
  return { files: h.files, visitId: older.id, fightId: older.fights[0].id }
}
/** A new activation over a copy of the log, with the commands for the fight of the older visit */
async function reviewSetup({ files, visitId, fightId }: Awaited<ReturnType<typeof recordedVisits>>) {
  const h = await setup(false, false, [], 'unavailable', new Map(files))
  const command = (input: Command) => h.commands.get('statistics')!(input as unknown as Value)
  const review = async () => (await command({ kind: 'replay', visitId, fightId })) as unknown as ReplayResult
  const select = () => command({ kind: 'select', visitId, fightId })
  return { h, command, review, select }
}
const reviewLog = (h: Awaited<ReturnType<typeof setup>>) => h.debugs.filter((item) => item.message === '读取战斗回顾')

it('reads the visit for a review the overview did not read', async () => {
  const recorded = await recordedVisits()
  const { h, review } = await reviewSetup(recorded)
  h.reads.length = 0
  const result = await review()
  expect(result.ok).toBe(true)
  expect(h.reads.length).toBeGreaterThan(0)
  expect(reviewLog(h)).toEqual([
    {
      message: '读取战斗回顾',
      fields: {
        visitId: recorded.visitId,
        fightId: recorded.fightId,
        replayMs: expect.any(Number),
        gameDataMs: expect.any(Number),
        reused: false,
      },
    },
  ])
  await h.dispose()
})
it('fails the review of a fight whose records cannot be read', async () => {
  const recorded = await recordedVisits()
  const { h, review } = await reviewSetup(recorded)
  for (const name of h.files.keys()) if (name.endsWith('.parquet')) h.files.set(name, Uint8Array.of(1, 2, 3))
  const failed = await review()
  // The fight is in the index, but its records cannot be read
  expect(failed).toEqual({ ok: false, reason: expect.any(String) })
  expect(failed.ok || failed.reason).not.toBe('日志中找不到这场战斗')
  await h.dispose()
})
it('builds the review from the read the overview already did', async () => {
  const recorded = await recordedVisits()
  const direct = await reviewSetup(recorded)
  const expected = await direct.review()
  await direct.h.dispose()

  const { h, review, select } = await reviewSetup(recorded)
  await select()
  // Queued behind the overview's read, so it returns once that is done.
  await select()
  expect(h.debugs).toContainEqual({
    message: '读取进本日志',
    fields: { visitId: recorded.visitId, records: expect.any(Number), ms: expect.any(Number) },
  })
  const read = h.reads.length
  expect(await review()).toEqual(expected)
  expect(h.reads).toHaveLength(read)
  expect(reviewLog(h)).toMatchObject([{ fields: { reused: true } }])
  await h.dispose()
})
it('waits for the overview still reading the visit instead of reading it again', async () => {
  const recorded = await recordedVisits()
  const direct = await reviewSetup(recorded)
  const expected = await direct.review()
  await direct.h.dispose()

  const { h, review, select } = await reviewSetup(recorded)
  h.reads.length = 0
  await select()
  // The overview's read has started but not finished.
  expect(h.debugs.filter((item) => item.message === '读取进本日志')).toHaveLength(1)
  expect(await review()).toEqual(expected)
  expect(h.reads.length).toBeGreaterThan(0)
  expect(new Set(h.reads).size).toBe(h.reads.length)
  expect(reviewLog(h)).toMatchObject([{ fields: { reused: true } }])
  await h.dispose()
})
it('forgets the prepared review when the history is cleared', async () => {
  const { h, command, review, select } = await reviewSetup(await recordedVisits())
  await select()
  await select()
  await command({ kind: 'clear' })
  expect(await review()).toEqual({ ok: false, reason: '日志中找不到这场战斗' })
  await h.dispose()
})
it('builds the review again once game data that could not be read is open', async () => {
  const { files, request } = await recordedFight()
  const h = await setup(false, false, [], 'unavailable', files)
  const replay = async () =>
    (await h.commands.get('statistics')!(request as unknown as Value)) as unknown as ReplayResult
  h.setDataClosed(true)
  // The action name was already read for the visit list, before the data closed.
  expect(reviewNames(await replay()).statuses).toEqual([{ statusId: 49, name: null, category: null, raidBuff: false }])
  h.setDataClosed(false)
  const opened = await replay()
  expect(reviewNames(opened)).toEqual({
    actions: ['技能'],
    statuses: [{ statusId: 49, name: '状态', category: 'buff', raidBuff: false }],
  })
  expect(await replay()).toBe(opened)
  await h.dispose()
})

it('names the review at once when a session gains its data language', async () => {
  const { files, request } = await recordedFight()
  const h = await setup(false, false, [], 'unavailable', files)
  const replay = async () =>
    (await h.commands.get('statistics')!(request as unknown as Value)) as unknown as ReplayResult
  await h.refreshSession(null)
  // The action name read for the overview is cached; the status was never read.
  expect(reviewNames(await replay())).toEqual({
    actions: ['技能'],
    statuses: [{ statusId: 49, name: null, category: null, raidBuff: false }],
  })
  await h.refreshSession('cn')
  expect(reviewNames(await replay())).toMatchObject({ actions: ['技能'], statuses: [{ category: 'buff' }] })
  await h.dispose()
})

it('shows the icons and names an earlier activation read while no game data is open', async () => {
  const first = await setup()
  const icon = (h: typeof first, key: string) => h.commands.get('statistics')!({ kind: 'icon', key })
  expect(await icon(first, 'action:10')).toMatchObject({ data: Uint8Array.of(405 % 256) })
  await first.dispose()
  expect([...first.files.keys()].filter((name) => name.startsWith('game-data/')).sort()).toEqual([
    'game-data/icons/405.png',
    'game-data/index.json',
  ])
  const second = await setup(false, false, [], 'unavailable', first.files)
  second.setDataClosed(true)
  await second.refreshSession(null)
  expect(await icon(second, 'action:10')).toMatchObject({ data: Uint8Array.of(405 % 256) })
  expect(second.icons).toEqual([])
  await second.dispose()
})

it('fails an icon request while no game data is open, and reads the icon once it is', async () => {
  const h = await setup()
  const icon = (key: string) => h.commands.get('statistics')!({ kind: 'icon', key })
  h.setDataClosed(true)
  await expect(icon('action:10')).rejects.toMatchObject({ code: 'unavailable' })
  await h.refreshSession(null)
  await expect(icon('action:10')).rejects.toThrow()
  h.setDataClosed(false)
  await h.refreshSession('cn')
  expect(await icon('action:10')).toMatchObject({ data: Uint8Array.of(405 % 256) })
  await h.dispose()
})
