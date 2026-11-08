import type { Disposer, GameIcon, PluginContext, SessionSnapshot, Subscription, Value } from '@ffcafe/mojito-plugin-sdk'
import type { Action, ActionInfo, DisplayState, Settings } from './state.js'

const defaults: Settings = { seconds: 10, scale: 100, newest: 'right' }
function settings(value: unknown): Settings | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Settings
  return [5, 10, 20].includes(v.seconds) &&
    [75, 100, 125, 150].includes(v.scale) &&
    ['left', 'right'].includes(v.newest)
    ? { seconds: v.seconds, scale: v.scale, newest: v.newest }
    : null
}

export async function activate(ctx: PluginContext) {
  let config = settings(await ctx.config.get('display')) ?? defaults
  let session: SessionSnapshot | null = null
  let sessionSub: Subscription | null = null,
    events: Subscription | null = null
  let stopped = false,
    epoch = 0,
    resourceKey = '',
    inputError: string | null = null
  let actions: Action[] = []
  const seen = new Set<string>()
  const infos = new Map<number, Promise<ActionInfo>>()
  const icons = new Map<number, Promise<GameIcon | null>>()
  const disposers: Disposer[] = []
  let dataVersion: string | null = null
  let version: Promise<string | null> = Promise.resolve(null)
  let saving = Promise.resolve()

  function clear() {
    dataVersion = null
    actions = []
    seen.clear()
    infos.clear()
    icons.clear()
    resourceKey = String(++epoch)
  }
  function expire() {
    const now = ctx.clock.now()
    if (now === null) return
    const remaining = actions.filter((action) => now - action.at < config.seconds * 1000)
    if (remaining.length === actions.length) return
    for (const action of actions) if (now - action.at >= config.seconds * 1000) seen.delete(action.key)
    actions = remaining
  }
  function publish(immediate = false) {
    if (stopped) return
    const value: DisplayState = {
      settings: config,
      clock: ctx.clock.state(),
      actions,
      resources: resourceKey,
      reason:
        inputError ??
        (session?.state === 'idle' || !session
          ? '等待游戏或回放'
          : !session.character?.actorId
            ? '等待本人身份'
            : null),
    }
    ctx.views.set('display', value)
    if (immediate) void ctx.views.flush().catch((error) => ctx.log.warn('显示更新失败', { error: String(error) }))
  }
  function info(id: number): Promise<ActionInfo> {
    const held = infos.get(id)
    if (held) return held
    const current = epoch,
      language = session?.dataLanguage ?? 'en'
    const request = version
      .then(async () => {
        const [rows, name] = await Promise.all([
          ctx.data.rows('Action', [id], language),
          ctx.data.name('action', id, language),
        ])
        const cells = rows.find((row) => row.rowId === id)?.subrows[0]?.cells
        const icon = cells?.[2],
          group = cells?.[41]
        return {
          name: name || String(id),
          gcd: group?.type === 'number' && group.value === 58,
          icon: icon?.type === 'number' && icon.value > 0 ? icon.value : null,
        }
      })
      .catch((error) => {
        if (epoch === current) infos.delete(id)
        throw error
      })
    infos.set(id, request)
    return request
  }
  function enrich(id: number) {
    const current = epoch
    void info(id)
      .then((value) => {
        if (stopped || current !== epoch) return
        let changed = false
        actions = actions.map((action) => {
          if (
            action.id !== id ||
            (action.name === value.name && action.gcd === value.gcd && action.icon === value.icon)
          )
            return action
          changed = true
          return { ...action, ...value }
        })
        if (changed) publish()
      })
      .catch((error) => ctx.log.debug('技能资料暂不可用', { id, error: String(error) }))
  }
  function unavailable(reason: string) {
    events?.dispose()
    events = null
    clear()
    inputError = reason
    publish(true)
  }
  function subscribeEvents() {
    if (stopped || events || !session?.sessionId || !session.character?.actorId || session.state === 'idle') return
    const sub = ctx.events.subscribe(['actionEffect'], (batch) => {
      if (events !== sub || stopped) return
      if (!batch.complete) {
        unavailable('动作输入不完整，等待自动重试')
        return
      }
      expire()
      const added: Action[] = []
      for (const { meta, value } of batch.items) {
        const clock = ctx.clock.state()
        if (
          value.type !== 'actionEffect' ||
          meta.sessionId !== session?.sessionId ||
          meta.characterGeneration !== session.characterGeneration ||
          meta.source !== clock.source ||
          meta.clockGeneration !== clock.generation ||
          meta.timeBase !== clock.base ||
          !Number.isFinite(meta.observedAt)
        )
          continue
        const data = value.data
        if (
          data.sourceActorId !== session.character?.actorId ||
          data.actionType !== 1 ||
          data.actionId === 7 ||
          data.actionId === 8
        )
          continue
        if (clock.now !== null && clock.now - meta.observedAt >= config.seconds * 1000) continue
        const key = `${data.sourceActorId}:${data.sequence}`
        if (seen.has(key)) continue
        seen.add(key)
        added.push({ key, id: data.actionId, at: meta.observedAt, name: String(data.actionId), gcd: false, icon: null })
      }
      if (added.length) {
        actions = [...actions, ...added]
        publish()
        for (const id of new Set(added.map((action) => action.id))) enrich(id)
      }
    })
    events = sub
    void sub.ready
      .then(() => {
        if (events !== sub || stopped) return
        inputError = null
        publish()
      })
      .catch((error) => {
        if (events === sub) unavailable(`动作输入不可用，等待自动重试：${String(error)}`)
      })
    void sub.closed.then(({ reason }) => {
      if (events === sub && !stopped) unavailable(`动作输入已中断，等待自动重试：${reason}`)
    })
  }
  function receive(next: SessionSnapshot) {
    const previous = session
    const changed =
      !previous ||
      previous.sessionId !== next.sessionId ||
      previous.characterGeneration !== next.characterGeneration ||
      previous.character?.actorId !== next.character?.actorId ||
      previous.clock.generation !== next.clock.generation ||
      previous.clock.base !== next.clock.base ||
      previous.clock.source !== next.clock.source ||
      previous.dataLanguage !== next.dataLanguage
    session = next
    if (changed) {
      events?.dispose()
      events = null
      clear()
      inputError = null
      const current = epoch
      version = ctx.data
        .version()
        .then((value) => {
          if (epoch === current && !stopped) {
            dataVersion = value
            resourceKey = `${current}:${value}:${next.dataLanguage}`
            publish()
          }
          return value
        })
        .catch(() => null)
      subscribeEvents()
    }
    if (changed || previous?.clock.paused !== next.clock.paused || previous?.state !== next.state) publish(true)
  }
  function subscribeSession() {
    const sub = ctx.session.subscribe((batch) => {
      if (sessionSub !== sub || stopped) return
      if (!batch.complete) {
        unavailable('会话输入不完整，等待自动重试')
        sub.dispose()
        sessionSub = null
        return
      }
      for (const value of batch.items) receive(value)
    })
    sessionSub = sub
    void sub.ready.catch((error) => {
      if (sessionSub !== sub || stopped) return
      sub.dispose()
      sessionSub = null
      unavailable(`会话输入不可用，等待自动重试：${String(error)}`)
    })
    void sub.closed.then(({ reason }) => {
      if (sessionSub !== sub || stopped) return
      sessionSub = null
      unavailable(`会话输入已中断，等待自动重试：${reason}`)
    })
  }
  disposers.push(
    await ctx.views.onCommand('display', async (input, view) => {
      if (!input || typeof input !== 'object' || Array.isArray(input) || input instanceof Uint8Array)
        throw new Error('Invalid command')
      if (input.type === 'settings' && view.placement === 'settings') {
        const next = settings(input.value)
        if (!next) throw new Error('Invalid settings')
        const save = saving.then(async () => {
          await ctx.config.set('display', next)
          if (!stopped) {
            config = next
            expire()
            publish(true)
          }
        })
        saving = save.catch(() => {})
        await save
        return next
      }
      if (input.type === 'icon' && typeof input.id === 'number' && Number.isSafeInteger(input.id) && input.id > 0) {
        const current = epoch
        const action = await info(input.id)
        if (stopped || current !== epoch || !action.icon) return null
        let request = icons.get(action.icon)
        if (!request) {
          const id = action.icon
          request = ctx.data
            .icon(id)
            .then((value) => {
              if (!value && current === epoch) icons.delete(id)
              return value
            })
            .catch((error) => {
              if (current === epoch) icons.delete(id)
              throw error
            })
          icons.set(id, request)
        }
        const icon = await request
        return !stopped && current === epoch ? (icon as unknown as Value) : null
      }
      throw new Error('Invalid command')
    }),
  )
  disposers.push(
    await ctx.ui.registerOverlay({
      id: 'display',
      name: 'SkillDisplay',
      entry: 'overlay.html',
      defaultSize: { width: 640, height: 144 },
    }),
  )
  disposers.push(
    await ctx.ui.registerFeature({
      id: 'settings',
      name: 'SkillDisplay',
      entry: 'settings.html',
      placement: 'settings',
    }),
  )
  subscribeSession()
  const calibration = setInterval(() => {
    expire()
    publish()
  }, 1000)
  const retryInputs = setInterval(() => {
    if (!sessionSub) {
      session = null
      subscribeSession()
    } else subscribeEvents()
    if (session?.state === 'idle' || !session) return
    const current = epoch
    void ctx.data
      .version()
      .then((value) => {
        if (stopped || current !== epoch || value === dataVersion) return
        dataVersion = value
        infos.clear()
        icons.clear()
        resourceKey = `${++epoch}:${value}:${session?.dataLanguage}`
        version = Promise.resolve(value)
        actions = actions.map((action) => ({ ...action, name: String(action.id), gcd: false, icon: null }))
        publish()
        for (const id of new Set(actions.map((action) => action.id))) enrich(id)
      })
      .catch((error) => ctx.log.debug('游戏资料版本暂不可用', { error: String(error) }))
  }, 10000)
  publish()
  return async () => {
    stopped = true
    ++epoch
    clearInterval(calibration)
    clearInterval(retryInputs)
    sessionSub?.dispose()
    events?.dispose()
    for (const dispose of disposers.reverse()) await dispose()
  }
}
