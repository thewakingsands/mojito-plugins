import type { CombatantState, Field, GameEvent, Sample, SourceMeta, Status } from '@ffcafe/mojito-plugin-sdk'
import type { Fields, StructuredEvent } from './matcher'

export const eventTypes = [
  'castStarted',
  'castCancelled',
  'actionEffect',
  'statusesReplaced',
  'statusChanged',
  'actorControl',
  'zoneChanged',
  'playerCombatChanged',
  'actorMoved',
  'actorPositionSet',
  'mapEffect',
  'npcSpawn',
  'nameplateChanged',
  'npcYell',
  'battleTalk',
  'systemLogMessage',
  'countdownStarted',
  'countdownCancelled',
  'actorDied',
  'hpChanged',
  'targetableChanged',
] as const
export const hex = (value: number | null | undefined, width = 1): string | undefined =>
  value == null ? undefined : value.toString(16).toUpperCase().padStart(width, '0')
export class EntityCache {
  private statuses = new Map<number, Map<number, Status>>()
  private entities = new Map<number, CombatantState>()
  clear(): void {
    this.entities.clear()
    this.statuses.clear()
  }
  observe(entity: CombatantState): void {
    this.entities.set(entity.id, entity)
  }
  remove(id: number): void {
    this.entities.delete(id)
    this.statuses.delete(id)
  }
  get(id: number | null): CombatantState | undefined {
    return id === null ? undefined : this.entities.get(id)
  }
  field<T>(field: Field<T> | undefined): T | undefined {
    return field?.state === 'ok' ? field.value : undefined
  }
  snapshot(next: CombatantState[], meta: SourceMeta): StructuredEvent[] {
    const result: StructuredEvent[] = []
    const fields = (entity: CombatantState): Fields => {
      const get = <T>(value: Field<T> | undefined) => this.field(value)
      const position = get(entity.position)
      return {
        id: hex(entity.id, 8),
        name: get(entity.name),
        ownerId: hex(get(entity.ownerId), 8),
        job: hex(get(entity.classJob), 2),
        level: hex(get(entity.level), 2),
        worldId: hex(get(entity.homeWorldId), 2),
        npcBaseId: get(entity.bNpcBase)?.toString(),
        npcNameId: get(entity.bNpcName)?.toString(),
        x: position?.x.toString(),
        y: position?.z.toString(),
        z: position?.y.toString(),
        heading: get(entity.rotation)?.toString(),
      }
    }
    const pairs = (entity: CombatantState): Fields => {
      const get = <T>(value: Field<T> | undefined) => this.field(value)
      const position = get(entity.position),
        cast = get(entity.cast)
      const values: Record<string, unknown> = {
        Name: get(entity.name),
        Job: get(entity.classJob),
        Level: get(entity.level),
        CurrentHP: get(entity.hpCur),
        MaxHP: get(entity.hpMax),
        CurrentMP: get(entity.mpCur),
        MaxMP: get(entity.mpMax),
        PosX: position?.x,
        PosY: position?.z,
        PosZ: position?.y,
        Heading: get(entity.rotation),
        BNpcID: hex(get(entity.bNpcBase)),
        BNpcNameID: hex(get(entity.bNpcName)),
        WeaponId: get(entity.weaponId),
        ModelStatus: get(entity.modelStatus),
        IsCasting1: cast === undefined ? undefined : cast === null ? '0' : '1',
        CastBuffID: cast?.actionId,
      }
      return Object.fromEntries(
        Object.entries(values)
          .filter(([, value]) => value !== undefined)
          .map(([key, value]) => [`pair${key}`, String(value)]),
      )
    }
    const ids = new Set(next.map((entity) => entity.id))
    for (const [id, previous] of this.entities)
      if (!ids.has(id)) {
        result.push(
          { type: 'RemovedCombatant', fields: fields(previous) },
          { type: 'CombatantMemory', fields: { change: 'Remove', id: hex(id, 8) } },
        )
        this.remove(id)
      }
    for (const entity of next) {
      const previous = this.get(entity.id),
        values = pairs(entity),
        before = previous ? pairs(previous) : {}
      const changed = Object.fromEntries(Object.entries(values).filter(([key, value]) => before[key] !== value))
      this.observe(entity)
      if (!previous) result.push({ type: 'AddedCombatant', fields: fields(entity) })
      if (!previous || Object.keys(changed).length)
        result.push({
          type: 'CombatantMemory',
          fields: { change: previous ? 'Change' : 'Add', id: hex(entity.id, 8), ...changed },
        })
    }
    return result.map((event) => ({
      ...event,
      fields: { timestamp: new Date(meta.observedAt).toISOString(), ...event.fields },
    }))
  }
  updateStatuses(sample: Sample<GameEvent<'statusesReplaced' | 'statusChanged'>>): StructuredEvent[] {
    const { value: event } = sample
    const id = event.data.actorId
    if (id === null) return []
    const saved = this.statuses.get(id) ?? new Map<number, Status>()
    this.statuses.set(id, saved)
    const changes =
      event.type === 'statusesReplaced'
        ? new Map<number, Status | null>([...saved.keys()].map((slot) => [slot, null]))
        : new Map<number, Status | null>()
    if (event.type === 'statusesReplaced') {
      for (const status of event.data.statuses) {
        if (status.slot === undefined)
          throw new Error('Host did not provide status-list slots; Plugin API 1.7.0 is required')
        changes.set(status.slot, status)
      }
    } else changes.set(event.data.slot, event.data.status)
    const result: StructuredEvent[] = []
    const output = (type: string, status: Status) =>
      result.push({
        type,
        fields: {
          sourceId: hex(status.sourceActorId, 8),
          source: this.name(status.sourceActorId),
          targetId: hex(id, 8),
          target: this.name(id),
          effectId: hex(status.statusId, 3),
          count: hex(status.param, 2),
          duration: status.durationMs === null ? undefined : String(status.durationMs / 1000),
        },
      })
    for (const [slot, incoming] of changes) {
      const previous = saved.get(slot)
      if (!incoming) {
        if (previous) {
          output('LosesEffect', previous)
          saved.delete(slot)
        }
        continue
      }
      const same =
        previous &&
        previous.statusId === incoming.statusId &&
        (incoming.sourceActorId === null || incoming.sourceActorId === previous.sourceActorId)
      const status =
        same && incoming.sourceActorId === null
          ? {
              ...incoming,
              sourceActorId: previous.sourceActorId,
              ...(incoming.durationMs === null
                ? { durationMs: previous.durationMs, observedAt: previous.observedAt }
                : {}),
            }
          : incoming
      const refreshed =
        previous &&
        status.durationMs !== null &&
        status.durationMs !== 0 &&
        previous.durationMs !== null &&
        Math.abs(status.observedAt + status.durationMs - previous.observedAt - previous.durationMs) > 2000
      if (!same && previous) output('LosesEffect', previous)
      if (!same || refreshed || status.param !== previous?.param) {
        saved.set(slot, status)
        output('GainsEffect', status)
      }
    }
    return result
  }
  name(id: number | null): string | undefined {
    return this.field(this.get(id)?.name)
  }
}

