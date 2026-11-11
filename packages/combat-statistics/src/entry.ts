import { periodicDefs } from '@ffcafe/mojito-combat-model/defs'
import type {
  CombatantState,
  Disposer,
  GameTopics,
  Json,
  PluginContext,
  Sample,
  SessionSnapshot,
  Subscription,
  Value,
} from '@ffcafe/mojito-plugin-sdk'
import { CombatEngineRunner, MODEL_INPUTS } from './combat-engine.js'
import type { GameEvent } from './combat-events.js'
import { compatibility } from './compatibility.js'
import { displaySummary } from './display.js'
import { dutyName } from './duty.js'
import { type ChangedEncounter, Encounters } from './encounters.js'
import { GameDataCache } from './game-cache.js'
import { Identities, isCharacterEntity, value } from './identity.js'
import { jobIcon } from './jobs.js'
import { CombatLog, PAGE_SIZE, type VisitEntry } from './log/index.js'
import { type ReplayObservers, replay } from './log/replay.js'
import { type Summary, settings, sourceKey } from './model.js'
import { provideOverlayService } from './overlay-service.js'
import { Presentation } from './presentation.js'
import { complete, type GameData, type PartialReplay, ReplayBuilder } from './replay/builder.js'
import { resolveSelection } from './selection.js'
import {
  type ReplayResult,
  type Selection,
  type StatisticsState,
  skillId,
  type VisitsState,
  type VisitView,
} from './view-model.js'
import { DEFAULT_QUERY, matchVisit, parseQuery, type VisitQuery } from './visit-filter.js'

/** Recomputed visits kept in memory */
const REPLAYS = 3
/** The CooldownGroup of the global cooldown */
const GLOBAL_COOLDOWN = 58
/** Shortest gap between two event-driven publications; moments the user waits for publish at once. */
export const PUBLISH_MS = 200
/** The events only the combat model reads */
const MODEL_ONLY = new Set<string>([
  'statusSlotsChanged',
  'actorProfileChanged',
  'overTimeTick',
  'jobGaugeChanged',
  'playerStatsChanged',
])
/**
 * The events of the main subscription only the log takes, for the fight review; the model reads the casts and the
 * status lists too, so they come in the order of the other events
 */
/** Who used the limit breaks of a fight, by actor key, for the review */
const limitBreakCasters = (summary: Summary | undefined): Record<string, string | null> =>
  Object.fromEntries(
    Object.entries(summary?.rows.find((row) => row.actor.kind === 'limitBreak')?.casters ?? {}).map(([key, caster]) => [
      key,
      caster.name,
    ]),
  )
const LOG_ONLY = new Set<string>(['statusesReplaced', 'castStarted', 'castCancelled', 'potencySample'])

