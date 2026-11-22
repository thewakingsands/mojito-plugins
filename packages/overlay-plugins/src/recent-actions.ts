import type { GameEvent, PluginContext, SessionSnapshot, SourceMeta } from '@ffcafe/mojito-plugin-sdk'

const windowMs = 10000
const maxActions = 128
export type RecentAction = { key: string; actorId: number; actionId: number; at: number }

export function matchesActivitySource(ctx: PluginContext, session: SessionSnapshot | undefined, meta: SourceMeta) {
  const clock = ctx.clock.state()
  return (
    session !== undefined &&
    meta.sessionId === session.sessionId &&
    meta.characterGeneration === session.characterGeneration &&
    meta.source === clock.source &&
    meta.clockGeneration === clock.generation &&
    meta.timeBase === clock.base
  )
}

export function sameActivitySource(current: SessionSnapshot, next: SessionSnapshot) {
  return (
    current.state === next.state &&
    current.sessionId === next.sessionId &&
    current.characterGeneration === next.characterGeneration &&
    current.character?.actorId === next.character?.actorId &&
    current.clock.generation === next.clock.generation &&
    current.capabilities['identity.read']?.state === next.capabilities['identity.read']?.state &&
    current.capabilities['events.read']?.state === next.capabilities['events.read']?.state &&
    current.capabilities['game.read']?.state === next.capabilities['game.read']?.state
  )
}

export function addRecentAction(
  actions: RecentAction[],
  { sourceActorId, sequence, actionId, actionType }: GameEvent<'actionEffect'>['data'],
  at: number,
  now: number | null,
) {
  if (sourceActorId === null || actionType !== 1 || !Number.isFinite(at) || now === null || now - at >= windowMs) return
  const key = `${sourceActorId}:${sequence}`
  if (actions.some((action) => action.key === key)) return
  actions.push({ key, actorId: sourceActorId, actionId, at })
  if (actions.length > maxActions) actions.shift()
}

export function pruneRecentActions(actions: RecentAction[], now: number | null) {
  return now === null ? [] : actions.filter(({ at }) => now - at < windowMs)
}

export function recentActionFrame(actions: RecentAction[], now: number | null, publishedAt = Date.now()) {
  return {
    publishedAt,
    actions: now === null ? [] : actions.map(({ at, ...action }) => ({ ...action, ageMs: Math.max(0, now - at) })),
  }
}
