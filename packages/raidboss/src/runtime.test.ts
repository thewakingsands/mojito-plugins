import { readFileSync } from 'node:fs'
import type { ClockService, Field, GameEvent, SourceMeta } from '@ffcafe/mojito-plugin-sdk'
import { expect, it } from 'vitest'
import Conditions from '../vendor/cactbot/resources/conditions'
import PartyTracker from '../vendor/cactbot/resources/party'
import { Responses } from '../vendor/cactbot/resources/responses'
import p1n from '../vendor/cactbot/ui/raidboss/data/06-ew/raid/p1n'
import { Timeline } from '../vendor/cactbot/ui/raidboss/timeline'
import {
  type ProcessedTrigger,
  TriggerOutputProxy,
  WorkerCallbacks,
} from '../vendor/cactbot/ui/raidboss/worker_callbacks'
import { options, RaidbossEngine } from './engine'
import { EntityCache, projectEvent } from './events'
import { combatantProperties, partyMembers, raidbossData, sameParty } from './game'
import { compileMatcher, localizedConditions } from './matcher'
import { TimelineClock } from './timeline-clock'

const timeline = readFileSync(new URL('../vendor/cactbot/ui/raidboss/data/06-ew/raid/p1n.txt', import.meta.url), 'utf8')
const meta: SourceMeta = {
  sessionId: 'fixture',
  characterGeneration: 1,
  clockGeneration: 1,
  observedAt: 100000,
  source: 'replay',
  timeBase: 'packet-unix',
  sampleStartedAt: null,
  sampleEndedAt: null,
}
const field = <T>(value: T, time = meta.observedAt): Field<T> => ({
  state: 'ok',
  value,
  from: 'memory',
  observedAt: time,
  timeBase: meta.timeBase,
})
function clock() {
  let now = 100000,
    serial = 0
  const tasks = new Map<number, { due: number; run: () => void | Promise<void> }>()
  const value: ClockService = {
    now: () => now,
    state: () => ({ now, generation: 1, base: 'packet-unix', source: 'replay', paused: false }),
    setTimeout(run, ms) {
      const id = ++serial
      tasks.set(id, { due: now + ms, run })
      return () => {
        tasks.delete(id)
      }
    },
    sleep(ms, options) {
      return new Promise((resolve, reject) => {
        if (options?.signal?.aborted) {
          reject(new Error('aborted'))
          return
        }
        const cancel = value.setTimeout(() => {
          options?.signal?.removeEventListener('abort', abort)
          resolve()
        }, ms)
        const abort = () => {
          void cancel()
          reject(new Error('aborted'))
        }
        options?.signal?.addEventListener('abort', abort, { once: true })
      })
    },
  }
  return {
    value,
    tasks,
    async advance(ms: number) {
      const end = now + ms
      for (;;) {
        const next = [...tasks].sort((a, b) => a[1].due - b[1].due)[0]
        if (!next || next[1].due > end) break
        now = next[1].due
        tasks.delete(next[0])
        await next[1].run()
        await Promise.resolve()
      }
      now = end
      await Promise.resolve()
      await Promise.resolve()
    },
  }
}

