import { actorId, invalidTarget } from './constants.js'
import type { CombatInput } from './input.js'

/** What the engine reads of an actor; a field is missing while it is not known */
export interface ActorProfile {
  classJob?: number
  level?: number
  /** 0 for an actor without an owner */
  ownerId?: number
}

/** A status in a slot of an actor. The source of a status without one is the invalid id 0xE0000000. */
export interface WorldStatus {
  id: number
  source: number
  stacks: number
}

/** The actors and their statuses at the moment of the input the engine handles */
export interface CombatWorld {
  get(id: number): Readonly<ActorProfile>
  /** The statuses in the slots of the actor, in the order of the slots */
  getBuffs(id: number): readonly WorldStatus[]
}

interface Actor {
  profile: ActorProfile
  slots: (WorldStatus | undefined)[]
}

const nobody: Readonly<ActorProfile> = Object.freeze({})

/**
 * Keeps the actors and their statuses from the actor, statuses and zone inputs. A zone change forgets every actor
 * but the receiver of the change, who keeps the statuses: the status lists of the new zone tell which of them left.
 */
export class MemoryWorld implements CombatWorld {
  private actors = new Map<number, Actor>()

  get(id: number): Readonly<ActorProfile> {
    if (id === 0 || id === invalidTarget) return nobody
    return this.actors.get(id)?.profile ?? nobody
  }

  getBuffs(id: number): readonly WorldStatus[] {
    if (id === 0 || id === invalidTarget) return []
    return (this.actors.get(id)?.slots.filter((slot) => slot !== undefined) as WorldStatus[] | undefined) ?? []
  }

  /** Applies an input; the inputs other than actor, statuses and zone leave the world as it is */
  handle(input: CombatInput): void {
    switch (input.type) {
      case 'actor': {
        const profile = { classJob: input.classJob, level: input.level, ownerId: input.ownerId ?? 0 }
        const actor = this.actors.get(input.actorId)
        if (actor) actor.profile = profile
        else this.actors.set(input.actorId, { profile, slots: [] })
        break
      }
      case 'statuses': {
        const holder = actorId(input.holder)
        if (holder === 0 || holder === invalidTarget) break
        let actor = this.actors.get(holder)
        if (!actor) {
          actor = { profile: {}, slots: [] }
          this.actors.set(holder, actor)
        }
        for (const { slot, status } of input.slots)
          actor.slots[slot] = status
            ? { id: status.id, source: actorId(status.source), stacks: status.stacks }
            : undefined
        break
      }
      case 'zone': {
        const kept = this.actors.get(input.receiver)
        this.actors.clear()
        if (kept) this.actors.set(input.receiver, kept)
        break
      }
    }
  }
}
