import { Encounters } from '../encounters.js'
import { Identities, value } from '../identity.js'
import type { LedgerEntry } from '../ledger.js'
import type { Actor, Summary } from '../model.js'
import type { LogRecord } from './types.js'

// Review-only events never reach Encounters in the plugin; feeding them would move its packet sequence.
const REVIEW = new Set([
  'castStarted',
  'castCancelled',
  'statusChanged',
  'statusesReplaced',
  'targetableChanged',
  'cutsceneChanged',
  'potencySample',
])

/** What the fight review watches while a visit is replayed */
export interface ReplayObservers {
  /** After each record; fightId is the fight the record belongs to, a fightEnd still to the fight it ends */
  record?(record: LogRecord, state: { fightId: string | null; actors: ReadonlyMap<number, Actor> }): void
  /** Each amount the ledger of a fight books */
  ledger?(fightId: string, entry: LedgerEntry): void
}

/**
 * Replays one visit through the statistics code the way entry.ts feeds it, and returns the final Summary of every
 * fight, each with the id the log gives it. Fights end where the log says; an end the replay cannot reproduce at that
 * point throws.
 */
export async function replay(
  records: AsyncIterable<LogRecord> | Iterable<LogRecord>,
  observers: ReplayObservers = {},
): Promise<Summary[]> {
  let serial = 0
  // A fightStart note is written right before the input that opens the fight, so that fight takes its id.
  let next: string | null = null
  const encounters = new Encounters(
    () => {
      const id = next ?? `replay-${++serial}`
      next = null
      return id
    },
    () => {},
    undefined,
    observers.ledger?.bind(observers),
  )
  let identities = null as Identities | null
  let members = new Set<number>(),
    party: { id: number; ownParty: boolean }[] = [],
    partyKnown = false,
    snapshot = false
  const allPlayers = () => encounters.config.scope === 'all'
  const scopeMembers = () => {
    members = new Set(
      party.filter((member) => encounters.config.scope !== 'party' || member.ownParty).map((member) => member.id),
    )
    if (encounters.localActorId !== null) members.add(encounters.localActorId)
  }
  const none: ReadonlyMap<number, Actor> = new Map()
  for await (const record of records) {
    switch (record.kind) {
      case 'visitStart':
        snapshot = true
        break
      case 'source': {
        const key = `${record.value.sessionId}:${record.value.characterGeneration}:${record.value.clockGeneration}`
        if (identities?.source !== key) {
          identities = new Identities(key)
          encounters.source = key
          encounters.localActorId = null
          members = new Set()
          party = []
          partyKnown = false
        }
        if (record.value.actorId !== null) {
          encounters.localActorId = record.value.actorId
          members.add(record.value.actorId)
        }
        break
      }
      case 'settings': {
        const { mode, ...value } = record.value
        encounters.config = value
        encounters.manual = mode === 'manual'
        scopeMembers()
        if (identities && !snapshot) {
          identities.classify(members, allPlayers())
          encounters.updateActors(identities.actors)
        }
        break
      }
      case 'carry':
        encounters.restore(record.value.encounters)
        identities?.restore(record.value.generations)
        if (encounters.localActorId !== null) members.add(encounters.localActorId)
        break
      case 'player': {
        const id = value(record.value.actorId)
        if (record.origin === 'get') {
          if (id !== null && (encounters.localActorId === null || encounters.localActorId === id)) {
            encounters.localActorId = id
            members.add(id)
          }
          break
        }
        if (id !== null && encounters.localActorId !== null && id !== encounters.localActorId) break
        if (id !== null) {
          encounters.localActorId = id
          members.add(id)
        }
        // The snapshot's player value was already applied to the carried combat state.
        if (snapshot) break
        const combat = record.value.inCombat
        encounters.syncCombat(
          id === null ? null : value(combat),
          combat?.state === 'ok' ? combat.observedAt : record.t,
          -Infinity,
        )
        break
      }
      case 'party': {
        const list = value(record.value.members)
        partyKnown = list !== null
        if (list) party = list.map(({ id, ownParty }) => ({ id, ownParty }))
        scopeMembers()
        break
      }
      case 'zone': {
        const zone = value(record.value.territoryType)
        if (zone !== null && zone !== encounters.zone) {
          if (encounters.zone !== null) {
            encounters.finish('zoneChanged', record.t)
            encounters.resetCombat(record.t)
          }
          encounters.zone = zone
        }
        break
      }
      case 'identities':
        if (!identities) throw new Error('角色身份之前没有数据来源')
        identities.update(
          record.entities.map(({ generation: _, ...entity }) => entity),
          record.missing,
          members,
          allPlayers(),
        )
        encounters.updateActors(identities.actors)
        if (record.origin === 'snapshot') snapshot = false
        break
      case 'event':
        if (REVIEW.has(record.sample.value.type)) break
        encounters.qualityReasons.clear()
        if (!partyKnown && !allPlayers()) encounters.qualityReasons.add('队伍信息不可用；仅本角色与已确认宠物')
        encounters.accept(record.sample as Parameters<Encounters['accept']>[0], -Infinity)
        break
      case 'fightStart':
        next = record.id
        break
      case 'fightEnd': {
        // An end caused by an input is logged before that input, so the fight is ended here from the note. The end of a
        // fight that left combat is logged a few seconds later, after the input already ended it.
        const active = encounters.active
        if (record.reason === 'quiet') encounters.advance(record.endAt + 1)
        else if (record.reason === 'manual') {
          if (active) encounters.end(active.id, record.endAt)
        } else if (record.reason === 'outOfCombat' || record.reason === 'zoneChanged')
          encounters.finish(record.reason, record.endAt)
        else encounters.boundary(record.reason, record.endAt)
        const ended = encounters.completed[0]
        if (!ended || ended.reason !== record.reason || Math.round(ended.closedAt!) !== record.endAt)
          throw new Error(
            `重放的第 ${record.fight} 场战斗没有按日志结束：${ended?.reason ?? '未结束'} ${ended?.closedAt ?? ''}，日志为 ${record.reason} ${record.endAt}`,
          )
        break
      }
    }
    // The fightStart note comes before the input that opens the fight, so it belongs to no fight yet.
    const fightId = record.kind === 'fightEnd' ? record.id : (encounters.active?.id ?? null)
    observers.record?.(record, { fightId, actors: identities?.actors ?? none })
  }
  return [...encounters.completed].reverse().map((encounter) => encounters.snapshot(encounter, false)!)
}