it('keeps persistent collection state out of combat and supplies configured strategy defaults', () => {
  const timer = clock(),
    f = fixture(),
    trace: string[] = []
  const sets = [false, true].map((persistent) => ({
    path: String(persistent),
    set: {
      id: String(persistent),
      zoneId: 1,
      resetWhenOutOfCombat: !persistent,
      initData: () => ({ [String(persistent)]: 0 }),
      config: [{ id: 'strategy', type: 'select', default: 'left', options: { en: { Left: 'left', Right: 'right' } } }],
      triggers: [
        {
          id: 'count',
          type: 'HeadMarker',
          netRegex: {},
          run: (data: any) => {
            data[String(persistent)]++
            trace.push(`${persistent}:${data[String(persistent)]}:${data.triggerSetConfig.strategy}`)
          },
        },
      ],
    },
  }))
  const engine = new RaidbossEngine(sets, {}, timer.value, { changed() {}, say() {}, play() {} })
  const settings = { language: 'en' as const, audio: 'none' as const, rules: {}, sets: { true: { strategy: 'right' } } }
  engine.start(1, f.data, settings)
  engine.event({ type: 'HeadMarker', fields: { id: '003E' } })
  engine.start(1, f.data, settings, true)
  engine.event({ type: 'HeadMarker', fields: { id: '003E' } })
  expect(trace).toEqual(['false:1:left', 'true:1:right', 'true:2:right', 'false:1:left'])
  engine.reset()
})
function fixture(job = 19) {
  const opts = options('cn'),
    tracker = new PartyTracker(opts),
    entities = new EntityCache()
  const members = [
    { id: 1, name: 'Tank', slot: 0, ownParty: true },
    { id: 2, name: 'Healer', slot: 1, ownParty: true },
    { id: 3, name: 'Melee', slot: 2, ownParty: true },
    { id: 4, name: 'Caster', slot: 3, ownParty: true },
  ]
  const jobs = new Map<number, number>()
  for (const [index, member] of members.entries())
    entities.observe({ id: member.id, name: field(member.name), classJob: field([19, 24, 20, 25][index]!) })
  tracker.onPartyChanged({
    party: partyMembers({ isInParty: field(true), members: field(members) }, entities, jobs),
  })
  const player = members[[19, 24, 20, 25].indexOf(job)]!.name
  const data = raidbossData(player, job, tracker, opts, () => {})
  Object.defineProperty(data, 'inCombat', { value: true, writable: true })
  return { opts, tracker, entities, members, jobs, data }
}

