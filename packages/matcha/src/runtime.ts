// Copyright (c) FFCafe. Licensed under AGPL-3.0-only.
import type {
  Disposer,
  HttpService,
  Json,
  PluginContext,
  SessionSnapshot,
  Subscription,
  Value,
  ViewIdentity,
} from '@ffcafe/mojito-plugin-sdk'
import { universalisCredentials } from './build-config.js'
import fates from './data/fate.json'
import patches from './data/patch.json'
import templates from './data/template.json'
import territories from './data/territory.json'
import worlds from './data/world.json'
import { createFishingApi, createFishingMemoryReader, FishingHandler, FishingService } from './fishing/index.js'
import { InitialDataStore } from './initial-data/index.js'
import { readClientItems } from './item-data.js'
import { ClientMapData } from './map-data.js'
import { Notices } from './notifications.js'
import { OverlayStorage } from './overlay-storage.js'
import { MatchaPacketHandlers } from './packets/index.js'
import { createUniversalisClient } from './packets/universalis.js'
import { asJson, type Diagnostic, type MatchaEvent, record } from './protocol.js'
import { resourceUrl } from './resources.js'
import { settingsFrom, settingsJson } from './settings.js'
import { MatchaSnapshot } from './snapshot.js'
import { SubmarineHandler } from './submarine/index.js'
import { sendWebhook } from './webhooks.js'

const encoder = new TextEncoder()
const languageTag: Record<string, string> = { chs: 'zh-CN', en: 'en-US', ja: 'ja-JP', de: 'de-DE', fr: 'fr-FR' }
const identity = (s: SessionSnapshot) =>
  `${s.sessionId}:${s.characterGeneration}:${s.clock.generation}:${s.state}:${s.login}`

