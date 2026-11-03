import type { CombatantState, Field } from '@ffcafe/mojito-plugin-sdk'
import type { Actor } from './model.js'
export const value = <T>(field: Field<T> | undefined): T | null => (field?.state === 'ok' ? field.value : null)
export const isCharacterEntity = (entity: CombatantState): boolean => [1, 2].includes(value(entity.objectKind) ?? 0)
/** `BattleNpcSubKind.NpcPartyMember`: an NPC of a squadron, Trust or Duty Support party. */
const NPC_PARTY_MEMBER = 9
interface Facts {
  objectKind: number | null
  subKind: number | null
  ownerId: number | null
  ownerKnown: boolean
  bNpcBase: number | null
}
/** Entity lifetimes use observed disappearance/reappearance, never the display name as a map key. */
export class Identities {
  private generations = new Map<number, number>()
  private facts = new Map<number, Facts>()
  readonly actors = new Map<number, Actor>()
  /** Increases whenever an actor is added, removed or replaced; actors that did not change keep their object. */
  revision = 0
  constructor(readonly source: string) {}
  carry(): [number, number][] {
    return [...this.generations]
  }
  restore(value: [number, number][]) {
    this.generations = new Map(value)
  }
  update(entities: CombatantState[], missing: number[], members: Set<number>, allPlayers = false) {
    for (const id of missing) {
      this.facts.delete(id)
      if (this.actors.delete(id)) {
        this.generations.set(id, (this.generations.get(id) ?? 0) + 1)
        this.revision++
      }
    }
    for (const entity of entities) {
      const kind = value(entity.objectKind) ?? this.facts.get(entity.id)?.objectKind
      if (kind !== 1 && kind !== 2) {
        this.facts.delete(entity.id)
        if (this.actors.delete(entity.id)) {
          this.generations.set(entity.id, (this.generations.get(entity.id) ?? 0) + 1)
          this.revision++
        }
        continue
      }
      const old = this.actors.get(entity.id)
      const name = value(entity.name),
        worldId = value(entity.homeWorldId)
      // A positive identity change is additional evidence when a disappearance was not sampled.
      if (
        old &&
        ((name !== null && old.name !== null && name !== old.name) ||
          (worldId !== null && old.worldId !== null && worldId !== old.worldId))
      )
        this.generations.set(entity.id, (this.generations.get(entity.id) ?? 0) + 1)
      const actor: Actor = {
        key: `${this.source}:${this.generations.get(entity.id) ?? 0}:${entity.id}`,
        id: entity.id,
        name: name ?? old?.name ?? null,
        worldId: worldId ?? old?.worldId ?? null,
        job: value(entity.classJob) ?? old?.job ?? null,
        kind: old?.kind ?? 'unknown',
        ownerKey: old?.ownerKey ?? null,
      }
      if (
        !old ||
        old.key !== actor.key ||
        old.name !== actor.name ||
        old.worldId !== actor.worldId ||
        old.job !== actor.job
      ) {
        this.actors.set(entity.id, actor)
        this.revision++
      }
      this.facts.set(entity.id, {
        objectKind: value(entity.objectKind) ?? this.facts.get(entity.id)?.objectKind ?? null,
        subKind: value(entity.subKind) ?? this.facts.get(entity.id)?.subKind ?? null,
        ownerId: value(entity.ownerId),
        ownerKnown: entity.ownerId?.state === 'ok',
        bNpcBase: value(entity.bNpcBase),
      })
    }
    this.classify(members, allPlayers)
  }
  /** Reclassifies every known actor, so a scope change also applies to actors absent from the latest batch. */
  classify(members: Set<number>, allPlayers = false) {
    const member = (id: number) => {
      if (members.has(id)) return true
      const facts = this.facts.get(id)
      // NPC party members are not in the party list of the game, so they count in every scope by their sub kind.
      if (facts?.subKind === NPC_PARTY_MEMBER && facts.objectKind === 2) return true
      return allPlayers && facts?.objectKind === 1
    }
    for (const [id, actor] of this.actors) {
      const facts = this.facts.get(id)
      const owner = facts?.ownerId == null ? undefined : this.actors.get(facts.ownerId)
      let kind: Actor['kind'] = 'unknown',
        ownerKey: string | null = null
      if (member(id)) kind = 'member'
      else if (owner && member(owner.id)) {
        kind = 'pet'
        ownerKey = owner.key
      } else if (facts?.ownerKnown && facts.ownerId === null && facts.objectKind === 2 && (facts.bNpcBase ?? 0) > 0)
        kind = 'enemy'
      if (actor.kind !== kind || actor.ownerKey !== ownerKey) {
        this.actors.set(id, { ...actor, kind, ownerKey })
        this.revision++
      }
    }
  }
}