it('resolves party jobs by ID and keeps the last known job of a member out of range', () => {
  const f = fixture()
  expect(f.tracker.tankNames).toEqual(['Tank'])
  expect(f.tracker.healerNames).toEqual(['Healer'])
  expect(f.tracker.dpsNames).toEqual(['Melee', 'Caster'])
  const before = partyMembers({ isInParty: field(true), members: field(f.members) }, f.entities, f.jobs)
  f.entities.remove(2)
  const members = [...f.members, { id: 5, name: 'Away', slot: 4, ownParty: true }]
  const after = partyMembers({ isInParty: field(true), members: field(members) }, f.entities, f.jobs)
  expect(sameParty(before, after.slice(0, 4))).toBe(true)
  expect(after[4]).toMatchObject({ name: 'Away', job: 0 })
  f.tracker.onPartyChanged({ party: after })
  expect(f.tracker.healerNames).toEqual(['Healer'])
  expect(f.tracker.partyNames).toContain('Away')
  expect(
    partyMembers({ isInParty: field(true), members: { state: 'unavailable', reason: 'x' } }, f.entities, f.jobs),
  ).toEqual([])
})
it.each([
  [19, true],
  [24, true],
  [20, true],
  [25, false],
] as const)('runs upstream physical condition and tankbuster response for job %i', (job, expected) => {
  const { data } = fixture(job)
  expect(Conditions.caresAboutPhysical()(data)).toBe(expected)
  const output = TriggerOutputProxy.makeOutput({}, 'en')
  const response = Responses.tankBuster()(data, { target: 'Tank' }, output)
  if (!response) throw new Error('Missing upstream response')
  expect(
    typeof response.alarmText === 'function' ? response.alarmText(data, { target: 'Tank' }, output) : undefined,
  ).toBeUndefined()
  expect(
    typeof response.alertText === 'function'
      ? response.alertText(data, { target: 'Tank' }, output)
      : response.alertText,
  ).toBe(job === 19 ? 'Tank Buster on YOU' : undefined)
  expect(
    typeof response.infoText === 'function' ? response.infoText(data, { target: 'Tank' }, output) : response.infoText,
  ).toBe(job === 19 ? undefined : 'Tank Buster on Tank')
})
it('keeps ID domains, literal alternatives, name translation, array OR and capture semantics', () => {
  const matcher = compileMatcher(
    'StartsUsing',
    { id: '(?:6DA2|6DA3)', source: 'Erichthonios', capture: false },
    'cn',
    p1n.timelineReplace,
  )
  expect(matcher.match({ type: 'StartsUsing', fields: { id: '00006da2', source: '埃里克特翁尼亚斯' } })).toEqual({
    matches: {},
  })
  expect(matcher.match({ type: 'HeadMarker', fields: { id: '6DA2', source: '埃里克特翁尼亚斯' } })).toBeNull()
  expect(matcher.match({ type: 'StartsUsing', fields: { id: '6DA2', source: 'Other' } })).toBeNull()
  expect(matcher.match({ type: 'StartsUsing', fields: { id: '6DA2' } })).toEqual({ missing: 'source' })
  expect(localizedConditions({ netRegex: { id: '1' }, netRegexCn: { id: '2' } }, 'cn')).toEqual({ id: '2' })
  for (const conditions of [{ id: '1G' }, { id: '100000000' }, { id: '1', unknown: 'anything' }])
    expect(() => compileMatcher('StartsUsing', conditions)).toThrow()
  expect(() => compileMatcher('StartsUsing', /whole log/)).toThrow()
  expect(
    compileMatcher('StartsUsing', { id: '6DA.' }).match({ type: 'StartsUsing', fields: { id: '6DA2' } }),
  ).not.toBeNull()
})
it('projects AoE targets without collapsing sequence and names actors seen after the packet', () => {
  const { entities } = fixture()
  entities.observe({ id: 99, name: field('Later', 100001) })
  const value: GameEvent<'actionEffect'> = {
    type: 'actionEffect',
    packet: { seq: 1, timestamp: 100000, sourceActorId: 99, targetActorId: 1 },
    data: {
      sourceActorId: 99,
      actionId: 0x65f4,
      actionType: 1,
      sequence: 7,
      isAoe: true,
      sourcePosition: field({ x: 0, y: 0, z: 0 }),
      sourceRotation: field(0),
      effectRotation: field(0),
      effectPosition: field({ x: 0, y: 0, z: 0 }),
      animationTargetId: null,
      dataFlag: 0,
      targets: [
        { targetId: 1, targetIndex: 3, targetPosition: field({ x: 0, y: 0, z: 0 }), effects: [] },
        { targetId: 2, targetIndex: 7, targetPosition: field({ x: 0, y: 0, z: 0 }), effects: [] },
      ],
    },
  }
  const events = projectEvent({ meta, value }, entities)
  expect(events.map((event) => event.type)).toEqual([
    'Ability',
    'Ability',
    'NetworkAOEAbility',
    'NetworkAOEAbility',
    'AbilityExtra',
  ])
  expect(
    events
      .filter((event) => event.type === 'Ability')
      .map((event) => [event.fields.target, event.fields.targetIndex, event.fields.sequence]),
  ).toEqual([
    ['Tank', '3', '00000007'],
    ['Healer', '7', '00000007'],
  ])
  expect(events.filter((event) => event.type === 'Ability').every((event) => event.fields.source === 'Later')).toBe(
    true,
  )
})
it.each([0, Math.PI / 2, Math.PI, -Math.PI / 2])(
  'maps real XYZ and heading %s without fake unknown values',
  (heading) => {
    const actor = { id: 1, position: field({ x: 101, y: 7, z: 103 }), rotation: field(heading) }
    expect(combatantProperties(actor, ['PosX', 'PosY', 'PosZ', 'Heading'])).toEqual({
      ID: 1,
      PosX: 101,
      PosY: 103,
      PosZ: 7,
      Heading: heading,
    })
    expect(() => combatantProperties(actor, ['Job'])).toThrow('classJob')
  },
)
it('loads every official P1N trigger and all timeline syncs including InCombat and Director', async () => {
  const timer = clock(),
    f = fixture(),
    spoken: string[] = []
  const engine = new RaidbossEngine([{ path: 'p1n', set: p1n }], { 'p1n.txt': timeline }, timer.value, {
    changed() {},
    say: (text) => spoken.push(text),
    play() {},
  })
  engine.start(p1n.zoneId as number, f.data, { language: 'cn', audio: 'tts', rules: {} })
  expect(engine.diagnostics).toHaveLength(11)
  expect(engine.diagnostics.every((entry) => entry.state === 'ready')).toBe(true)
  engine.event({ type: 'InCombat', fields: { inGameCombat: '1' } })
  expect(engine.bars.length).toBeGreaterThan(0)
  for (const id of ['6DA2', '6DA3', '65F4', '65E9', '65EA', '65F3'])
    engine.event({ type: 'StartsUsing', fields: { id, source: '埃里克特翁尼亚斯', target: 'Tank' } })
  for (const id of ['0001', '003E']) engine.event({ type: 'HeadMarker', fields: { id, target: 'Tank' } })
  for (const effectId of ['AB3', 'AB4', '893'])
    engine.event({ type: 'GainsEffect', fields: { effectId, target: 'Tank', count: '14C' } })
  expect(
    engine.diagnostics.filter((entry) => entry.triggerId !== '(timeline)').every((entry) => entry.matches > 0),
  ).toBe(true)
  expect(engine.alerts.length).toBeGreaterThanOrEqual(10)
  expect(spoken.length).toBeGreaterThanOrEqual(10)
  engine.event({ type: 'ActorControl', fields: { command: '4000000F' } })
  expect(engine.bars).toHaveLength(0)
  engine.reset()
  await timer.advance(100000)
  expect(engine.alerts).toHaveLength(0)
})
it('retains upstream timeline windows and loop jumps; rejects a missing mandatory sync', () => {
  const timer = clock(),
    t = new Timeline(
      timeline,
      p1n.timelineReplace!,
      [],
      [],
      options('cn'),
      p1n.zoneId as number,
      new TimelineClock(timer.value),
    )
  expect(t.syncStarts.some((sync) => sync.matcher?.type === 'InCombat')).toBe(true)
  expect(t.syncStarts.some((sync) => sync.matcher?.conditions.command === '4000000F')).toBe(true)
  t.OnEvent({ type: 'InCombat', fields: { inGameCombat: '1' } }, 100000)
  t._OnUpdateTimer(460000)
  t.OnEvent({ type: 'Ability', fields: { id: '65F5', source: '埃里克特翁尼亚斯' } }, 460000)
  expect(t.timebase).toBeCloseTo(460000 - 188300)
  t.Stop()
  expect(() => t.OnEvent({ type: 'InCombat', fields: {} }, 100000)).toThrow('missing')
  expect(
    () => new Timeline('0 "reset" sync /old line/', [], [], [], options('cn'), 0, new TimelineClock(timer.value)),
  ).toThrow('Legacy')
})
it('keeps synchronous callback ordering and cancels delayed and promised outputs across reset', async () => {
  const timer = clock(),
    f = fixture(),
    trace: string[] = []
  const callbacks = new WorkerCallbacks(f.data, f.opts, timer.value, {
    text: () => trace.push('text'),
    say() {},
    play() {},
    fault: () => trace.push('fault'),
  })
  callbacks.run(
    {
      id: 'sync',
      condition: () => {
        trace.push('condition')
        return true
      },
      preRun: () => {
        trace.push('preRun')
      },
      delaySeconds: () => {
        trace.push('delay')
        return 0
      },
      durationSeconds: () => {
        trace.push('duration')
        return 1
      },
      suppressSeconds: () => {
        trace.push('suppress')
        return 1
      },
      countdownSeconds: () => {
        trace.push('countdown')
        return 0
      },
      response: () => {
        trace.push('response')
        return {}
      },
      infoText: () => {
        trace.push('info')
        return 'test'
      },
      run: () => {
        trace.push('run')
      },
    },
    {},
    100000,
  )
  expect(trace).toEqual([
    'condition',
    'preRun',
    'delay',
    'duration',
    'suppress',
    'countdown',
    'response',
    'info',
    'text',
    'run',
  ])
  trace.length = 0
  callbacks.run({ id: 'delayed', delaySeconds: 5, infoText: 'late', run: () => trace.push('late') }, {}, 100000)
  let resolve!: () => void
  callbacks.run(
    {
      id: 'async',
      promise: () =>
        new Promise<void>((done) => {
          resolve = done
        }),
      infoText: 'old',
    },
    {},
    100000,
  )
  callbacks.reset()
  resolve()
  await timer.advance(10000)
  expect(trace).toEqual([])
})
it('disables only unsupported and conflicting rules, preserves closure callbacks and snapshots matching', () => {
  const timer = clock(),
    f = fixture()
  let counter = 0
  const first = {
    id: 'dynamic',
    type: 'HeadMarker',
    netRegex: { id: '003E' },
    run: () => {
      counter++
    },
  } as const
  const set = {
    id: 'community',
    zoneId: null,
    triggers: [
      first,
      { id: 'missing', type: 'UnavailableEvent', netRegex: {} },
      { ...first, id: 'duplicate' },
      { ...first, id: 'duplicate' },
    ],
  }
  const engine = new RaidbossEngine([{ path: 'community', set: set as never }], {}, timer.value, {
    changed() {},
    say() {},
    play() {},
  })
  ;(first.netRegex as { id: string }).id = '0001'
  engine.start(1, f.data, { language: 'en', audio: 'none', rules: {} })
  engine.event({ type: 'HeadMarker', fields: { id: '003E' } })
  expect(counter).toBe(1)
  expect(engine.diagnostics.filter((row) => row.state === 'unsupported')).toHaveLength(3)
})

