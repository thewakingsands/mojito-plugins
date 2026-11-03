import type {
  Disposer,
  GameTopics,
  Json,
  PlayerState,
  PluginContext,
  Sample,
  SessionSnapshot,
  SourceMeta,
  Subscription,
  Value,
} from '@ffcafe/mojito-plugin-sdk'
import { bindOverlayQuery } from '../vendor/cactbot/resources/overlay_plugin_api'
import PartyTracker from '../vendor/cactbot/resources/party'
import type { Party } from '../vendor/cactbot/types/event'
import { options, RaidbossEngine } from './engine'
import { EntityCache, eventTypes, projectEvent } from './events'
import { partyMembers, queryBridge, raidbossData, sameParty } from './game'
import { parseSettings } from './settings'

export async function activateRaidboss(
  ctx: PluginContext,
  sets: { path: string; set: unknown }[],
  timelines: Record<string, string>,
  upstreamCommit: string,
): Promise<Disposer> {
  let settings = parseSettings(await ctx.config.get('settings'))
  let revision = 0,
    snapshotRevision = 0,
    generation = 0,
    stopped = false,
    moduleFault: string | null = null,
    sourceError: string | null = '等待来源',
    failedSubscription: string | null = null
  let session: SessionSnapshot | undefined,
    player: Sample<PlayerState> | undefined,
    party: Sample<GameTopics['party']> | undefined
  let zone: number | undefined,
    started = '',
    root = new AbortController()
  let cancelTick: Disposer | undefined
  let saving = Promise.resolve()
  const subscriptions: Subscription[] = []
  const disposers: Disposer[] = []
  const entities = new EntityCache()
  const tracker = new PartyTracker(options(settings.language))
  const partyJobs = new Map<number, number>()
  let partyMembersShown: Party[] = []
  let publishing = false,
    dirty = false,
    catalogRevision = 0,
    catalogKey = ''
  let published: Promise<void> = Promise.resolve()
  const publish = () => {
    dirty = true
    if (publishing || stopped) return published
    publishing = true
    published = (async () => {
      try {
        while (dirty && !stopped) {
          dirty = false
          // Rule definitions and options are large and change only with the active groups or language.
          const key = `${engine.catalogRevision}|${settings.language}`
          if (key !== catalogKey) {
            catalogKey = key
            ctx.views.set('raidboss-catalog', {
              revision: ++catalogRevision,
              definitions: engine.definitions(settings.language),
              configurations: engine.configurations(settings.language),
            } as unknown as Value)
          }
          const state = {
            generation,
            revision: ++snapshotRevision,
            configRevision: revision,
            upstreamCommit,
            settings,
            zone: zone ?? null,
            diagnostics: engine.diagnostics,
            alerts: engine.alerts,
            bars: engine.bars,
            catalogRevision,
            sharedDataWarning: engine.sharedDataWarning,
            sourceError,
            moduleFault,
            audioGranted: ctx.capabilities.get().granted.includes('audio.play'),
            clock: ctx.clock.state(),
            realReplayVerified: false,
          }
          ctx.views.set('raidboss', state as unknown as Value)
          await ctx.views.flush()
        }
      } catch (error) {
        ctx.log.error('Raidboss view output failed', { error: String(error) })
      } finally {
        publishing = false
      }
    })()
    return published
  }
  const audioError = (error: unknown, signal: AbortSignal) => {
    if (!signal.aborted) {
      sourceError = `音频输出失败：${String(error)}`
      void publish()
    }
  }
  const engine = new RaidbossEngine(sets, timelines, ctx.clock, {
    changed: () => {
      void publish()
    },
    say(text, signal) {
      if (ctx.capabilities.get().granted.includes('audio.play'))
        void ctx.audio
          .say(text, { language: settings.language === 'cn' ? 'zh-CN' : settings.language, signal })
          .catch((error) => audioError(error, signal))
    },
    play(path, volume, signal) {
      if (ctx.capabilities.get().granted.includes('audio.play'))
        void ctx.audio.play({ path }, { volume, signal }).catch((error) => audioError(error, signal))
    },
  })
  const accept = (next: SourceMeta): boolean =>
    !!session &&
    next.sessionId === session.sessionId &&
    next.characterGeneration === session.characterGeneration &&
    next.clockGeneration === ctx.clock.state().generation
  const refreshParty = () => {
    if (!party) return
    const members = partyMembers(party.value, entities, partyJobs)
    if (sameParty(members, partyMembersShown)) return
    partyMembersShown = members
    tracker.onPartyChanged({ party: members })
  }
  const start = (force = false, preservePersistent = false) => {
    if (moduleFault || failedSubscription || !player || zone === undefined) return
    const name = entities.field(player.value.name),
      job = entities.field(player.value.classJob)
    if (name === undefined || job === undefined) {
      sourceError = '缺少玩家名称或职业'
      void publish()
      return
    }
    const key = [generation, zone, name, job, settings.language, revision].join('|')
    if (!force && started === key) {
      sourceError = null
      return
    }
    const data = raidbossData(
      name,
      job,
      tracker,
      options(settings.language),
      () => start(true),
      () => player?.value,
    )
    try {
      engine.start(zone, data, settings, preservePersistent)
    } catch (error) {
      moduleFault = `规则模块初始化失败：${String(error)}`
      engine.reset()
      started = ''
      void publish()
      return
    }
    started = key
    sourceError = null
    if (!cancelTick) {
      const gen = generation
      const tick = () => {
        if (stopped || gen !== generation) return
        void publish()
        cancelTick = ctx.clock.setTimeout(tick, 250)
      }
      cancelTick = ctx.clock.setTimeout(tick, 250)
    }
    void publish()
  }
  const clear = () => {
    ++generation
    root.abort()
    root = new AbortController()
    if (cancelTick) void cancelTick()
    cancelTick = undefined
    for (const sub of subscriptions.splice(0)) sub.dispose()
    engine.reset()
    tracker.reset()
    entities.clear()
    partyJobs.clear()
    partyMembersShown = []
    moduleFault = null
    failedSubscription = null
    player = undefined
    party = undefined
    zone = undefined
    started = ''
    bindOverlayQuery(queryBridge(ctx, root.signal))
  }
  const keep = (sub: Subscription) => {
    subscriptions.push(sub)
    const gen = generation
    void sub.ready.catch((error) => {
      if (gen === generation && !stopped) {
        sourceError = failedSubscription = String(error)
        engine.reset()
        void publish()
      }
    })
    void sub.closed.then((result) => {
      if (gen !== generation || stopped || root.signal.aborted) return
      sourceError = failedSubscription = `来源订阅已结束：${result.reason}`
      engine.reset()
      void publish()
    })
  }
  const sessionSub = ctx.session.subscribe((batch) => {
    for (const next of batch.items) {
      const changed =
        next.sessionId !== session?.sessionId ||
        next.characterGeneration !== session?.characterGeneration ||
        next.clock.generation !== session?.clock.generation
      session = next
      if (!changed) {
        void publish()
        continue
      }
      clear()
      if (!next.sessionId || next.state === 'idle') {
        sourceError = '等待来源'
        void publish()
        continue
      }
      sourceError = '等待玩家与区域数据'
      keep(
        ctx.game.subscribe(
          'entities',
          (batch) => {
            for (const sample of batch.items)
              if (accept(sample.meta)) {
                const changes = entities.snapshot(sample.value.entities, sample.meta)
                for (const id of sample.value.missingIds) entities.remove(id)
                refreshParty()
                if (started) for (const change of changes) engine.event(change)
              }
          },
          {
            signal: root.signal,
            fields: [
              'name',
              'classJob',
              'homeWorldId',
              'position',
              'rotation',
              'bNpcBase',
              'bNpcName',
              'level',
              'hpCur',
              'hpMax',
              'mpCur',
              'mpMax',
              'weaponId',
              'modelStatus',
              'cast',
            ],
            intervalMs: 100,
          },
        ),
      )
      keep(
        ctx.game.subscribe(
          'player',
          (batch) => {
            for (const sample of batch.items)
              if (accept(sample.meta)) {
                player = sample
                start()
              }
          },
          { signal: root.signal, fields: ['name', 'classJob', 'hpCur', 'inCombat'] },
        ),
      )
      keep(
        ctx.game.subscribe(
          'party',
          (batch) => {
            for (const sample of batch.items)
              if (accept(sample.meta)) {
                party = sample
                refreshParty()
              }
          },
          { signal: root.signal },
        ),
      )
      keep(
        ctx.game.subscribe(
          'zone',
          (batch) => {
            for (const sample of batch.items)
              if (accept(sample.meta)) {
                if (sample.value.territoryType.state === 'ok') {
                  if (zone !== sample.value.territoryType.value) {
                    engine.reset()
                    started = ''
                  }
                  zone = sample.value.territoryType.value
                  start()
                }
              }
          },
          { signal: root.signal },
        ),
      )
      keep(
        ctx.events.subscribe(
          [...eventTypes],
          (batch) => {
            for (const sample of batch.items)
              if (accept(sample.meta) && !moduleFault) {
                const event = sample.value

                if (event.type === 'zoneChanged') {
                  zone = event.data.territoryTypeId
                  engine.reset()
                  started = ''
                }
                if (event.type === 'playerCombatChanged' && player)
                  player = {
                    ...player,
                    value: {
                      ...player.value,
                      inCombat: {
                        state: 'ok',
                        value: event.data.inCombat,
                        from: 'packet',
                        observedAt: sample.meta.observedAt,
                        timeBase: sample.meta.timeBase,
                      },
                    },
                  }
                if (
                  event.type === 'actorControl' &&
                  event.data.self &&
                  event.data.category === 109 &&
                  event.data.params[1] === 0x4000000f
                )
                  start(true)
                if (started) for (const projected of projectEvent(sample, entities)) engine.event(projected)

                if (event.type === 'playerCombatChanged' && !event.data.inCombat) start(true, true)
              }
          },
          { signal: root.signal },
        ),
      )
    }
  })
  await sessionSub.ready
  disposers.push(() => sessionSub.dispose())
  disposers.push(
    await ctx.views.onCommand('settings', (value) => {
      const command = value as unknown as { expectedRevision: number; settings: unknown }
      const next = saving.then(async () => {
        if (command.expectedRevision !== revision) throw new Error('配置已变更，请刷新后重试')
        const validated = parseSettings(command.settings)
        engine.validateOverrides(validated)
        await ctx.config.set('settings', validated as unknown as Json)
        settings = validated
        revision++
        moduleFault = null
        engine.reset()
        started = ''
        start()
        await publish()
        return revision
      })
      saving = next.then(
        () => {},
        () => {},
      )
      return next
    }),
  )
  disposers.push(await ctx.ui.registerFeature({ id: 'raidboss', name: 'Raidboss', entry: 'manage.html' }))
  disposers.push(
    await ctx.ui.registerOverlay({
      id: 'raidboss-overlay',
      name: 'Raidboss 提示',
      entry: 'overlay.html',
      defaultSize: { width: 420, height: 360 },
    }),
  )
  void publish()
  return async () => {
    stopped = true
    clear()
    bindOverlayQuery()
    for (const dispose of disposers.reverse()) await dispose()
  }
}