function projectEventBody(sample: Sample<GameEvent>, entities: EntityCache): StructuredEvent[] {
  const { value: event, meta } = sample
  const actors = (source: number | null, target: number | null): Fields => ({
    sourceId: hex(source, 8),
    source: entities.name(source),
    targetId: hex(target, 8),
    target: entities.name(target),
  })
  const space = (
    position: Field<{ x: number; y: number; z: number }>,
    rotation?: Field<number>,
    prefix = '',
  ): Fields => {
    const value = entities.field(position),
      heading = entities.field(rotation)
    return {
      [`${prefix}${prefix ? 'X' : 'x'}`]: value?.x.toString(),
      [`${prefix}${prefix ? 'Y' : 'y'}`]: value?.z.toString(),
      [`${prefix}${prefix ? 'Z' : 'z'}`]: value?.y.toString(),
      [`${prefix}${prefix ? 'Heading' : 'heading'}`]: heading?.toString(),
    }
  }
  switch (event.type) {
    case 'statusesReplaced':
    case 'statusChanged':
      return entities.updateStatuses({ meta, value: event })
    case 'castStarted':
      return [
        {
          type: 'StartsUsing',
          fields: {
            ...actors(event.data.casterId, event.data.targetId),
            id: hex(event.data.actionId, 4),
            castTime: String(event.data.durationMs / 1000),
            ...space(event.data.sourcePosition, event.data.sourceRotation),
          },
        },
        {
          type: 'StartsUsingExtra',
          fields: {
            sourceId: hex(event.data.casterId, 8),
            id: hex(event.data.actionId, 4),
            ...space(event.data.castPosition, event.data.castRotation),
          },
        },
      ]
    case 'castCancelled':
      return ['AbilityCancel', 'NetworkCancelAbility'].map((type) => ({
        type,
        fields: { ...actors(event.data.casterId, null), id: hex(event.data.actionId, 4) },
      }))
    case 'actionEffect': {
      const events: StructuredEvent[] = event.data.targets.map((target) => ({
        type: 'Ability',
        fields: {
          ...actors(event.data.sourceActorId, target.targetId),
          id: hex(event.data.actionId, 4),
          sequence: hex(event.data.sequence, 8),
          targetIndex: hex(target.targetIndex),
          ...space(event.data.sourcePosition, event.data.sourceRotation),
          ...space(target.targetPosition, undefined, 'target'),
        },
      }))
      if (event.data.isAoe) events.push(...events.map((event) => ({ ...event, type: 'NetworkAOEAbility' })))
      events.push({
        type: 'AbilityExtra',
        fields: {
          sourceId: hex(event.data.sourceActorId, 8),
          id: hex(event.data.actionId, 4),
          globalEffectCounter: hex(event.data.sequence, 8),
          dataFlag: hex(event.data.dataFlag),
          animationTargetId: hex(event.data.animationTargetId, 8),
          ...space(event.data.effectPosition, event.data.effectRotation),
        },
      })
      return events
    }
    case 'systemLogMessage':
      return [
        {
          type: 'SystemLogMessage',
          fields: {
            instance: hex(event.data.instance, 8),
            id: hex(event.data.messageId),
            ...Object.fromEntries(event.data.params.map((value, i) => [`param${i}`, hex(value)])),
          },
        },
      ]
    case 'hpChanged':
      return event.data.origin === 'effectResult'
        ? [
            {
              type: 'NetworkEffectResult',
              fields: {
                id: hex(event.data.actorId, 8),
                name: entities.name(event.data.actorId),
                sequenceId: hex(event.data.sequence, 8),
                currentHp: String(event.data.hpCur),
                maxHp: event.data.hpMax === null ? undefined : String(event.data.hpMax),
              },
            },
          ]
        : []
    case 'actorControl': {
      const p = event.data.params
      if (event.data.category === 34)
        return [
          {
            type: 'HeadMarker',
            fields: {
              targetId: hex(event.data.actorId, 8),
              target: entities.name(event.data.actorId),
              id: hex(p[0], 4),
              data0: hex(p[1], 8),
            },
          },
        ]
      if (event.data.category === 35)
        return [{ type: 'Tether', fields: { ...actors(event.data.actorId, p[2] ?? null), id: hex(p[1], 4) } }]
      if (event.data.self && event.data.category === 109)
        return [
          {
            type: 'ActorControl',
            fields: {
              instance: hex(p[0], 8),
              command: hex(p[1], 8),
              data0: hex(p[2], 8),
              data1: hex(p[3], 8),
              data2: hex(p[4], 8),
              data3: hex(p[5], 8),
            },
          },
        ]
      return [
        {
          type: event.data.self ? 'ActorControlSelfExtra' : 'ActorControlExtra',
          fields: {
            id: hex(event.data.actorId, 8),
            category: hex(event.data.category, 4),
            ...Object.fromEntries(p.map((value, i) => [`param${i + 1}`, hex(value, 8)])),
          },
        },
      ]
    }
    case 'npcSpawn':
      return [
        {
          type: 'SpawnNpcExtra',
          fields: {
            id: hex(event.data.actorId, 8),
            parentId: hex(event.data.parentId, 8),
            tetherId: hex(event.data.tetherId, 4),
            animationState: hex(event.data.animationState, 2),
          },
        },
      ]
    case 'mapEffect':
      return [
        {
          type: 'MapEffect',
          fields: {
            instance: hex(event.data.directorId, 8),
            flags: hex(event.data.state, 8),
            location: hex(event.data.index, 2),
          },
        },
      ]
    case 'actorMoved':
    case 'actorPositionSet':
      return [
        {
          type: event.type === 'actorMoved' ? 'ActorMove' : 'ActorSetPos',
          fields: {
            id: hex(event.data.actorId, 8),
            x: String(event.data.position.x),
            y: String(event.data.position.z),
            z: String(event.data.position.y),
            heading: String(event.data.rotation),
            ...('moveType' in event.data ? { moveType: hex(event.data.moveType, 2) } : {}),
          },
        },
      ]
    case 'npcYell':
      return [
        {
          type: 'NpcYell',
          fields: {
            npcId: hex(event.data.npcId, 8),
            npcNameId: hex(event.data.npcNameId, 4),
            npcYellId: hex(event.data.npcYellId, 4),
          },
        },
      ]
    case 'battleTalk':
      return [
        {
          type: 'BattleTalk2',
          fields: {
            npcId: hex(event.data.npcId, 8),
            npcNameId: hex(event.data.npcNameId, 4),
            instanceContentTextId: hex(event.data.instanceContentTextId, 4),
          },
        },
      ]
    case 'nameplateChanged':
      return [
        { type: 'NameToggle', fields: { id: hex(event.data.actorId, 8), toggle: event.data.visible ? '01' : '00' } },
      ]
    case 'countdownStarted':
      return [
        {
          type: 'Countdown',
          fields: {
            id: hex(event.data.actorId, 8),
            worldId: hex(event.data.worldId, 4),
            name: event.data.name,
            time: String(event.data.durationMs / 1000),
          },
        },
      ]
    case 'countdownCancelled':
      return [
        {
          type: 'CountdownCancel',
          fields: { id: hex(event.data.actorId, 8), worldId: hex(event.data.worldId, 4), name: event.data.name },
        },
      ]
    case 'actorDied':
      return [{ type: 'WasDefeated', fields: actors(event.data.actorId, event.data.causedByActorId) }]
    case 'playerCombatChanged':
      return [{ type: 'InCombat', fields: { inGameCombat: event.data.inCombat ? '1' : '0' } }]
    case 'zoneChanged':
      return [{ type: 'ChangeZone', fields: { id: hex(event.data.territoryTypeId) } }]
    default:
      return []
  }
}

export function projectEvent(sample: Sample<GameEvent>, entities: EntityCache): StructuredEvent[] {
  const projected = projectEventBody(sample, entities)
  const value = sample.value
  if (
    value.type === 'actorControl' &&
    !projected.some((event) => event.type === 'ActorControlExtra' || event.type === 'ActorControlSelfExtra')
  ) {
    projected.push({
      type: value.data.self ? 'ActorControlSelfExtra' : 'ActorControlExtra',
      fields: {
        id: hex(value.data.actorId, 8),
        category: hex(value.data.category, 4),
        ...Object.fromEntries(value.data.params.map((param, index) => [`param${index + 1}`, hex(param, 8)])),
      },
    })
  }
  return projected.map((event) => ({
    ...event,
    fields: { timestamp: new Date(sample.meta.observedAt).toISOString(), ...event.fields },
  }))
}
