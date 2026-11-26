import type { Disposer, Json, PluginContext, SessionSnapshot, Subscription, Value } from '@ffcafe/mojito-plugin-sdk'
import { pluginError } from '@ffcafe/mojito-plugin-sdk/errors'
import {
  type OverlayCompatibility,
  type OverlayState,
  overlayProducer,
  overlayState,
} from '@ffcafe/mojito-plugin-sdk/overlayplugin'
import { fields, object } from '@ffcafe/mojito-plugin-sdk/schema'
import { maskOverlayIdentity } from './overlay-identity.js'

const service = 'ffcafe.combat-statistics/overlay'
export async function activateOverlay(
  ctx: PluginContext,
  definition: {
    id: string
    name: string
    protocol: OverlayCompatibility['protocol']
    entry: string
    documents: string[]
  },
  activity?: (publish: (custom: Json, immediate?: boolean) => void) => Disposer,
) {
  let live = true,
    revision = 0,
    queue = Promise.resolve()
  let subscription: Subscription | undefined
  let current: OverlayState | undefined, custom: Json | undefined
  let session: SessionSnapshot | undefined
  let hostMasked = false
  const canReadIdentity = () => ctx.capabilities.get()['identity.read']?.state === 'available'
  let identityAllowed = canReadIdentity()
  const disposers: Disposer[] = []
  const producer = overlayProducer(ctx.views, 'combat')
  let stopping: Promise<void> | undefined
  const stop = () => {
    if (stopping) return stopping
    live = false
    stopping = Promise.resolve().then(async () => {
      subscription?.dispose()
      for (const dispose of disposers.reverse()) await dispose()
      await queue
      if (!ctx.signal.aborted) {
        ctx.views.set('combat', null)
        await ctx.views.flush()
      }
    })
    return stopping
  }
  const publish = async (immediate = false) => {
    if (!current) return
    const allowed = canReadIdentity()
    const masked = hostMasked || !allowed
    const standIn = session?.capabilities['identity.read']?.state === 'denied' ? session.character?.actorId : null
    const state = masked && !hostMasked ? maskOverlayIdentity(current, standIn ?? null) : current
    const combatData = state.combatData
    const activity = allowed === identityAllowed ? custom : undefined
    const pageCustom =
      definition.id === 'ember' && masked && !combatData
        ? {
            ...(activity && typeof activity === 'object' && !Array.isArray(activity) ? activity : {}),
            clearCombatIdentity: true,
            clearPrimaryPlayer: state.primaryPlayer === null,
          }
        : activity
    await producer.publish({
      ...state,
      ...(definition.id === 'ember' && combatData
        ? {
            combatData: {
              ...combatData,
              Encounter: { ...combatData.Encounter, mojitoIdentity: masked ? 'masked' : 'visible' },
            },
          }
        : {}),
      ...(pageCustom === undefined ? {} : { custom: pageCustom }),
    })
    if (immediate) await ctx.views.flush()
  }
  const receive = (input: Value, refresh = false) => {
    const next = queue.then(async () => {
      if (!live || ctx.signal.aborted) return
      const value = object(input)
      fields(value, ['revision', 'state'])
      if (!Number.isSafeInteger(value.revision) || Number(value.revision) <= 0) throw pluginError('invalid_argument')
      const nextRevision = Number(value.revision)
      if (nextRevision < revision || (!refresh && nextRevision === revision)) return
      const { custom: providerCustom, ...state } = overlayState(value.state)
      hostMasked =
        providerCustom !== null &&
        typeof providerCustom === 'object' &&
        !Array.isArray(providerCustom) &&
        providerCustom.identityMasked === true
      current = state
      await publish(refresh)
      revision = nextRevision
    })
    queue = next.catch(() => {})
    return next
  }
  try {
    if (!(await ctx.services.connect(service, '^1.0.0'))) throw pluginError('unavailable', '请先安装并启用战斗统计')
    subscription = ctx.services.subscribe({ service, event: 'state' }, async (batch) => {
      for (const value of batch.items) await receive(value)
    })
    void subscription.closed
      .then(async ({ reason }) => {
        if (!live) return
        await stop()
        if (!ctx.signal.aborted) ctx.log.warn('战斗统计服务不可用，请修复依赖后重新启用', { reason })
      })
      .catch(() => {})
    await subscription.ready
    const sessionSub = ctx.session.subscribe(async (batch) => {
      session = batch.items.at(-1)
      const allowed = canReadIdentity()
      if (allowed === identityAllowed) return
      identityAllowed = allowed
      custom = undefined
      const update = queue.then(async () => {
        if (live && !ctx.signal.aborted) await publish(true)
      })
      queue = update.catch(() => {})
      await update
      try {
        const input = await ctx.services.request(service, 'getState', null)
        if (allowed === canReadIdentity()) await receive(input, true)
      } catch (error) {
        if (live && !ctx.signal.aborted) ctx.log.warn('悬浮窗身份状态刷新失败', { error: String(error) })
      }
    })
    disposers.push(() => sessionSub.dispose())
    await sessionSub.ready
    await receive(await ctx.services.request(service, 'getState', null))
    if (!live || ctx.signal.aborted) throw pluginError('cancelled')
    if (activity)
      disposers.push(
        activity((value, immediate) => {
          const allowed = canReadIdentity()
          queue = queue
            .then(async () => {
              if (!live || ctx.signal.aborted || allowed !== canReadIdentity()) return
              custom = value
              await publish(immediate)
            })
            .catch((error) => ctx.log.warn('悬浮窗活动更新失败', { error: String(error) }))
        }),
      )
    disposers.push(
      await producer.onEnd(async (encounterId) => {
        if (!live) throw pluginError('unavailable')
        const result = object(await ctx.services.request(service, 'endEncounter', { encounterId }))
        fields(result, ['result'])
        if (!['ended', 'alreadyEnded', 'staleEncounter', 'notFound'].includes(String(result.result)))
          throw pluginError('invalid_argument')
        return result.result as 'ended' | 'alreadyEnded' | 'staleEncounter' | 'notFound'
      }),
    )
    disposers.push(
      await ctx.ui.registerOverlay({
        id: definition.id,
        name: definition.name,
        defaultSize: { width: 600, height: 400 },
        compatibility: {
          kind: 'overlayplugin',
          protocol: definition.protocol,
          channel: 'combat',
          source: {
            kind: 'package',
            entry: definition.entry,
            documents: definition.documents,
          },
        },
      }),
    )
    return stop
  } catch (error) {
    await stop()
    throw error
  }
}