it('ignores saved collection options the rule set no longer accepts instead of stopping the module', () => {
  const timer = clock(),
    f = fixture()
  const set = {
    id: 'configured',
    zoneId: null,
    config: [{ id: 'mode', type: 'select', options: { en: { A: 'a', B: 'b' } }, default: 'a' }],
    triggers: [],
  }
  const engine = new RaidbossEngine([{ path: 'configured', set: set as never }], {}, timer.value, {
    changed() {},
    say() {},
    play() {},
  })
  engine.start(1, f.data, {
    language: 'en',
    audio: 'none',
    rules: {},
    sets: { configured: { removed: true, mode: 'z' } },
  })
  expect(engine.diagnostics.find((row) => row.triggerId === '(config)')).toMatchObject({
    state: 'unsupported',
    reason: 'Saved configuration not applied: removed, mode',
  })
})

it('isolates callback faults and cancels all other pending invocations of that rule', async () => {
  const timer = clock(),
    f = fixture()
  let runs = 0,
    fault = false
  const set = {
    id: 'errors',
    zoneId: null,
    triggers: [
      {
        id: 'bad',
        type: 'HeadMarker',
        netRegex: {},
        delaySeconds: 1,
        infoText: () => {
          if (fault) throw new Error('broken')
          return 'ok'
        },
        run: () => {
          runs++
        },
      },
      {
        id: 'good',
        type: 'HeadMarker',
        netRegex: {},
        run: () => {
          runs += 10
        },
      },
    ],
  }
  const engine = new RaidbossEngine([{ path: 'errors', set: set as never }], {}, timer.value, {
    changed() {},
    say() {},
    play() {},
  })
  engine.start(1, f.data, { language: 'en', audio: 'none', rules: {} })
  engine.event({ type: 'HeadMarker', fields: {} })
  engine.event({ type: 'HeadMarker', fields: {} })
  fault = true
  await timer.advance(1000)
  expect(runs).toBe(20)
  expect(engine.sharedDataWarning).toBe(true)
  expect(engine.diagnostics.find((row) => row.triggerId === 'bad')?.state).toBe('faulted')
  engine.event({ type: 'HeadMarker', fields: {} })
  await timer.advance(1000)
  expect(runs).toBe(30)
})
it('stops an unsupported timeline but leaves event rules usable and refuses lost override constraints', () => {
  const timer = clock(),
    f = fixture()
  let matched = 0
  const trigger = {
    id: 'one',
    type: 'StartsUsing',
    netRegex: { id: '6DA2', source: 'Erichthonios' },
    run: () => {
      matched++
    },
  }
  const engine = new RaidbossEngine(
    [
      {
        path: 'partial',
        set: {
          id: 'partial',
          zoneId: null,
          timeline: '0 "bad" UnavailableEvent { flags: "1" }',
          triggers: [trigger],
        } as never,
      },
    ],
    {},
    timer.value,
    { changed() {}, say() {}, play() {} },
  )
  const settings = { language: 'en' as const, audio: 'none' as const, rules: {} }
  engine.start(1, f.data, settings)
  expect(engine.diagnostics.find((row) => row.triggerId === '(timeline)')?.state).toBe('unsupported')
  engine.event({ type: 'StartsUsing', fields: { id: '6DA2', source: 'Erichthonios' } })
  expect(matched).toBe(1)
  expect(() =>
    engine.validateOverrides({
      ...settings,
      rules: { partial: { one: { matching: { type: 'StartsUsing', netRegex: { id: '6DA2' } } } } },
    }),
  ).toThrow('source')
})

