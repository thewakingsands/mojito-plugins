import type { DataService, MemoryObservation, Observation, Sample } from '@ffcafe/mojito-plugin-sdk'
import { Actors, Names, value } from './actors.js'
import { chatText } from './chat.js'
import { hex, type LogRow } from './format.js'
import { packetRows, type Row, type State } from './packets.js'

export class LogObservations implements State {
  readonly actors = new Actors()
  readonly marks = new Set<number>()
  player: number | null = null
  contentId?: bigint
  stats?: string
  private lookup?: Names
  private initialPlayerName?: string
  private primaryKey?: string
  private territory?: number
  private mapId?: number
  private partyKey?: string
  private initialParty?: Extract<MemoryObservation, { kind: 'party' }>
  private initialZone?: Extract<MemoryObservation, { kind: 'zone' }>
  constructor(private data: DataService) {}
  get names() {
    if (!this.lookup) throw new Error('Missing initial session')
    return this.lookup
  }
  async zone(id: number): Promise<Row[]> {
    if (this.territory !== undefined) {
      this.marks.clear()
      this.actors.reset()
      this.mapId = undefined
      this.partyKey = undefined
    }
    this.territory = id
    return [{ type: 1, fields: [hex(id, 2), await this.names.name('territoryType', id)] }]
  }
  primary(id: number, name: string): Row[] {
    this.player = id
    const key = `${id}|${name}`
    if (!name || key === this.primaryKey) return []
    this.primaryKey = key
    return [{ type: 2, fields: [hex(id, 4), name] }]
  }
  private async memory(m: MemoryObservation): Promise<Row[]> {
    switch (m.kind) {
      case 'combatant': {
        const { id } = m.combatant,
          before = this.actors.get(id)
        const present = this.actors.present.has(id)
        this.actors.observe(m.combatant)
        this.actors.present.add(id)
        const a = this.actors.get(id),
          rows: Row[] = []
        if (!present || before.name !== a.name) {
          rows.push({ type: 3, fields: await this.names.combatant(id, a) })
        }
        if (id === this.player && a.name) rows.push(...this.primary(id, a.name))
        return rows
      }
      case 'combatantRemove': {
        const id = m.actorId,
          wasPresent = this.actors.present.has(id),
          actor = this.actors.get(id)
        this.actors.forget(id)
        return wasPresent ? [{ type: 4, fields: await this.names.combatant(id, actor) }] : []
      }
      case 'player': {
        this.contentId = value(m.player.contentId) ?? this.contentId
        const id = value(m.player.actorId)
        if (id === undefined || id === null) return []
        return this.primary(id, value(m.player.name) ?? this.actors.get(id).name ?? '')
      }
      case 'party': {
        const members = m.memberIds
        const key = [m.memberCount, ...members].join('|')
        if (key === this.partyKey) return []
        this.partyKey = key
        return [{ type: 11, fields: [m.memberCount, ...members.map((id) => hex(id, 4))] }]
      }
      case 'zone': {
        const map = value(m.mapId)
        const rows: Row[] = []
        if (map !== undefined && map !== this.mapId) {
          this.mapId = map
          if (map) rows.push({ type: 40, fields: [map, ...(await this.names.map(map))] })
        }
        return rows
      }
    }
  }
  async consume({ value: item, meta }: Sample<Observation>): Promise<LogRow[]> {
    let timestamp = meta.observedAt
    let rows: Row[] = []
    switch (item.kind) {
      case 'snapshotStart':
        this.lookup = new Names(this.data, item.source.dataLanguage ?? item.source.uiLanguage)
        this.player = item.source.character?.actorId ?? null
        this.contentId = item.source.character?.contentId ?? undefined
        break
      case 'snapshotCombatant':
        this.actors.observe(item.combatant)
        if (item.presentInMemory) this.actors.present.add(item.combatant.id)
        break
      case 'snapshotParty': {
        const party = value(item.party)
        if (party) this.initialParty = { kind: 'party', ...party }
        break
      }
      case 'snapshotZone':
        this.initialZone = { kind: 'zone', territoryType: item.territoryType, mapId: item.mapId }
        break
      case 'snapshotPlayer':
        this.initialPlayerName = value(item.player.name)
        this.player = value(item.player.actorId) ?? this.player
        this.contentId = value(item.player.contentId) ?? this.contentId
        break
      case 'snapshotEnd':
        if (this.initialZone) {
          const territory = value(this.initialZone.territoryType)
          if (territory !== undefined) rows.push(...(await this.zone(territory)))
          rows.push(...(await this.memory(this.initialZone)))
        }
        if (this.player !== null)
          rows.push(...this.primary(this.player, this.initialPlayerName ?? this.actors.get(this.player).name ?? ''))
        for (const id of this.actors.present)
          rows.push({ type: 3, fields: await this.names.combatant(id, this.actors.get(id)) })
        if (this.initialParty) rows.push(...(await this.memory(this.initialParty)))
        this.initialZone = undefined
        this.initialPlayerName = undefined
        this.initialParty = undefined
        break
      case 'packet':
        timestamp = item.packet.timestamp
        rows = await packetRows(this, item.packet)
        break
      case 'memory':
        rows = await this.memory(item.memory)
        break
      case 'event': {
        const e = item.event
        if (e.type === 'gameLog') {
          timestamp = e.data.time * 1000
          rows = [{ type: 0, fields: [hex(e.data.code, 4), chatText(e.data.sender), chatText(e.data.message)] }]
        } else if (e.type === 'statusSlotsChanged') {
          timestamp = e.packet?.timestamp ?? meta.observedAt
          const id = e.data.actorId
          const actor = this.actors.get(id)
          for (const change of e.data.changes) {
            const buff = change.status
            if (!buff) throw new Error('Missing status details from host')
            const lost = change.kind === 'lost',
              source = this.actors.get(buff.sourceActorId)
            rows.push({
              type: lost ? 30 : 26,
              fields: [
                hex(buff.statusId, 2),
                await this.names.name('status', buff.statusId),
                lost ? '0.00' : ((buff.durationMs ?? 0) / 1000).toFixed(2),
                hex(buff.sourceActorId ?? 0, 4),
                source.name ?? '',
                hex(id ?? 0, 4),
                actor.name ?? '',
                hex(buff.param, 2),
                actor.hpMax ?? '',
                source.hpMax ?? '',
              ],
            })
          }
        }
        break
      }
    }
    return rows.map((r) => ({ ...r, timestamp }))
  }
}