export async function activate(ctx: PluginContext) {
  let queue = Promise.resolve(),
    stopped = false,
    serial = 0
  const enqueue = <T>(task: () => Promise<T> | T): Promise<T> => {
    const next = queue.then(task)
    queue = next.then(
      () => {},
      (error) => {
        ctx.log.error('统计操作失败', { error: String(error) })
      },
    )
    return next
  }
  const disposers: Disposer[] = []
  const producer = await provideOverlayService(ctx, enqueue, async (id) => {
    const result = encounters.end(id, ctx.clock.now() ?? 0)
    log.recorder.flushBoundaries()
    await flushLog()
    await publishNow()
    timer()
    return result
  })
  disposers.push(producer.dispose)
  let latest: ChangedEncounter | null = null,
    compatibilityLatest: ChangedEncounter | null = null,
    session: SessionSnapshot | null = null
  let identities: Identities | null = null,
    subscription: Subscription | null = null,
    cancelTimer: Disposer | null = null
  let timerGeneration = 0,
    eventGeneration = 0
  let primary: { id: number; name: string } | null = null,
    inCombat: boolean | null = null
  let partySub: Subscription | null = null,
    playerSub: Subscription | null = null,
    entitiesSub: Subscription | null = null,
    zoneSub: Subscription | null = null
  let entityIds = new Set<number>(),
    partyKnown = false
  let members = new Set<number>(),
    party: { id: number; ownParty: boolean }[] = [],
    inputError: string | null = null
  /** The inputs that do not work, with the reason written to the plugin log; any of them pauses the statistics */
  const unavailable = new Map<string, string>()
  let paused = false,
    /** Whether this pause was reported; connecting pauses briefly every time, so only a lasting pause is */
    pauseNotified = false,
    retryTimer: ReturnType<typeof setInterval> | null = null
  const gameCache = new GameDataCache(ctx.storage, ctx.data, ctx.log, {
    rowIds: ctx.limits.values['data.rowIds'] ?? Number.POSITIVE_INFINITY,
    fileBytes: ctx.limits.values['storage.fileBytes'] ?? 3 * 1024 * 1024,
  })
  /** The duty name of each territory, null for one without a duty */
  const dutyNames = new Map<number, string | null>()
  const jobNames = new Map<number, string | null>()
  const jobAbbreviations = new Map<number, string>()
  // Following shows the current fight; otherwise the overview stays on the pinned one.
  let following = true,
    pinned: Selection | null = null,
    lastVisits: string | null = null
  // The visit list the page shows; not kept in the settings, so every activation starts on the newest visits.
  let query: VisitQuery = DEFAULT_QUERY,
    page = 0,
    reading = false,
    /** Changes whenever the query or page does, so a running fillPage leaves the rest to the next one */
    fillRun = 0,
    /** Counts visit publications, so one that awaited names does not overwrite a newer one */
    visitsRun = 0
  const replays = new Map<string, Map<string, Summary>>()
  const visitStatus = new Map<string, { loading: true } | { loading: false; error: string }>()
  /** The review data of the last fight the page asked for; a failure is not kept, so asking again retries */
  let review: { visitId: string; fightId: string; data: ReplayResult } | null = null
  /** Visits the overview is reading; a review of the same visit waits for that read instead of reading it again */
  const loads = new Map<string, Promise<void>>()
  /** The review data of the ended fight whose visit the overview read last, collected during that same read */
  let prepared: { visitId: string; fightId: string; partial: PartialReplay } | null = null
  let positionSub: Subscription | null = null,
    reviewSub: Subscription | null = null,
    sceneSub: Subscription | null = null,
    /** The combat model of the current subscription; null while it is unavailable */
    runner: CombatEngineRunner | null = null,
    runnerGeneration = 0,
    logTimer: ReturnType<typeof setInterval> | null = null,
    logPending = false,
    notifiedLogError: string | null = null
  const log = new CombatLog(ctx.storage, ctx.limits, {
    createdBy: `mojito-combat-statistics ${ctx.identity.version}`,
    log: ctx.log,
    actors: () => identities?.actors ?? new Map(),
    names: { zone: (id) => gameCache.cached('territoryType', id), job: (id) => jobNames.get(id) ?? null },
    brief: ({ outcome: { result, mainEnemy } }) => ({
      result,
      mainEnemy: mainEnemy && {
        name: mainEnemy.name,
        hpCur: mainEnemy.hpCur,
        hpMax: mainEnemy.hpMax,
        hpPercent: mainEnemy.hpPercent,
      },
    }),
    positions: (ids) => {
      positionSub?.dispose()
      positionSub = null
      if (!ids) return
      const sub = ctx.game.subscribe(
        'entities',
        (batch) =>
          enqueue(() => {
            if (positionSub !== sub) return
            for (const sample of batch.items)
              if (sourceKey(sample.meta) === identities?.source) log.recorder.positions(sample)
          }),
        { ids, fields: ['objectKind', 'position', 'rotation', 'hpCur', 'hpMax'], intervalMs: 250 },
      )
      positionSub = sub
      void sub.ready.catch((error) => ctx.log.warn('位置订阅失败', { error: String(error) }))
    },
  })
  try {
    await log.open()
  } catch (error) {
    ctx.log.warn('战斗日志读取失败', { error: String(error) })
  }
  await gameCache.load()
  await removeOldHistory()
  const terminalFrames: Summary[] = []
  let lastCombatFrame: string | null = null
  const presentation = new Presentation()
  let displayTimer: ReturnType<typeof setInterval> | null = null,
    displayPending = false
  let publishTimer: ReturnType<typeof setTimeout> | null = null,
    publishPending = false,
    publishCombat = false,
    lastPublishAt = -Infinity
  const encounters = new Encounters(
    () =>
      `enc-${Date.now().toString(36)}-${ctx.identity.activationId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32)}-${++serial}`,
    (changed, revision) => {
      if (changed.ended && !revision) {
        // The frame of an ended fight shows it as it ended, before any later revision.
        const summary = changed.summary()
        terminalFrames.push(summary)
        changed = { ...changed, summary: () => summary }
      }
      if (!revision || latest?.id === changed.id) latest = changed
      if (!revision || !changed.ended) compatibilityLatest = changed
    },
    {
      started: (info) => log.recorder.fightStarted(info),
      ended: (info) => {
        log.recorder.fightEnded(info)
        logPending = true
      },
    },
  )
  try {
    const saved = await ctx.config.get('settings')
    if (saved !== null) encounters.config = settings(saved)
  } catch (error) {
    inputError = `设置读取失败：${String(error)}`
  }
  log.recorder.settings(encounters.config)
  const allPlayers = () => encounters.config.scope === 'all'
  function scopeMembers() {
    members = new Set(
      party.filter((member) => encounters.config.scope !== 'party' || member.ownParty).map((member) => member.id),
    )
    if (encounters.localActorId !== null) members.add(encounters.localActorId)
    if (primary) members.add(primary.id)
  }
  function displayTimerState() {
    const needed = !stopped && encounters.active !== null && inCombat !== false && ctx.clock.now() !== null
    if (!needed && displayTimer !== null) {
      clearInterval(displayTimer)
      displayTimer = null
    }
    if (!needed || displayTimer !== null) return
    displayTimer = setInterval(() => {
      if (displayPending || stopped) return
      const active = encounters.active
      if (!active) return
      displayPending = true
      void enqueue(async () => {
        if (stopped || encounters.active?.id !== active.id || encounters.active.source !== active.source) return
        const now = ctx.clock.now()
        if (now !== null && !ctx.clock.state().paused) encounters.advance(now)
        log.recorder.flushBoundaries()
        await flushLog()
        // The scheduled publication is due shortly and shows the advanced state as well.
        if (!publishPending) await publish(true, true)
      })
        .catch(() => {}) // enqueue records the error; a refresh must not become an unhandled rejection.
        .finally(() => {
          displayPending = false
        })
    }, 1000)
  }
  /** The language of the game data the plugin may read, null while there is none */
  const readableLanguage = (snapshot: SessionSnapshot | null) =>
    snapshot?.dataLanguage && ctx.capabilities.get()['data.read']?.state === 'available' ? snapshot.dataLanguage : null
  /** Job names for the combat log's member list; a failed lookup is remembered as unknown. */
  async function lookupJobs(entities: CombatantState[]) {
    const language = session?.dataLanguage
    if (!language || ctx.capabilities.get()['data.read']?.state !== 'available') return
    const ids = [
      ...new Set(entities.map((entity) => value(entity.classJob)).filter((id): id is number => id !== null)),
    ].filter((id) => !jobNames.has(id))
    if (!ids.length) return
    try {
      for (const row of await ctx.data.rows('ClassJob', ids, language)) {
        // Name and Abbreviation are the first two columns.
        const [name, abbreviation] = row.subrows[0]?.cells ?? []
        jobNames.set(row.rowId, name?.type === 'string' && name.value ? name.value : null)
        if (abbreviation?.type === 'string' && abbreviation.value) jobAbbreviations.set(row.rowId, abbreviation.value)
      }
    } catch {
      /* Missing game data only leaves the job name empty in the log. */
    }
    for (const id of ids) if (!jobNames.has(id)) jobNames.set(id, null)
  }
  /** Writes the combat log right after a fight or visit ends; the ten-second timer covers the rest. */
  async function flushLog() {
    if (!logPending) return
    logPending = false
    await log.flush()
    checkLogError()
  }
  /** A host older than Plugin API 1.6.0 and a stopping plugin both reject the notification; statistics go on without it. */
  function notify(title: string, detail: string) {
    void ctx.notifications
      .send({ title, detail })
      .catch((error) => ctx.log.debug('发送通知失败', { error: String(error) }))
  }
  /** Reports a log error once, until a write succeeds or the error changes. */
  function checkLogError() {
    const { error } = log.status()
    if (error && error !== notifiedLogError) notify('战斗日志没有保存', error)
    notifiedLogError = error
  }
  /** Flushes the combat log every ten seconds while a visit is being written. */
  function logTimerState() {
    const needed = !stopped && log.recorder.visiting
    if (!needed && logTimer !== null) {
      clearInterval(logTimer)
      logTimer = null
    }
    if (!needed || logTimer !== null) return
    logTimer = setInterval(() => {
      void enqueue(async () => {
        if (stopped) return
        log.recorder.tick(ctx.clock.now())
        await log.flush()
        checkLogError()
      }).catch(() => {}) // enqueue records the error.
    }, 10_000)
  }
  /** Marks the views as changed; they are published within PUBLISH_MS of the previous publication. */
  function schedulePublish(includeCombat = true) {
    publishPending = true
    publishCombat ||= includeCombat
    if (publishTimer !== null || stopped) return
    publishTimer = setTimeout(
      () => {
        publishTimer = null
        void enqueue(async () => {
          if (!stopped && publishPending) await publish(false)
        }).catch(() => {}) // enqueue records the error.
      },
      Math.max(0, lastPublishAt + PUBLISH_MS - Date.now()),
    )
  }
  /** Publishes and waits until the host has the views, for moments the user is waiting for. */
  async function publishNow(includeCombat = true) {
    await publish(includeCombat)
    await ctx.views.flush()
  }
  async function publish(includeCombat = true, displayTick = false) {
    if (publishTimer !== null) clearTimeout(publishTimer)
    publishTimer = null
    includeCombat ||= publishCombat
    publishPending = publishCombat = false
    lastPublishAt = Date.now()
    const terminals = terminalFrames.splice(0)
    for (const terminal of terminals) await publishFrame(true, terminal)
    await publishFrame(includeCombat, undefined, displayTick && terminals.length === 0)
  }
  async function publishFrame(includeCombat: boolean, terminal?: Summary, displayTick = false) {
    if (stopped) return
    displayTimerState()
    logTimerState()
    const facts = displaySummary(
      terminal ?? encounters.snapshot(undefined, false) ?? latest?.summary() ?? null,
      encounters.config.mergePets,
    )
    const projected = terminal
      ? { summary: facts, changed: true }
      : presentation.project(
          facts,
          encounters.presentationAnchor(),
          { now: ctx.clock.now(), paused: ctx.clock.state().paused },
          inCombat,
        )
    if (displayTick && !projected.changed) return
    const current = projected.summary
    const visits = fightVisits()
    const activeFightId = encounters.active?.id ?? null
    const selection = resolveSelection(visits, activeFightId, following, pinned)
    // The visit list only changes at fight and visit boundaries, which never come from a display tick.
    if (!displayTick) await publishVisits(visits, selection)
    const shown = selectedSummary(selection, current)
    const selected = displaySummary(shown.summary, encounters.config.mergePets)
    const state: StatisticsState = {
      current,
      activeFightId,
      following,
      selection,
      selected,
      loading: shown.loading,
      loadError: shown.error,
      names: await names(selected),
      settings: encounters.config,
      inputError,
      paused,
      inCombat,
    }
    ctx.views.set('statistics', state as unknown as Value)
    if (includeCombat) {
      const summary =
        terminal || encounters.active
          ? current
          : displaySummary(compatibilityLatest?.summary() ?? null, encounters.config.mergePets)
      const zoneId = encounters.zone
      if (zoneId !== null) await gameCache.name('territoryType', zoneId)
      for (const row of summary?.rows ?? [])
        for (const maximum of [row.maxHit, row.maxHeal]) if (maximum) await gameCache.name('action', maximum.actionId)
      const frame = compatibility(
        summary,
        primary,
        zoneId === null ? null : { id: zoneId, name: gameCache.cached('territoryType', zoneId) },
        session?.dataLanguage ?? null,
        inCombat,
        { actions: gameCache.all('action') },
      )
      const serialized = JSON.stringify(frame)
      if (serialized !== lastCombatFrame) {
        await producer.publish(frame)
        lastCombatFrame = serialized
      }
    }
  }
  /** The visits with a fight, newest first; the current visit is listed once its first fight starts. */
  const fightVisits = () => log.list().filter((entry) => entry.fights.length > 0)
  /** The name a visit is listed by: the duty held in its territory, otherwise the territory's place name. */
  async function visitName(territoryType: number, logged: string | null) {
    const language = session?.dataLanguage
    if (!dutyNames.has(territoryType) && language && ctx.capabilities.get()['data.read']?.state === 'available')
      dutyNames.set(territoryType, await dutyName(ctx.data, territoryType, language))
    const duty = dutyNames.get(territoryType)
    if (duty) return duty
    if (!logged) await gameCache.name('territoryType', territoryType)
    return logged ?? gameCache.cached('territoryType', territoryType)
  }
  async function visitView(entry: VisitEntry, name?: string | null): Promise<VisitView> {
    const status = visitStatus.get(entry.id)
    const error = status?.loading === false ? status.error : entry.integrity === 'failed' ? entry.error : null
    return {
      id: entry.id,
      territoryType: entry.territoryType,
      zoneName: name === undefined ? await visitName(entry.territoryType, entry.zoneName) : name,
      enteredAt: entry.enteredAt,
      leftAt: entry.leftAt,
      current: entry.current,
      status: status?.loading ? 'loading' : error !== null ? 'failed' : 'ok',
      error,
      fights: entry.fights,
    }
  }
  /** The visits that match the query, with the names they are listed by */
  async function matchingVisits(all: VisitEntry[]) {
    const currentActorId = session?.character?.actorId ?? null
    const matched: { entry: VisitEntry; name: string | null | undefined }[] = []
    for (const entry of all) {
      // Only a duty query needs the name of every visit; the others are named when shown.
      const name = query.duty ? await visitName(entry.territoryType, entry.zoneName) : undefined
      if (matchVisit(entry, name ?? null, query, currentActorId)) matched.push({ entry, name })
    }
    return matched
  }
  /** Publishes the page of visits when it changed. */
  async function publishVisits(
    all = fightVisits(),
    selection = resolveSelection(all, encounters.active?.id ?? null, following, pinned),
  ) {
    const run = ++visitsRun
    const matched = await matchingVisits(all)
    const visits: VisitView[] = []
    for (const { entry, name } of matched.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE))
      visits.push(await visitView(entry, name))
    const selectedEntry = selection && all.find((entry) => entry.id === selection.visitId)
    const state: VisitsState = {
      visits,
      query,
      page,
      hasPrevious: page > 0,
      hasNext: matched.length > (page + 1) * PAGE_SIZE,
      reading,
      selected: selectedEntry ? await visitView(selectedEntry) : null,
    }
    if (run !== visitsRun || stopped) return
    const serialized = JSON.stringify(state)
    if (serialized !== lastVisits) {
      lastVisits = serialized
      ctx.views.set('visits', state as unknown as Value)
    }
  }
  /**
   * Reads older log files until the page and the first visit of the next one are found or the log is read through,
   * publishing after each file. It runs outside the queue, so the statistics do not wait for the files.
   */
  async function fillPage() {
    const run = ++fillRun
    try {
      while (run === fillRun && !stopped) {
        if ((await matchingVisits(fightVisits())).length > (page + 1) * PAGE_SIZE) break
        if (run !== fillRun) return
        reading = true
        await publishVisits()
        const more = await log.readOlder()
        if (run !== fillRun) return
        await publishVisits()
        if (!more) break
      }
    } catch (error) {
      ctx.log.warn('读取更早的日志失败', { error: String(error) })
    }
    if (run !== fillRun || stopped) return
    reading = false
    await publishVisits()
    await ctx.views.flush()
  }
  /**
   * The summary of the selected fight: from memory while this activation still holds the fight, otherwise recomputed
   * from the log of its visit, which is queued here and published again when done.
   */
  function selectedSummary(selection: Selection | null, current: Summary | null) {
    const none = { summary: null, loading: false, error: null }
    if (!selection) return none
    if (selection.fightId === encounters.active?.id) return { ...none, summary: current }
    const live = encounters.completed.find((encounter) => encounter.id === selection.fightId)
    if (live) return { ...none, summary: encounters.snapshot(live, false) }
    const replayed = replays.get(selection.visitId)
    if (replayed) {
      // Keep the most recently viewed visits.
      replays.delete(selection.visitId)
      replays.set(selection.visitId, replayed)
      const summary = replayed.get(selection.fightId) ?? null
      return { ...none, summary, error: summary ? null : '日志中没有这场战斗的完整记录' }
    }
    const status = visitStatus.get(selection.visitId)
    if (status?.loading === false) return { ...none, error: status.error }
    if (!status) {
      const { visitId, fightId } = selection
      visitStatus.set(visitId, { loading: true })
      const task = enqueue(() => load(visitId, fightId))
      loads.set(visitId, task)
      void task
        .catch(() => {}) // enqueue records the error.
        .then(() => {
          if (loads.get(visitId) === task) loads.delete(visitId)
        })
    }
    return { ...none, loading: true }
  }
  /** An ended fight of the log, or null */
  function endedFight(visitId: string, fightId: string) {
    const fight = log
      .list()
      .find((visit) => visit.id === visitId)
      ?.fights.find((item) => item.id === fightId)
    return fight && fight.endAt !== null ? { ...fight, endAt: fight.endAt } : null
  }
  /** Replays a visit, counting its records; with a builder the same pass collects the review data of its fight. */
  async function replayVisit(visitId: string, builder: ReplayBuilder | null) {
    let records = 0
    const observers: ReplayObservers = {
      record(record, state) {
        records++
        builder?.record(record, state)
      },
      ...(builder ? { ledger: (fightId: string, entry) => builder.ledger(fightId, entry) } : {}),
    }
    const started = Date.now()
    const summaries = await replay(log.read(visitId), observers)
    return { summaries, records, ms: Date.now() - started }
  }
  /** Reads a visit for the overview; when the selected fight has ended, its review is collected on the way. */
  async function load(visitId: string, fightId: string) {
    if (stopped || visitStatus.get(visitId)?.loading !== true) return
    try {
      const fight = endedFight(visitId, fightId)
      const builder = fight ? new ReplayBuilder(fightId, { visitId, startAt: fight.startAt, endAt: fight.endAt }) : null
      const { summaries, records, ms } = await replayVisit(visitId, builder)
      ctx.log.debug('读取进本日志', { visitId, records, ms })
      replays.set(visitId, new Map(summaries.map((summary) => [summary.id, summary])))
      for (const old of [...replays.keys()].slice(0, -REPLAYS)) replays.delete(old)
      visitStatus.delete(visitId)
      if (builder) {
        const summary = summaries.find((item) => item.id === fightId)
        prepared = {
          visitId,
          fightId,
          partial: builder.finish(summary?.outcome.mainEnemy?.key ?? null, limitBreakCasters(summary)),
        }
      }
    } catch (error) {
      visitStatus.set(visitId, { loading: false, error: error instanceof Error ? error.message : String(error) })
    }
    await publishNow(false)
  }
  /** Skill names of the summary and the abbreviations of its jobs */
  async function names(summary: Summary | null) {
    const result: Record<string, string> = {}
    for (const row of summary?.rows ?? []) {
      if (row.actor.job !== null) {
        const abbreviation = jobAbbreviations.get(row.actor.job)
        if (abbreviation) result[`job:${row.actor.job}`] = abbreviation
      }
      for (const key of Object.keys(row.skills)) {
        const skill = skillId(key)
        if (!skill) continue
        const { name } = await gameCache.name(skill.kind, skill.id)
        if (name) result[key] = name
      }
    }
    return result
  }
  /**
   * Reads an icon for the page; an icon that cannot be read is not asked for again. While no game data is open an
   * icon the cache lacks fails instead, so the page asks again once it is.
   */
  async function icon(key: string) {
    if (ctx.capabilities.get()['data.read']?.state !== 'available') return null
    const job = /^job:(\d+)$/.exec(key)
    const skill = skillId(key)
    let id: number | null = null
    if (job) id = jobIcon(Number(job[1]))
    else if (skill) id = await gameCache.iconId(`${skill.kind}:${skill.id}`)
    return id === null ? null : gameCache.icon(id)
  }
  /** The names and columns of a review; incomplete when some of the game data could not be read. */
  async function gameData(actionIds: number[], statusIds: number[]) {
    let complete = true
    const names = async (kind: 'action' | 'status', ids: number[]) => {
      const result = new Map<number, string>()
      for (const id of ids) {
        const read = await gameCache.name(kind, id)
        if (!read.complete) complete = false
        if (read.name) result.set(id, read.name)
      }
      return result
    }
    const actions = await names('action', actionIds)
    const statuses = await names('status', statusIds)
    const groups = await gameCache.columns('cooldownGroup', actionIds)
    const categories = await gameCache.columns('statusCategory', statusIds)
    const data: GameData = {
      action: (id) => actions.get(id) ?? null,
      status: (id) => statuses.get(id) ?? null,
      gcd: (id) => (groups.values.has(id) ? groups.values.get(id) === GLOBAL_COOLDOWN : null),
      category: (id) => {
        // StatusCategory is 1 for a buff, 2 for a debuff
        const category = categories.values.get(id)
        return category === 1 ? 'buff' : category === 2 ? 'debuff' : null
      },
    }
    return { data, complete: complete && groups.complete && categories.complete }
  }
  /** Replays the visit of an ended fight from the log into the data of its review. */
  async function replayData(visitId: string, fightId: string): Promise<ReplayResult> {
    // The game may have been updated since the session last changed.
    await gameCache.validate(readableLanguage(session))
    if (review?.visitId === visitId && review.fightId === fightId) return review.data
    const started = Date.now()
    // Its failure is the overview's to show; the review then reads the visit itself.
    await loads.get(visitId)?.catch(() => {})
    const fight = endedFight(visitId, fightId)
    if (!fight) return { ok: false, reason: '日志中找不到这场战斗' }
    try {
      const reused = prepared?.visitId === visitId && prepared.fightId === fightId ? prepared.partial : null
      let partial = reused
      if (!partial) {
        const builder = new ReplayBuilder(fightId, { visitId, startAt: fight.startAt, endAt: fight.endAt })
        const { summaries } = await replayVisit(visitId, builder)
        const summary = summaries.find((item) => item.id === fightId)
        partial = builder.finish(summary?.outcome.mainEnemy?.key ?? null, limitBreakCasters(summary))
      }
      const replayMs = Date.now() - started
      const game = await gameData(partial.actionIds, partial.statusIds)
      ctx.log.debug('读取战斗回顾', {
        visitId,
        fightId,
        replayMs,
        gameDataMs: Date.now() - started - replayMs,
        reused: reused !== null,
      })
      const data: ReplayResult = { ok: true, data: complete(partial, game.data) }
      // A review read without game data is still shown, but built again once the data can be read.
      if (game.complete) review = { visitId, fightId, data }
      return data
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : String(error) }
    }
  }
  /** Drops the summaries of the old history store, which the combat log replaced; they are not migrated. */
  async function removeOldHistory() {
    try {
      for (const name of await ctx.storage.list('history')) await ctx.storage.delete(name)
    } catch (error) {
      if ((error as { code?: string }).code !== 'not_found')
        ctx.log.warn('旧历史记录删除失败', { error: String(error) })
    }
  }
  function timer() {
    cancelTimer?.()
    cancelTimer = null
    const generation = ++timerGeneration
    const source = encounters.source,
      id = encounters.active?.id
    if (ctx.clock.state().paused) return
    const deadline = encounters.deadline(),
      now = ctx.clock.now()
    if (deadline !== null && now !== null)
      cancelTimer = ctx.clock.setTimeout(
        () =>
          enqueue(async () => {
            if (
              stopped ||
              generation !== timerGeneration ||
              encounters.source !== source ||
              encounters.active?.id !== id ||
              encounters.deadline() !== deadline
            )
              return
            const current = ctx.clock.now()
            if (current !== null && !ctx.clock.state().paused) encounters.advance(current)
            log.recorder.flushBoundaries()
            await flushLog()
            await publishNow()
            timer()
          }),
        Math.max(0, deadline - now),
      )
  }
  async function actorInputs(items: Sample<GameEvent>[]) {
    if (!members.size || encounters.localActorId === null) {
      // Packet-only replays can learn the player after activation. State watches
      // are coalesced, so read the current observation before classifying facts.
      const player = await ctx.game.getPlayer({ fields: ['actorId', 'name'] })
      if (
        `${player.meta.sessionId}:${player.meta.characterGeneration}:${player.meta.clockGeneration}` ===
        identities?.source
      ) {
        log.recorder.player('get', player.value, player.meta.observedAt)
        const id = value(player.value.actorId),
          name = value(player.value.name)
        if (id !== null && (encounters.localActorId === null || encounters.localActorId === id)) {
          encounters.localActorId = id
          members.add(id)
          if (name !== null) primary = { id, name }
        }
      }
    }
    const ids = new Set(members)
    for (const { value: event } of items) {
      if (event.type === 'actionEffect') {
        if (event.data.sourceActorId !== null) ids.add(event.data.sourceActorId)
        for (const target of event.data.targets) if (target.targetId !== null) ids.add(target.targetId)
      }
      if (event.type === 'actorDied' && event.data.actorId !== null) ids.add(event.data.actorId)
      if (event.type === 'periodicTick' || event.type === 'periodicRevision')
        for (const tick of event.type === 'periodicTick' ? [event.data] : event.data.ticks) {
          if (tick.target !== null) ids.add(tick.target)
          for (const share of tick.shares) if (share.sourceId !== null) ids.add(share.sourceId)
        }
      const found: (number | null)[] = []
      if (event.type === 'damageAttributed') {
        const { attackerId, actorId, targetId, contributions } = event.data
        found.push(attackerId, actorId, targetId, ...contributions.map((part) => part.sourceId))
      }
      if (event.type === 'attributionRevision')
        for (const record of event.data.records)
          found.push(record.actorId, ...record.contributions.map((part) => part.sourceId))
      for (const id of found) if (id !== null) ids.add(id)
    }
    const fields = ['name', 'homeWorldId', 'classJob', 'ownerId', 'objectKind', 'subKind', 'bNpcBase'] as const
    if (ids.size) {
      const result = await ctx.game.getCombatants({ ids: [...ids], fields: [...fields] })
      if (
        !identities ||
        `${result.meta.sessionId}:${result.meta.characterGeneration}:${result.meta.clockGeneration}` !==
          identities.source
      )
        return
      const characters = result.value.entities.filter(isCharacterEntity)
      const missing = [
        ...result.value.missingIds,
        ...result.value.entities.filter((entity) => !isCharacterEntity(entity)).map((entity) => entity.id),
      ]
      identities.update(characters, missing, members, allPlayers())
      await lookupJobs(characters)
      log.recorder.identities(
        'combatants',
        characters,
        missing,
        members,
        encounters.config.scope,
        result.meta.observedAt,
      )
    }
    if (identities) {
      encounters.updateActors(identities.actors, identities.revision)
      const own =
        session?.character?.actorId === null || session?.character?.actorId === undefined
          ? null
          : identities.actors.get(session.character.actorId)
      if (own?.name) primary = { id: own.id, name: own.name }
    }
  }
  async function receive(items: Sample<GameEvent>[]) {
    if (stopped || paused) return
    try {
      await actorInputs(items)
    } catch (error) {
      // Events whose actors are unknown cannot be counted, so the batch is dropped.
      unavailable.set('reads', String(error))
      await updatePause()
      return
    }
    // A replay hands out events ahead of their acknowledgement, so the clock may already be past events still to come.
    const replay = ctx.clock.state().source === 'replay'
    for (const item of items) {
      if (`${item.meta.sessionId}:${item.meta.characterGeneration}:${item.meta.clockGeneration}` !== identities?.source)
        continue
      if (LOG_ONLY.has(item.value.type)) {
        log.recorder.event(item)
        continue
      }
      const at = item.meta.observedAt,
        now = ctx.clock.now() ?? at
      encounters.accept(item, replay ? Math.min(now, at) : now)
      log.recorder.event(item)
      inCombat = encounters.inCombat
      if (terminalFrames.length) {
        await flushLog()
        for (const terminal of terminalFrames.splice(0)) await publishFrame(true, terminal)
      }
    }
    log.recorder.flushBoundaries()
    await flushLog()
    // Until templates prove post updates do not repeat history, revise authoritative history only.
    schedulePublish(
      items.some((item) => item.value.type !== 'periodicRevision' && item.value.type !== 'attributionRevision'),
    )
    timer()
  }
  /**
   * Hands the events to the combat model, also while the statistics are paused so that it keeps the state of the game,
   * and the events and the results that follow each of them to receive
   */
  async function receiveInputs(items: Sample<GameEvent>[]) {
    const current = runner
    const events: Sample<GameEvent>[] = []
    for (const item of items) {
      if (!MODEL_ONLY.has(item.value.type)) events.push(item)
      if (!current || runner !== current) continue
      try {
        events.push(...current.receive(item))
      } catch (error) {
        ctx.log.error('战斗模型处理事件失败', { error: String(error), event: item.value.type })
        current.dispose()
        runner = null
        unavailable.set('model', String(error))
      }
    }
    if (!runner && current) await updatePause()
    await receive(events)
  }
  /** Starts a combat model for the subscription; it is unavailable when the data is for another opcode version */
  async function startModel(generation: number) {
    runner?.dispose()
    runner = null
    if (session?.opcodeVersion !== periodicDefs.version) {
      unavailable.set(
        'model',
        `状态数据对应的解析版本是 ${periodicDefs.version}，当前解析版本是 ${session?.opcodeVersion ?? '无'}`,
      )
      return false
    }
    const next = new CombatEngineRunner({
      defs: periodicDefs,
      previousGeneration: runnerGeneration,
      now: () => ctx.clock.now(),
      setTimeout: (callback, ms) => ctx.clock.setTimeout(callback, ms),
      drained: (results) =>
        void enqueue(() => (generation === eventGeneration && runner === next ? receive(results) : undefined)),
      timing: (fields) => ctx.log.debug('combat-model timing', fields),
    })
    runnerGeneration = next.generation
    try {
      const fields = ['classJob', 'level', 'ownerId', 'statuses'] as const
      next.reset((await ctx.game.getCombatants({ fields: [...fields] })).value.entities)
    } catch (error) {
      // The actors come again with their next changes
      ctx.log.debug('读取角色失败，战斗模型从空白开始', { error: String(error) })
    }
    runner = next
    unavailable.delete('model')
    return true
  }
  async function subscribeEvents() {
    if (!session || session.state === 'idle' || subscription || stopped) return
    const generation = ++eventGeneration
    if (!(await startModel(generation))) return
    const receiveCurrent = (items: Sample<GameEvent>[]) =>
      generation === eventGeneration ? receiveInputs(items) : undefined
    // HP shares the subscription of actionEffect to keep their order, and so do the inputs of the combat model: a host
    // without them gives unavailable, which pauses the statistics.
    const sub = ctx.events.subscribe(['hpChanged', 'playerCombatChanged', ...MODEL_INPUTS], (batch) =>
      enqueue(() => receiveCurrent(batch.items)),
    )
    try {
      await sub.ready
    } catch (error) {
      sub.dispose()
      unavailable.set('events', String(error))
      return
    }
    subscription = sub
    unavailable.delete('events')
    reviewSub?.dispose()
    subscribeReview()
    sceneSub?.dispose()
    subscribeScene()
    void sub.closed.then((result) => {
      if (subscription !== sub || stopped) return
      subscription = null
      runner?.dispose()
      runner = null
      void enqueue(async () => {
        if (stopped || generation !== eventGeneration) return
        encounters.boundary(result.reason, ctx.clock.now() ?? 0)
        log.recorder.flushBoundaries()
        inCombat = null
        await flushLog()
        unavailable.set('events', `输入中断：${result.reason}`)
        await subscribeEvents()
        await updatePause()
        await publishNow()
        timer()
      })
    })
  }
  /** Casts and statuses only feed the combat log for fight review, so they use their own subscription. */
  /** Apart from the inputs of the statistics: without these events a host only leaves them out of the log */
  function subscribeScene() {
    const generation = eventGeneration
    const scene = ctx.events.subscribe(['targetableChanged', 'cutsceneChanged'], (batch) =>
      enqueue(() => {
        if (generation !== eventGeneration || sceneSub !== scene || paused) return
        for (const item of batch.items) if (sourceKey(item.meta) === identities?.source) log.recorder.event(item)
      }),
    )
    sceneSub = scene
    void scene.ready.catch((error) => ctx.log.warn('可选中状态和过场动画订阅失败', { error: String(error) }))
  }
  function subscribeReview() {
    const generation = eventGeneration
    const review = ctx.events.subscribe(['statusChanged'], (batch) =>
      enqueue(() => {
        if (generation !== eventGeneration || reviewSub !== review || paused) return
        for (const item of batch.items) if (sourceKey(item.meta) === identities?.source) log.recorder.event(item)
      }),
    )
    reviewSub = review
    watchInput(
      'review',
      review,
      () => reviewSub,
      () => {
        reviewSub = null
      },
    )
  }
  /**
   * Keeps the input key unavailable while the subscription fails or after the host closes it. current gives the
   * subscription the plugin holds now, so one it replaced or disposed itself is ignored; drop lets the retry create it
   * again.
   */
  function watchInput(key: string, sub: Subscription, current: () => Subscription | null, drop: () => void) {
    void sub.ready.then(
      () =>
        enqueue(async () => {
          if (current() === sub && unavailable.delete(key)) await updatePause()
        }),
      (error) =>
        enqueue(async () => {
          if (current() !== sub || stopped) return
          sub.dispose()
          drop()
          unavailable.set(key, String(error))
          await updatePause()
        }),
    )
    void sub.closed.then((result) =>
      enqueue(async () => {
        if (current() !== sub || stopped) return
        drop()
        unavailable.set(key, `输入中断：${result.reason}`)
        await updatePause()
      }),
    )
  }
  /** Pauses the statistics while an input is unavailable; the fight in progress ends then, and nothing is logged. */
  async function updatePause() {
    const partyMissing = !partyKnown && !allPlayers()
    const next = !stopped && !!session && session.state !== 'idle' && (unavailable.size > 0 || partyMissing)
    if (next !== paused) {
      paused = next
      if (paused) {
        encounters.boundary('inputUnavailable', ctx.clock.now() ?? 0)
        log.recorder.flushBoundaries()
        await flushLog()
        inCombat = null
        const reasons = Object.fromEntries(unavailable)
        if (partyMissing) reasons.party ??= '尚未收到队伍数据'
        ctx.log.warn('输入源不可用，统计已暂停', { reasons })
        await publishNow()
        timer()
      } else {
        ctx.log.info('输入源已恢复，统计继续')
        if (pauseNotified && !stopped && session?.state !== 'idle') notify('统计已恢复', 'Mojito已恢复返回游戏数据。')
        pauseNotified = false
        await publishNow()
      }
    }
    retryState()
  }
  /** Tries the unavailable inputs again every ten seconds while the statistics are paused. */
  function retryState() {
    const needed = paused && !stopped
    if (!needed && retryTimer !== null) {
      clearInterval(retryTimer)
      retryTimer = null
    }
    if (!needed || retryTimer !== null) return
    retryTimer = setInterval(() => {
      void enqueue(retryInputs).catch(() => {}) // enqueue records the error.
    }, 10_000)
  }
  async function retryInputs() {
    if (!paused || stopped || !session || session.state === 'idle') return
    if (unavailable.has('reads')) {
      try {
        syncPlayer(await ctx.game.getPlayer({ fields: ['actorId', 'name', 'inCombat'] }))
        unavailable.delete('reads')
        await flushLog()
      } catch (error) {
        unavailable.set('reads', String(error))
      }
    }
    subscribeState()
    await subscribeEvents()
    if (subscription && !reviewSub) subscribeReview()
    await updatePause()
    if (paused && !pauseNotified) {
      pauseNotified = true
      notify('统计已暂停', 'Mojito没有正常返回游戏数据，恢复后会自动继续统计。')
    }
  }
  function syncPlayer(sample: Sample<GameTopics['player']>) {
    if (
      `${sample.meta.sessionId}:${sample.meta.characterGeneration}:${sample.meta.clockGeneration}` !==
      identities?.source
    )
      return
    const player = sample.value,
      id = value(player.actorId),
      name = value(player.name),
      combat = player.inCombat
    const other = id !== null && encounters.localActorId !== null && id !== encounters.localActorId
    const inCombatValue = id === null ? null : value(combat),
      combatAt = combat?.state === 'ok' ? combat.observedAt : sample.meta.observedAt
    // 'watch' marks values handled here, including the snapshot read when a session starts. The row goes before the sync,
    // whose quiet end belongs after it.
    log.recorder.player(
      'watch',
      sample.value,
      sample.meta.observedAt,
      !other && encounters.syncChanges(inCombatValue, combatAt),
    )
    if (other) return
    if (id !== null) encounters.localActorId = id
    if (id !== null) members.add(id)
    if (id !== null && name !== null) primary = { id, name }
    encounters.syncCombat(inCombatValue, combatAt, ctx.clock.now() ?? sample.meta.observedAt)
    inCombat = encounters.inCombat
  }
  /** Subscribes the game states the statistics follow, those not subscribed yet or dropped after failing */
  function subscribeState() {
    if (!zoneSub) {
      zoneSub = ctx.game.subscribe('zone', (batch) =>
        enqueue(async () => {
          let changed = false
          for (const sample of batch.items) {
            if (
              `${sample.meta.sessionId}:${sample.meta.characterGeneration}:${sample.meta.clockGeneration}` !==
              identities?.source
            )
              continue
            const zone = value(sample.value.territoryType)
            if (zone !== null && zone !== encounters.zone) {
              if (encounters.zone !== null) {
                encounters.finish('zoneChanged', sample.meta.observedAt)
                encounters.resetCombat(sample.meta.observedAt)
                inCombat = null
              }
              encounters.zone = zone
              await gameCache.name('territoryType', zone)
              logPending = true
              changed = true
            }
            log.recorder.zone(sample.value, sample.meta.observedAt, {
              encounters: encounters.carry(),
              generations: identities.carry(),
            })
          }
          await flushLog()
          // Zone samples also arrive without a new territory; only entering one ends the fight at once.
          if (changed) await publishNow()
          else schedulePublish()
        }),
      )
      const sub = zoneSub
      watchInput(
        'zone',
        sub,
        () => zoneSub,
        () => {
          zoneSub = null
        },
      )
    }
    if (!partySub) {
      partySub = ctx.game.subscribe('party', (batch) =>
        enqueue(async () => {
          for (const sample of batch.items) {
            if (
              `${sample.meta.sessionId}:${sample.meta.characterGeneration}:${sample.meta.clockGeneration}` !==
              identities?.source
            )
              continue
            const list = value(sample.value.members)
            // A later sample without the members keeps the last party, so it does not end the fight in progress.
            if (list !== null) partyKnown = true
            if (list) party = list.map(({ id, ownParty }) => ({ id, ownParty }))
            scopeMembers()
            log.recorder.party(sample.value, sample.meta.observedAt)
          }
          await updatePause()
        }),
      )
      const sub = partySub
      watchInput(
        'party',
        sub,
        () => partySub,
        () => {
          partySub = null
        },
      )
    }
    if (!playerSub) {
      playerSub = ctx.game.subscribe(
        'player',
        (batch) =>
          enqueue(async () => {
            for (const sample of batch.items) {
              if (
                `${sample.meta.sessionId}:${sample.meta.characterGeneration}:${sample.meta.clockGeneration}` !==
                identities?.source
              )
                continue
              syncPlayer(sample)
            }
            await flushLog()
            timer()
            // A fight that ended here is shown at once; other player changes wait for the next publication.
            if (terminalFrames.length) await publishNow()
            else schedulePublish(true)
          }),
        { fields: ['actorId', 'name', 'inCombat'] },
      )
      const sub = playerSub
      watchInput(
        'player',
        sub,
        () => playerSub,
        () => {
          playerSub = null
        },
      )
    }
    if (!entitiesSub) {
      entitiesSub = ctx.game.subscribe(
        'entities',
        (batch) =>
          enqueue(async () => {
            for (const sample of batch.items) {
              if (
                `${sample.meta.sessionId}:${sample.meta.characterGeneration}:${sample.meta.clockGeneration}` !==
                identities?.source
              )
                continue
              const characters = sample.value.entities.filter(isCharacterEntity)
              const present = new Set(characters.map((actor) => actor.id))
              const missing = [...entityIds].filter((id) => !present.has(id))
              identities.update(characters, missing, members, allPlayers())
              entityIds = present
              encounters.updateActors(identities.actors, identities.revision)
              await lookupJobs(characters)
              log.recorder.identities(
                'entities',
                characters,
                missing,
                members,
                encounters.config.scope,
                sample.meta.observedAt,
              )
            }
          }),
        {
          fields: ['name', 'homeWorldId', 'classJob', 'ownerId', 'objectKind', 'subKind', 'bNpcBase'],
        },
      )
      const sub = entitiesSub
      watchInput(
        'entities',
        sub,
        () => entitiesSub,
        () => {
          entitiesSub = null
        },
      )
    }
  }
  async function changeSession(next: SessionSnapshot) {
    const key =
      next.sessionId === null ? null : `${next.sessionId}:${next.characterGeneration}:${next.clock.generation}`
    // Snapshots also carry the clock, which moves all the time during a replay.
    const changed =
      identities?.source !== key ||
      session?.state !== next.state ||
      session?.dataLanguage !== next.dataLanguage ||
      session?.character?.actorId !== next.character?.actorId
    if (identities?.source !== key) {
      ++eventGeneration
      subscription?.dispose()
      subscription = null
      reviewSub?.dispose()
      reviewSub = null
      sceneSub?.dispose()
      sceneSub = null
      runner?.dispose()
      runner = null
      encounters.boundary('sourceChanged', ctx.clock.now() ?? 0)
      encounters.zone = null
      dutyNames.clear()
      await flushLog()
      identities = key === null ? null : new Identities(key)
      encounters.resetCombat(-Infinity)
      encounters.localActorId = null
      encounters.source = key
      primary = null
      inCombat = null
      members = new Set()
      party = []
      partySub?.dispose()
      playerSub?.dispose()
      entitiesSub?.dispose()
      zoneSub?.dispose()
      partySub = playerSub = entitiesSub = zoneSub = null
      entityIds = new Set()
      partyKnown = false
      unavailable.clear()
    }
    if (session?.dataLanguage !== next.dataLanguage) {
      dutyNames.clear()
      review = null
      await gameCache.validate(readableLanguage(next))
    }
    session = next
    log.recorder.source(next)
    if (next.state === 'idle') inputError = null
    const actorId = next.character?.actorId
    // A same-source snapshot can still lack the identity learned from packets.
    if (actorId !== null && actorId !== undefined) encounters.localActorId = actorId
    if (actorId !== null && actorId !== undefined) members.add(actorId)
    if (next.state === 'idle') unavailable.clear()
    else {
      try {
        syncPlayer(await ctx.game.getPlayer({ fields: ['actorId', 'name', 'inCombat'] }))
        unavailable.delete('reads')
        await flushLog()
      } catch (error) {
        unavailable.set('reads', String(error))
      }
      subscribeState()
      await subscribeEvents()
    }
    await updatePause()
    if (changed) await publishNow()
    else schedulePublish()
    timer()
  }
  const sessionSub = ctx.session.subscribe((batch) =>
    enqueue(async () => {
      for (const item of batch.items) await changeSession(item)
    }),
  )
  disposers.push(() => sessionSub.dispose())
  await sessionSub.ready
  disposers.push(
    await ctx.views.onCommand('statistics', (input) => {
      if (!input || typeof input !== 'object' || Array.isArray(input) || input instanceof Uint8Array)
        throw new Error('无效命令')
      const request = input as Record<string, Value>
      // Icons only read game data, so they do not wait behind the statistics.
      if (request.kind === 'icon' && typeof request.key === 'string') return icon(request.key)
      // The review reads the log only, so it does not wait behind the statistics either.
      if (request.kind === 'replay' && typeof request.visitId === 'string' && typeof request.fightId === 'string')
        return replayData(request.visitId, request.fightId) as unknown as Promise<Value>
      return enqueue(async () => {
        if (request.kind === 'end' && typeof request.id === 'string') {
          const result = encounters.end(request.id, ctx.clock.now() ?? 0)
          log.recorder.flushBoundaries()
          await flushLog()
          await publishNow()
          timer()
          return { result }
        }
        if (request.kind === 'clear') {
          await log.clear()
          encounters.clearHistory()
          replays.clear()
          review = null
          prepared = null
          visitStatus.clear()
          following = true
          pinned = null
          page = 0
          fillRun++
          reading = false
        } else if (request.kind === 'visits') {
          const next = parseQuery(request.query)
          if (!next || typeof request.page !== 'number' || !Number.isInteger(request.page) || request.page < 0)
            throw new Error('无效命令')
          query = next
          page = request.page
          await publishNow(false)
          void fillPage()
          return null
        } else if (
          request.kind === 'select' &&
          typeof request.visitId === 'string' &&
          typeof request.fightId === 'string'
        ) {
          following = request.fightId === encounters.active?.id
          pinned = following ? null : { visitId: request.visitId, fightId: request.fightId }
          // A visit that failed to load is read again when it is chosen again.
          if (visitStatus.get(request.visitId)?.loading === false) visitStatus.delete(request.visitId)
        } else if (request.kind === 'current') {
          following = true
          pinned = null
        } else if (request.kind === 'settings') {
          const next = settings(request.value)
          await ctx.config.set('settings', next as unknown as Json)
          encounters.config = next
          log.recorder.settings(next)
          scopeMembers()
          if (identities) {
            identities.classify(members, allPlayers())
            encounters.updateActors(identities.actors, identities.revision)
          }
          const now = ctx.clock.now()
          if (now !== null) encounters.advance(now)
          log.recorder.flushBoundaries()
          await flushLog()
          // The scope decides whether the party is needed.
          await updatePause()
        } else throw new Error('无效命令')
        await publishNow(false)
        timer()
        return null
      })
    }),
  )
  disposers.push(await ctx.ui.registerFeature({ id: 'statistics', name: '战斗统计', entry: 'index.html' }))
  disposers.push(
    await ctx.ui.registerFeature({ id: 'settings', name: '战斗统计', entry: 'settings.html', placement: 'settings' }),
  )
  await enqueue(() => publishNow())
  // open reads the first page only; the next older files tell whether there is a second one.
  void fillPage()
  return async () => {
    stopped = true
    fillRun++
    if (logTimer !== null) clearInterval(logTimer)
    if (retryTimer !== null) clearInterval(retryTimer)
    if (displayTimer !== null) clearInterval(displayTimer)
    displayTimer = null
    presentation.reset()
    cancelTimer?.()
    if (publishTimer !== null) clearTimeout(publishTimer)
    publishTimer = null
    subscription?.dispose()
    partySub?.dispose()
    playerSub?.dispose()
    entitiesSub?.dispose()
    zoneSub?.dispose()
    reviewSub?.dispose()
    sceneSub?.dispose()
    runner?.dispose()
    runner = null
    positionSub?.dispose()
    for (const dispose of disposers.reverse()) await dispose()
    await queue
    const now = ctx.clock.now() ?? Date.now()
    encounters.finish('stopped', now)
    log.recorder.stop(now)
    try {
      await log.flush()
      checkLogError()
    } catch (error) {
      ctx.log.warn('战斗日志写入失败', { error: String(error) })
    }
    await gameCache.flush()
  }
}
