import type {
  CombatantField,
  Disposer,
  Field,
  GameEvent,
  GameTopics,
  Json,
  PluginContext,
  SessionSnapshot,
  SourceMeta,
  Status,
  Subscription,
} from '@ffcafe/mojito-plugin-sdk'

const windowMs = 10000
const maxActions = 128
const fields: CombatantField[] = ['name', 'classJob', 'level', 'hpCur', 'hpMax', 'mpCur', 'mpMax', 'statuses']
type Party = { isInParty: boolean; members: { slot: number; id: number; name: string; ownParty: boolean }[] }
type Action = { key: string; actorId: number; actionId: number; at: number }
type ActiveStatus = {
  slot?: number
  statusId: number
  sourceActorId: number | null
  param: number
  expiresAt: number | null
}
const known = <T>(field?: Field<T>) => (field?.state === 'ok' ? field.value : undefined)

export function observeActivity(ctx: PluginContext, publish: (value: Json, immediate?: boolean) => void): Disposer {
  let current: SessionSnapshot | undefined
  let epoch = 0,
    active = true,
    party: Party | null = null
  let subscriptions: Subscription[] = [],
    entities: Subscription | undefined,
    timer: Disposer | undefined
  let actions: Action[] = []
  const actors = new Map<number, Record<string, Json>>()
  const statuses = new Map<number, ActiveStatus[]>()
  const tracked = new Set<number>()

  function matches(meta: SourceMeta) {
    const clock = ctx.clock.state()
    return (
      active &&
      current &&
      meta.sessionId === current.sessionId &&
      meta.characterGeneration === current.characterGeneration &&
      meta.source === clock.source &&
      meta.clockGeneration === clock.generation &&
      meta.timeBase === clock.base
    )
  }
  function send(immediate = false) {
    if (!active || ctx.signal.aborted) return
    const now = ctx.clock.now()
    actions = now === null ? [] : actions.filter(({ at }) => now - at < windowMs)
    for (const [id, items] of statuses) {
      if (tracked.has(id)) continue
      const visible = items.filter(
        (item) => isTrackedSource(item) && now !== null && item.expiresAt !== null && item.expiresAt > now,
      )
      if (visible.length) statuses.set(id, visible)
      else statuses.delete(id)
    }
    publish(
      {
        epoch,
        party,
        actors: [...actors.values()],
        actions: now === null ? [] : actions.map(({ at, ...action }) => ({ ...action, ageMs: Math.max(0, now - at) })),
        statuses: [...new Set([...tracked, ...statuses.keys()])].map((actorId) => ({
          actorId,
          items:
            statuses.get(actorId)?.map(({ expiresAt, ...status }) => ({
              ...status,
              remainingMs: expiresAt === null || now === null ? null : Math.max(0, expiresAt - now),
            })) ?? null,
        })),
      },
      immediate,
    )
    if (
      !timer &&
      (actions.length ||
        [...statuses.values()].some((items) =>
          items.some((item) => item.expiresAt !== null && now !== null && item.expiresAt > now),
        ))
    ) {
      timer = ctx.clock.setTimeout(() => {
        timer = undefined
        send()
      }, 200)
    }
  }
  function reset() {
    epoch++
    const stale = [...subscriptions, entities]
    subscriptions = []
    entities = undefined
    for (const sub of stale) sub?.dispose()
    void timer?.()
    timer = undefined
    actions = []
    party = null
    actors.clear()
    statuses.clear()
    tracked.clear()
  }
  function fail(sub: Subscription) {
    if (!active || (!subscriptions.includes(sub) && entities !== sub)) return
    reset()
    current = undefined
    send(true)
  }
  function watch(sub: Subscription) {
    void sub.ready.catch(() => fail(sub))
    void sub.closed.then(() => fail(sub))
    return sub
  }
  function buildStatus(status: Status, at: number | null, slot?: number): ActiveStatus {
    const { statusId, sourceActorId, param, durationMs } = status
    return {
      ...(slot === undefined ? {} : { slot }),
      statusId,
      sourceActorId,
      param,
      expiresAt:
        at !== null && durationMs !== null && Number.isFinite(durationMs) && durationMs >= 0 ? at + durationMs : null,
    }
  }
  function isTrackedSource(status: ActiveStatus) {
    return status.sourceActorId !== null && tracked.has(status.sourceActorId) && status.expiresAt !== null
  }
  function saveStatuses(actorId: number, items: ActiveStatus[]) {
    if (!tracked.has(actorId)) items = items.filter(isTrackedSource)
    if (items.length || tracked.has(actorId)) statuses.set(actorId, items)
    else statuses.delete(actorId)
  }
  function select(ids: number[]) {
    if (tracked.size === ids.length && ids.every((id) => tracked.has(id))) return
    const stale = entities
    entities = undefined
    stale?.dispose()
    tracked.clear()
    for (const id of ids) tracked.add(id)
    for (const id of actors.keys()) if (!tracked.has(id)) actors.delete(id)
    for (const [id, items] of statuses) saveStatuses(id, items)
    actions = actions.filter(({ actorId }) => tracked.has(actorId))
    if (!ids.length) return
    const sub = watch(
      ctx.game.subscribe(
        'entities',
        (batch) => {
          if (entities !== sub) return
          if (!batch.complete) return fail(sub)
          for (const { meta, value } of batch.items) {
            if (!matches(meta)) continue
            for (const entity of value.entities) {
              if (!tracked.has(entity.id)) continue
              const values: Record<string, Json> = { id: entity.id }
              for (const name of ['name', 'classJob', 'level', 'hpCur', 'hpMax', 'mpCur', 'mpMax'] as const) {
                const value = known(entity[name] as Field<string | number> | undefined)
                if (value !== undefined) values[name] = value
              }
              actors.set(entity.id, values)
              const initial = known(entity.statuses)
              if (!statuses.has(entity.id) && initial)
                statuses.set(
                  entity.id,
                  initial.map((s) => buildStatus(s, s.observedAt)),
                )
            }
            for (const id of value.missingIds) {
              actors.delete(id)
              statuses.delete(id)
            }
          }
          send()
        },
        { ids, fields },
      ),
    )
    entities = sub
  }
  function receiveParty(value: GameTopics['party']) {
    const isInParty = known(value.isInParty),
      members = known(value.members)
    const prior = party
    party =
      isInParty === false
        ? { isInParty, members: [] }
        : isInParty && members
          ? { isInParty, members: [...members].sort((a, b) => a.slot - b.slot) }
          : null
    if (!party) {
      send()
      return
    }
    const self = current?.character?.actorId
    select([
      ...new Set([
        ...(self == null ? [] : [self]),
        ...party.members.filter((member) => member.ownParty).map(({ id }) => id),
      ]),
    ])
    send(
      !prior ||
        prior.isInParty !== party.isInParty ||
        prior.members.length !== party.members.length ||
        party.members.some((member, index) => {
          const old = prior.members[index]
          return (
            member.id !== old.id ||
            member.slot !== old.slot ||
            member.ownParty !== old.ownParty ||
            member.name !== old.name
          )
        }),
    )
  }
  function receiveSlots(meta: SourceMeta, { data, packet }: GameEvent<'statusSlotsChanged'>) {
    const { actorId, slots, changes } = data
    if (actorId === null) return
    const previous = [...(statuses.get(actorId) ?? [])]
    for (const { slot, status } of slots) {
      const index = previous.findIndex(
        (item) =>
          item.slot === slot ||
          (item.slot === undefined &&
            item.statusId === status?.statusId &&
            item.sourceActorId === status.sourceActorId),
      )
      const prior = index < 0 ? undefined : previous.splice(index, 1)[0]
      if (!status) continue
      const details = changes.findLast((change) => change.slot === slot && change.kind === 'gained')?.status
      if (!details) {
        const same = prior?.statusId === status.statusId && prior.sourceActorId === status.sourceActorId
        previous.push({ ...status, slot, expiresAt: same ? prior.expiresAt : null })
        continue
      }
      const at =
        details.timeBase === meta.timeBase
          ? details.observedAt
          : packet
            ? meta.observedAt + details.observedAt - packet.timestamp
            : meta.observedAt
      previous.push(buildStatus(details, at, slot))
    }
    statuses.set(
      actorId,
      previous.sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0)),
    )
  }

  function start(next: SessionSnapshot) {
    if (!active) return
    const old = current
    current = next
    if (
      old &&
      old.state === next.state &&
      old.sessionId === next.sessionId &&
      old.characterGeneration === next.characterGeneration &&
      old.character?.actorId === next.character?.actorId &&
      old.clock.generation === next.clock.generation &&
      old.capabilities['identity.read']?.state === next.capabilities['identity.read']?.state &&
      old.capabilities['events.read']?.state === next.capabilities['events.read']?.state &&
      old.capabilities['game.read']?.state === next.capabilities['game.read']?.state
    )
      return
    reset()
    send(true)
    if (next.state === 'idle' || next.character?.actorId == null) return
    select([next.character.actorId])
    const partySub = watch(
      ctx.game.subscribe('party', (batch) => {
        if (!subscriptions.includes(partySub)) return
        if (!batch.complete) return fail(partySub)
        for (const { meta, value } of batch.items) if (matches(meta)) receiveParty(value)
      }),
    )
    subscriptions.push(partySub)
    const eventSub = watch(
      ctx.events.subscribe(['actionEffect', 'statusesReplaced', 'statusSlotsChanged'], (batch) => {
        if (!subscriptions.includes(eventSub)) return
        if (!batch.complete) return fail(eventSub)
        for (const { meta, value } of batch.items) {
          if (!matches(meta)) continue
          if (value.type === 'statusSlotsChanged') receiveSlots(meta, value)
          else if (value.type === 'statusesReplaced') {
            const { actorId, statuses: items } = value.data
            if (actorId !== null)
              saveStatuses(
                actorId,
                items.map((s) => buildStatus(s, s.observedAt, s.slot)),
              )
          } else {
            const { sourceActorId, sequence, actionId, actionType } = value.data
            if (
              sourceActorId === null ||
              !tracked.has(sourceActorId) ||
              actionType !== 1 ||
              !Number.isFinite(meta.observedAt)
            )
              continue
            const now = ctx.clock.now()
            if (now === null || now - meta.observedAt >= windowMs) continue
            const key = `${sourceActorId}:${sequence}`
            if (!actions.some((item) => item.key === key)) {
              actions.push({ key, actorId: sourceActorId, actionId, at: meta.observedAt })
              if (actions.length > maxActions) actions.shift()
            }
          }
        }
        send()
      }),
    )
    subscriptions.push(eventSub)
  }
  const session = ctx.session.subscribe((batch) => {
    if (!active) return
    if (!batch.complete) {
      reset()
      current = undefined
      send(true)
      return
    }
    for (const next of batch.items) start(next)
  })
  function loseSession() {
    if (!active) return
    reset()
    current = undefined
    send(true)
  }
  void session.ready.catch(loseSession)
  void session.closed.then(loseSession)
  return () => {
    active = false
    session.dispose()
    reset()
  }
}