it.each([19, 24, 20, 25])(
  'matches pinned upstream matching and callbacks on the complete P1N corpus from job %i',
  async (job) => {
    const { buildNetRegexForTrigger } = await import('../vendor/cactbot/resources/netregexes')
    const { default: definitions } = await import('../vendor/cactbot/resources/netlog_defs')
    const { translateRegexBuildParamAnon } = await import('../vendor/cactbot/resources/translations')
    const { UpstreamOrder } = await import('./fixtures/upstream-order')
    const timer = clock(),
      f = fixture(job)
    for (const trigger of p1n.triggers!) {
      const translated = translateRegexBuildParamAnon(trigger.netRegex as never, 'cn', p1n.timelineReplace)
        .params as Record<string, any>
      const definition = definitions[trigger.type]
      const fields: Record<string, string> = {
        timestamp: '2026-01-01T00:00:00.0000000+00:00',
        source: '埃里克特翁尼亚斯',
        sourceId: '40000001',
        target: 'Tank',
        targetId: '00000001',
        id: '0000',
        effectId: '000',
        count: '14C',
        duration: '5.5',
        castTime: '3.0',
        ability: 'Synthetic',
        effect: 'Synthetic',
      }
      for (const key of ['id', 'effectId'])
        if (translated[key]) fields[key] = Array.isArray(translated[key]) ? translated[key][0] : translated[key]
      const values = Array<string>(Math.max(...Object.values(definition.fields)) + 1).fill('0')
      for (const [key, index] of Object.entries(definition.fields)) values[index] = fields[key] ?? '0'
      values[0] = definition.type
      const line = `${values.join('|')}|synthetic-hash|`
      const regex = buildNetRegexForTrigger(trigger.type, translated as never)
      const originalMatch = regex.exec(line)
      expect(originalMatch, trigger.id).not.toBeNull()
      const modern = compileMatcher(trigger.type, trigger.netRegex, 'cn', p1n.timelineReplace).match({
        type: trigger.type,
        fields,
      })
      expect(modern && 'matches' in modern, trigger.id).toBe(true)
      if (!modern || !('matches' in modern)) throw new Error('missing match')
      const reference: unknown[] = [],
        adapted: unknown[] = []
      const output = (trace: unknown[]) => ({
        text: (_helper: unknown, text: string, level: string, duration: number) =>
          trace.push(['text', text, level, duration]),
        say: (_helper: unknown, text: string) => trace.push(['tts', text]),
        play: (_helper: unknown, path: string, volume: number | undefined) => trace.push(['sound', path, volume]),
        fault: (_trigger: unknown, error: unknown) => {
          throw error
        },
      })
      const opts = { ...f.opts, SpokenAlertsEnabled: true }
      const a = new UpstreamOrder(f.data, opts, timer.value, output(reference)),
        b = new WorkerCallbacks(f.data, opts, timer.value, output(adapted))
      a.run({ ...trigger } as unknown as ProcessedTrigger, originalMatch!.groups ?? {}, 100000)
      b.run({ ...trigger } as unknown as ProcessedTrigger, modern.matches, 100000)
      expect(adapted, trigger.id).toEqual(reference)
    }
  },
)