/** One worker owns the shared Matcha state; opening another view never starts a second collector. */
export async function activate(context: PluginContext): Promise<Disposer> {
  const version = context.identity.version
  let settings = settingsFrom(await context.config.get('settings'))
  let session = await context.session.get()
  let stopped = false
  let sequence = 0
  let effects = 0
  let lastNotice = -Infinity
  let noticeBusy = false
  let stateRevision = 0
  let cancellation = new AbortController()
  let packetSubscription: Subscription | undefined
  let packetEpoch = 0
  let quiet = false
  let initialBatch = false
  let dirty = true
  let publishing = false
  let sessionRevision = 0
  const disposers: Disposer[] = []
  let publications = Promise.resolve()
  const publish = (channel: string, value: Value) => {
    const next = publications.then(async () => {
      if (stopped || context.signal.aborted) return
      context.views.set(channel, value)
      await context.views.flush()
    })
    publications = next.catch(() => {})
    return next
  }
  const state = new MatchaSnapshot()
  const storage = new OverlayStorage(context)
  const notices = new Notices()
  const diagnostics: Diagnostic[] = []
  const pendingEvents: MatchaEvent[] = []
  const pendingNotices: string[] = []
  const pendingEffects: { label: string; signal: AbortSignal; run: (signal: AbortSignal) => Promise<unknown> }[] = []
  const granted = (name: string) => context.capabilities.get().granted.includes(name)
  const mapData = new ClientMapData(
    context.data,
    context.limits.values['data.rowIds'],
    () => granted('data.read'),
    () => cancellation.signal,
  )
  const live = () => !stopped && !initialBatch && session.state === 'live' && session.login === 'logged-in'
  const now = () => context.clock.now() ?? Date.now()
  const diagnostic = (message: string) => {
    if (stopped) return
    const safe = message.slice(0, 300)
    if (diagnostics.at(-1)?.message === safe && now() - diagnostics.at(-1)!.at < 10000) return
    diagnostics.push({ at: now(), message: safe })
    if (diagnostics.length > 50) diagnostics.shift()
    dirty = true
    context.log.warn(safe)
  }
  const http: HttpService = {
    async request(url, options = {}) {
      const signal = AbortSignal.any([context.signal, cancellation.signal, ...(options.signal ? [options.signal] : [])])
      const result = await context.http.request(url, { ...options, credentials: 'omit', signal })
      signal.throwIfAborted()
      return result
    },
  }
  const resourceSlots = Array.from(
    { length: Math.max(1, Math.min(4, context.limits.values['http.pluginConcurrent'] ?? 4)) },
    () => Promise.resolve(),
  )
  let resourceSlot = 0
  const readResource = (url: string) => {
    const slot = resourceSlot++ % resourceSlots.length
    const result = resourceSlots[slot].then(() => {
      context.signal.throwIfAborted()
      return http.request(url, { method: 'GET', timeoutMs: 10000 })
    })
    resourceSlots[slot] = result.then(
      () => {},
      () => {},
    )
    return result
  }
  const drainEffects = () => {
    while (live() && effects < 4 && pendingEffects.length) {
      const { label, signal, run } = pendingEffects.shift()!
      if (signal.aborted) continue
      effects++
      void run(signal)
        .catch(() => {
          if (!signal.aborted) diagnostic(`${label}未完成，请检查权限与服务设置。`)
        })
        .finally(() => {
          effects--
          drainEffects()
        })
    }
  }
  const effect = (label: string, run: (signal: AbortSignal) => Promise<unknown>) => {
    if (!live()) return
    if (pendingEffects.length >= 64) {
      diagnostic('外发事件积压超过限制，已丢弃新事件。')
      return
    }
    pendingEffects.push({ label, signal: cancellation.signal, run })
    drainEffects()
  }
  const drainNotices = async () => {
    if (!live() || noticeBusy || !pendingNotices.length || Date.now() - lastNotice < 1100) return
    const text = pendingNotices.shift()!
    noticeBusy = true
    lastNotice = Date.now()
    const signal = cancellation.signal
    try {
      const results = await Promise.allSettled([
        ...(settings.output.tts && granted('audio.play')
          ? [context.audio.say(text, { language: languageTag[settings.language], signal })]
          : []),
        ...(settings.output.toast ? [context.notifications.send({ title: 'Matcha', detail: text }, { signal })] : []),
      ])
      if (!signal.aborted && results.some((result) => result.status === 'rejected'))
        diagnostic('部分通知未完成，请检查权限。')
    } finally {
      noticeBusy = false
    }
  }
  const emit = (type: string, content: Json, timestamp = now()) => {
    if (stopped || quiet) return
    const event: MatchaEvent = { sequence: ++sequence, type, content, timestamp }
    state.add(event)
    pendingEvents.push(event)
    if (pendingEvents.length > 512) {
      // A fresh snapshot repairs a slow view without retaining an unbounded event queue.
      pendingEvents.splice(0, pendingEvents.length - 512)
      diagnostic('界面消费速度不足；已保留最新状态。')
    }
    dirty = true
    if (settings.logging) context.log.debug(`Matcha ${type}`)
    if (!live()) return
    const text = notices.message(type, content, timestamp, settings)
    if (text) {
      if (pendingNotices.length < 32) pendingNotices.push(text)
      else diagnostic('通知积压超过限制，已丢弃新通知。')
      void drainNotices()
    }
    for (const hook of settings.webhooks)
      if (hook.event === type) effect('Webhook', (signal) => sendWebhook(http, hook, type, content, signal))
  }
  const memory = createFishingMemoryReader({
    memory: context.memory,
    game: context.game,
    session: context.session,
    now,
  })
  const fishingService = new FishingService({
    api: createFishingApi(http),
    now,
    attributes: () => memory.snapshot,
    emit,
    live,
  })
  const fishing = new FishingHandler({
    emit,
    attributes: () => memory.snapshot,
    actorId: () => session.character?.actorId ?? null,
    now,
    observe: (value) => fishingService.observe(value),
  })
  const initial = new InitialDataStore({ emit })
  const submarines = new SubmarineHandler(emit)
  const market = createUniversalisClient({
    http,
    getSettings: () => ({
      enabled: settings.universalis.enabled && universalisCredentials !== null && live(),
      apiKey: universalisCredentials?.apiKey,
      uploaderId: universalisCredentials?.uploaderId,
    }),
    dataCenters: Object.fromEntries(Object.entries(worlds).map(([id, world]) => [id, world.dc_en])),
    worldNames: Object.fromEntries(
      Object.entries(worlds).flatMap(([id, world]) => [
        [world.name, Number(id)],
        [world.name_en, Number(id)],
      ]),
    ),
    onDiagnostic: diagnostic,
  })
  const packets = new MatchaPacketHandlers({ emit, now, market, onDiagnostic: diagnostic })
  const publicSettings = () => {
    const value = structuredClone(settings)
    value.webhooks = value.webhooks.map((hook) => ({ ...hook, headers: {} }))
    return settingsJson(value)
  }
  const snapshot = () =>
    asJson({
      sequence,
      events: state.events(),
      session,
      settings: publicSettings(),
      diagnostics,
      language: settings.language,
      version,
      notebook: initial.snapshot,
      mapDataGeneration: mapData.generation,
    })
  const flush = async () => {
    if (stopped || publishing || !dirty) return
    publishing = true
    dirty = false
    const events = pendingEvents.splice(0)
    const revision = stateRevision
    const current = () => !stopped && revision === stateRevision
    try {
      context.views.set('matcha.state', snapshot())
      await context.views.flush()
      if (!current()) return
      for (const event of events) {
        await publish('matcha.events', asJson(event))
        if (!current()) return
      }
      await publish(
        'matcha.status',
        asJson({ session, diagnostics, notebook: initial.snapshot, mapDataGeneration: mapData.generation }),
      )
    } catch {
      if (!stopped) diagnostic('界面状态同步未完成。')
    } finally {
      publishing = false
    }
  }
  const reset = () => {
    stateRevision++
    cancellation.abort()
    cancellation = new AbortController()
    mapData.reset()
    quiet = true
    packets.reset()
    fishing.reset()
    fishingService.reset()
    initial.reset()
    submarines.reset()
    memory.reset()
    notices.reset()
    quiet = false
    state.clear()
    pendingEvents.length = 0
    pendingNotices.length = pendingEffects.length = 0
    lastNotice = -Infinity
    emit('Reset', null)
  }
  const connectPackets = () => {
    const epoch = ++packetEpoch
    packetSubscription?.dispose()
    packetSubscription = undefined
    if (stopped || session.state === 'idle' || !granted('packets.read')) return
    const subscription = context.packets.subscribe(
      'ipc',
      (batch) => {
        if (stopped || epoch !== packetEpoch) return
        if (!batch.complete) {
          reset()
          diagnostic('抓包数据存在缺口，已清除不完整状态。')
        }
        initialBatch = batch.initial
        try {
          for (const item of batch.items) {
            if (
              item.meta.sessionId !== session.sessionId ||
              item.meta.characterGeneration !== session.characterGeneration ||
              item.meta.clockGeneration !== session.clock.generation
            )
              continue
            packets.handle(item.value)
            fishing.handle(item.value)
            initial.handle(item.value)
            submarines.handle(item.value)
          }
        } finally {
          initialBatch = false
        }
        void flush()
      },
      {
        channels: ['zone'],
        directions: session.state === 'replay' ? ['recv'] : ['recv', 'send'],
        signal: context.signal,
      },
    )
    packetSubscription = subscription
    void subscription.ready.catch(() => {
      if (stopped || epoch !== packetEpoch) return
      packetEpoch++
      packetSubscription = undefined
      subscription.dispose()
      reset()
      diagnostic('数据包订阅未建立，请检查权限与客户端配置。')
      void flush()
    })
    void subscription.closed.then(({ reason }) => {
      if (stopped || epoch !== packetEpoch) return
      packetEpoch++
      packetSubscription = undefined
      reset()
      if (reason !== 'disposed') diagnostic('数据包订阅已结束；等待新的游戏会话。')
      void flush()
    })
  }
  const observeSession = (next: SessionSnapshot) => {
    sessionRevision++
    const changed = identity(next) !== identity(session)
    const dataChanged =
      next.dataLanguage !== session.dataLanguage ||
      next.grantedCapabilities.includes('data.read') !== session.grantedCapabilities.includes('data.read')
    session = next
    dirty = true
    if (changed) {
      reset()
      connectPackets()
    } else {
      if (dataChanged) mapData.reset()
      if (!packetSubscription && granted('packets.read')) connectPackets()
    }
    void flush()
  }
  const saveSettings = async (value: unknown) => {
    const next = settingsFrom(value)
    const watchChanged = JSON.stringify(next.watch.fates) !== JSON.stringify(settings.watch.fates)
    await context.config.set('settings', settingsJson(next))
    cancellation.abort()
    cancellation = new AbortController()
    mapData.reset()
    pendingNotices.length = pendingEffects.length = 0
    settings = next
    const world = packets.snapshot().world
    packets.reset()
    packets.setWorld(world)
    notices.reset()
    fishingService.reset()
    fishingService.setEnabled(settings.fishing.enabled)
    if (watchChanged) {
      initialBatch = true
      try {
        emit('FateWatchListChanged', { world, fates: settings.watch.fates })
      } finally {
        initialBatch = false
      }
    }
    dirty = true
    await flush()
    await publish('matcha.settings', publicSettings())
    return settingsJson(settings)
  }
  const command = async (value: Value, view: ViewIdentity): Promise<Value> => {
    const input = record(value)
    const admin = view.kind === 'feature' && view.definitionId === 'settings'
    const requireSettings = () => {
      if (!admin) throw new Error('请从 Matcha 设置页面操作')
    }
    switch (input.action) {
      case 'item.get': {
        if (!granted('data.read')) throw new Error('permission_denied: data.read')
        if (
          !Array.isArray(input.ids) ||
          input.ids.length > 256 ||
          input.ids.some((id) => typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0 || id > 0xffffffff)
        )
          throw new Error('无效物品编号')
        const revision = mapData.generation
        const result = await readClientItems(
          context.data,
          input.ids as number[],
          session.dataLanguage ?? settings.language,
          cancellation.signal,
        )
        if (revision !== mapData.generation || !granted('data.read')) throw new Error('stale_session')
        return asJson(result)
      }
      case 'map.image':
        if (typeof input.id !== 'string') throw new Error('无效地图标识')
        return context.data.map(input.id)
      case 'map.icon': {
        const id = input.id
        if (typeof id !== 'number' || !Number.isInteger(id) || id < 0 || id > 999999) throw new Error('无效图标ID')
        const group = String(Math.floor(id / 1000) * 1000).padStart(6, '0')
        return context.data.image(`ui/icon/${group}/${String(id).padStart(6, '0')}.tex`)
      }
      case 'map.regions':
        return asJson(await mapData.getRegion())
      case 'map.key':
        if (typeof input.id !== 'string') throw new Error('无效地图标识')
        return mapData.getMapKeyById(input.id)
      case 'map.get':
      case 'map.markers':
        if (
          typeof input.rowId !== 'number' ||
          !Number.isInteger(input.rowId) ||
          input.rowId < 0 ||
          input.rowId > 0xffffffff
        )
          throw new Error('无效地图行ID')
        return asJson(
          input.action === 'map.get' ? await mapData.getMap(input.rowId) : await mapData.getMapMarkers(input.rowId),
        )
      case 'config.get':
        return storage.get(String(input.key))
      case 'config.set': {
        if (input.value !== null && typeof input.value !== 'string') throw new Error('设置值必须是字符串')
        const key = String(input.key)
        await storage.set(key, input.value as string | null)
        await publish('matcha.config', { key, value: input.value as string | null })
        return null
      }
      case 'http': {
        const url = resourceUrl(String(input.url))
        const options = record(input.options ?? {})
        if (options.method && options.method !== 'GET') throw new Error('此界面只支持游戏资料查询')
        return readResource(url)
      }
      case 'say': {
        const text = String(input.text)
        if (text.length > 1000) throw new Error('语音内容过长')
        await context.audio.say(text, { language: languageTag[settings.language] })
        return null
      }
      case 'settings.get':
        requireSettings()
        return settingsJson(settings)
      case 'settings.set':
        requireSettings()
        return saveSettings(input.settings)
      case 'catalog':
        return asJson({ fates, templates, patches, territories, universalis: universalisCredentials !== null })
      // The page picks and saves the files itself; these only turn them into settings and back
      case 'watch.import': {
        requireSettings()
        if (!(input.bytes instanceof Uint8Array)) throw new Error('无效文件内容')
        const imported: unknown = JSON.parse(new TextDecoder().decode(input.bytes))
        const ids = Array.isArray(imported) ? imported : record(imported).fates
        return settingsFrom({ ...settings, watch: { fates: ids } }).watch.fates
      }
      case 'watch.export':
        requireSettings()
        return encoder.encode(
          JSON.stringify(
            settingsFrom({ ...settings, watch: { fates: input.fates ?? settings.watch.fates } }).watch.fates,
          ),
        )
      case 'notebook.export':
        requireSettings()
        return encoder.encode(initial.exportJson())
      case 'test.notification': {
        requireSettings()
        const results = await Promise.allSettled([
          ...(settings.output.tts
            ? [context.audio.say('这是 Matcha 通知测试', { language: languageTag[settings.language] })]
            : []),
          ...(settings.output.toast
            ? [context.notifications.send({ title: 'Matcha', detail: '这是 Matcha 通知测试' })]
            : []),
        ])
        if (results.some((result) => result.status === 'rejected'))
          throw new Error('部分通知不可用，请检查音频与通知权限')
        return true
      }
      default:
        throw new Error('未知 Matcha 指令')
    }
  }
  let pollBusy = false
  const poll = async () => {
    if (stopped || pollBusy) return
    pollBusy = true
    const captured = sessionRevision
    const clock = context.clock.state()
    if (clock.generation === session.clock.generation) session = { ...session, clock }
    dirty = true
    try {
      if (live() && granted('memory.read') && granted('game.read')) await memory.read()
      if (live() && granted('game.read') && session.character?.actorId) {
        const result = await context.game.getCombatants({
          ids: [session.character.actorId],
          fields: ['currentWorldId'],
        })
        if (
          captured === sessionRevision &&
          result.meta.sessionId === session.sessionId &&
          result.meta.characterGeneration === session.characterGeneration
        ) {
          const world = result.value.entities[0]?.currentWorldId
          if (world?.state === 'ok') packets.setWorld(world.value)
        }
      }
      if (captured === sessionRevision) {
        fishingService.tick()
      }
    } catch {
      /* Optional read capabilities can be unavailable during loading. */
    } finally {
      pollBusy = false
      void flush()
    }
  }
  const dispose = async () => {
    if (stopped) return
    stopped = true
    cancellation.abort()
    packetEpoch++
    packetSubscription?.dispose()
    memory.dispose()
    fishingService.dispose()
    initial.dispose()
    submarines.dispose()
    await Promise.allSettled(disposers.splice(0).map((dispose) => dispose()))
    await storage.drain()
  }
  try {
    disposers.push(await context.views.onCommand('matcha.command', command))
    fishingService.setEnabled(settings.fishing.enabled)
    await flush()
    const subscription = context.session.subscribe(
      (batch) => {
        for (const item of batch.items) observeSession(item)
      },
      { signal: context.signal },
    )
    disposers.push(() => subscription.dispose())
    void subscription.closed.then(() => {
      if (stopped) return
      packetEpoch++
      packetSubscription?.dispose()
      packetSubscription = undefined
      reset()
      diagnostic('会话订阅已结束，请重新启用插件恢复连接。')
      void flush()
    })
    await subscription.ready
    // Reconcile a source change between the initial get and subscription registration.
    const revision = sessionRevision
    const current = await context.session.get()
    if (revision === sessionRevision) observeSession(current)
    if (!packetSubscription) connectPackets()
    disposers.push(
      await context.ui.registerFeature({
        id: 'settings',
        name: 'Matcha 设置',
        entry: 'settings.html',
        placement: 'settings',
      }),
    )
    disposers.push(
      await context.ui.registerOverlay({
        id: 'matcha',
        name: 'Matcha',
        entry: 'ui/index.html',
        defaultSize: { width: 440, height: 400 },
      }),
    )
    const interval = setInterval(() => {
      void poll()
      void flush()
      void drainNotices()
    }, 1000)
    disposers.push(() => clearInterval(interval))
    const onAbort = () => {
      void dispose()
    }
    context.signal.addEventListener('abort', onAbort, { once: true })
    disposers.push(() => context.signal.removeEventListener('abort', onAbort))
    void poll()
    return dispose
  } catch (error) {
    await dispose()
    throw error
  }
}
