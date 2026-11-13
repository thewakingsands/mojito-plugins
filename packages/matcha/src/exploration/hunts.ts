// Copyright (c) FFCafe. Licensed under AGPL-3.0-only.
import type { CombatantState, PlayerState } from '@ffcafe/mojito-plugin-sdk'
import { fieldValue, finitePosition, freshField, guidance, observedPlayerPosition, project } from './coordinates.js'
import type { ExplorationCatalog, ExplorationContext, HuntEntry, HuntState, WorldPosition } from './types.js'

interface Observation {
  entry: HuntEntry
  world: WorldPosition | null
  deathAt: number | null
  aliveAt: number | null
}
export class HuntTracker {
  private readonly observations = new Map<number, Observation>()
  reset(): void {
    this.observations.clear()
  }
  update(
    context: ExplorationContext,
    catalog: ExplorationCatalog | null,
    entities: CombatantState[] | null,
    player: PlayerState | null,
    boundaryAt: number | null,
  ): HuntState {
    const mapId = context.territoryId === null ? null : (catalog?.territoryMaps[context.territoryId] ?? null)
    const result: HuntState = { context, status: 'ready', reason: null, mapId, entries: [] }
    if (!catalog || context.territoryId === null)
      return { ...result, status: 'waiting', reason: '等待客户端资料和当前区域' }
    if (!catalog.huntsAvailable) return { ...result, status: 'unavailable', reason: '狩猎目录不可用' }
    if (entities === null || context.clock.now === null) {
      result.status = 'unavailable'
      result.reason = '狩猎观察数据中断'
    }
    const map = mapId === null ? undefined : catalog.maps[mapId]
    const current = new Set<number>()
    const playerPosition = observedPlayerPosition(player, context, boundaryAt)
    for (const entity of entities ?? []) {
      const objectKind = fieldValue(entity.objectKind)
      if (objectKind !== 2) {
        if (objectKind !== null) this.observations.delete(entity.id)
        continue
      }
      const base = fieldValue(entity.bNpcBase),
        name = fieldValue(entity.bNpcName)
      const previous = this.observations.get(entity.id)
      if (
        previous &&
        base !== null &&
        name !== null &&
        (previous.entry.bNpcBase !== base || previous.entry.bNpcName !== name)
      )
        this.observations.delete(entity.id)
      const definition = catalog.hunts.find((h) => h.bNpcBase === base && h.bNpcName === name)
      if (!definition) continue
      current.add(entity.id)
      let record = this.observations.get(entity.id)
      if (!record) {
        record = {
          entry: {
            actorId: entity.id,
            ...definition,
            state: 'position-unknown',
            position: null,
            lastObservedAt: null,
            hpPercent: null,
            distanceM: null,
            heightDifferenceM: null,
          },
          world: null,
          deathAt: null,
          aliveAt: null,
        }
        this.observations.set(entity.id, record)
      }
      const position = freshField(entity.position, context, boundaryAt)
      const hp = freshField(entity.hpCur, context, boundaryAt),
        maxHp = freshField(entity.hpMax, context, boundaryAt)
      const entry = record.entry
      const lastHpAt = Math.max(record.aliveAt ?? -Infinity, record.deathAt ?? -Infinity)
      entry.hpPercent =
        hp &&
        hp.observedAt >= lastHpAt &&
        maxHp &&
        Number.isFinite(hp.value) &&
        Number.isFinite(maxHp.value) &&
        hp.value >= 0 &&
        maxHp.value > 0
          ? Math.min(100, (hp.value / maxHp.value) * 100)
          : null
      if (hp && Number.isFinite(hp.value) && hp.value >= 0) {
        if (
          hp.value === 0 &&
          (record.deathAt === null || hp.observedAt > record.deathAt) &&
          (record.aliveAt === null || hp.observedAt >= record.aliveAt)
        )
          record.deathAt = hp.observedAt
        if (hp.value > 0 && (record.aliveAt === null || hp.observedAt > record.aliveAt)) record.aliveAt = hp.observedAt
      }
      if (
        position &&
        finitePosition(position.value) &&
        (entry.lastObservedAt === null || position.observedAt >= entry.lastObservedAt)
      ) {
        record.world = position.value
        entry.lastObservedAt = position.observedAt
        entry.position = map ? project(position.value, map) : null
      }
      const dead = record.deathAt !== null && (record.aliveAt === null || record.aliveAt <= record.deathAt)
      entry.state = dead
        ? 'ended'
        : position && finitePosition(position.value)
          ? 'observed'
          : entry.lastObservedAt === null
            ? 'position-unknown'
            : 'last-seen'
    }
    for (const [id, record] of this.observations) {
      const entry = record.entry
      if (!current.has(id)) {
        if (entry.state !== 'ended') entry.state = entry.lastObservedAt === null ? 'position-unknown' : 'last-seen'
        entry.hpPercent = null
      }
      entry.distanceM = null
      entry.heightDifferenceM = null
      if (entry.state === 'observed' && playerPosition && finitePosition(playerPosition.value) && record.world) {
        const distance = guidance(playerPosition.value, record.world, null)
        entry.distanceM = distance.distanceM
        entry.heightDifferenceM = distance.heightDifferenceM
      }
      result.entries.push({ ...entry })
    }
    return result
  }
}