it('drops query results after a source reset, omits missing actors and rejects unsupported requests', async () => {
  const { queryBridge } = await import('./game')
  let resolve!: (result: unknown) => void
  const controller = new AbortController()
  const query = queryBridge(
    {
      game: {
        getCombatants: () =>
          new Promise((done) => {
            resolve = done
          }),
      },
    } as never,
    controller.signal,
  )
  const found = query({ call: 'getCombatants', ids: [1, 2], props: ['ID', 'Job'] })
  resolve({ meta, value: { entities: [{ id: 1, classJob: field(19) }], missingIds: [2] } })
  await expect(found).resolves.toEqual({ combatants: [{ ID: 1, Job: 19 }] })
  const pending = query({ call: 'getCombatants', ids: [1], props: ['ID', 'Job'] })
  controller.abort()
  resolve({ meta, value: { entities: [{ id: 1, classJob: field(19) }], missingIds: [] } })
  await expect(pending).rejects.toThrow('Stale')
  await expect(query({ call: 'PostNamazu', c: 'command' })).rejects.toThrow('Unsupported')
  await expect(query({ call: 'getCombatants', props: ['FakeField'] })).rejects.toThrow('Unsupported')
})

it('loads fixed official R1S MapEffect rules after the host interface is available', async () => {
  const { default: r1s } = await import('../vendor/cactbot/ui/raidboss/data/07-dt/raid/r1s')
  const timer = clock(),
    f = fixture()
  const engine = new RaidbossEngine([{ path: 'r1s', set: r1s as never }], {}, timer.value, {
    changed() {},
    say() {},
    play() {},
  })
  engine.start(r1s.zoneId as number, f.data, { language: 'cn', audio: 'none', rules: {} })
  const unsupported = r1s.triggers!.filter((trigger) => trigger.type === 'MapEffect')
  expect(unsupported.length).toBeGreaterThan(0)
  for (const rule of unsupported)
    expect(engine.diagnostics.find((row) => row.triggerId === rule.id)?.state).toBe('ready')
  expect(engine.diagnostics.some((row) => row.state === 'ready')).toBe(true)
  expect(engine.sharedDataWarning).toBe(false)
})

it('ignores late promise rejection after the generation reset', async () => {
  const timer = clock(),
    f = fixture(),
    trace: string[] = []
  let reject!: (error: unknown) => void
  const callbacks = new WorkerCallbacks(f.data, f.opts, timer.value, {
    text() {},
    say() {},
    play() {},
    fault: () => trace.push('obsolete fault'),
  })
  callbacks.run(
    {
      id: 'late',
      promise: () =>
        new Promise<void>((_resolve, fail) => {
          reject = fail
        }),
    },
    {},
    100000,
  )
  callbacks.reset()
  reject(new Error('old source'))
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
  expect(trace).toEqual([])
})
