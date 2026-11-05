import { invalidTarget } from '../constants.js'
import type { ActorProfile, CombatWorld, WorldStatus } from '../world.js'

/** A status in a slot, as the tests write it */
export interface TestBuff {
  id: number
  extra: number
  timestamp: number
  duration: number
  actorId: number
}

/** A status that left or came, and its slot */
export interface BuffAction {
  remove: boolean
  index: number
  buff: TestBuff
}

interface TestActor {
  profile: Required<ActorProfile>
  buffs: (TestBuff | undefined)[]
}

/**
 * A world the tests change directly, with the rules of the slots of the game: a status of id 0 clears its slot, and
 * another status in a slot first makes the one before leave
 */
export class TestCombatants implements CombatWorld {
  private actors = new Map<number, TestActor>()

  update(id: number, data: ActorProfile & Record<string, unknown>, create = false): void {
    if (id === invalidTarget) return
    let actor = this.actors.get(id)
    if (!actor) {
      if (!create) return
      actor = { profile: { classJob: 0, level: 0, ownerId: 0 }, buffs: [] }
      this.actors.set(id, actor)
    }
    if (data.classJob !== undefined) actor.profile.classJob = data.classJob
    if (data.level !== undefined) actor.profile.level = data.level
    if (data.ownerId !== undefined) actor.profile.ownerId = data.ownerId
  }

  delete(id: number): void {
    this.actors.delete(id)
  }

  get(id: number): Readonly<ActorProfile> {
    if (id === 0 || id === invalidTarget) return {}
    return this.actors.get(id)?.profile ?? {}
  }

  getBuffs(id: number): readonly WorldStatus[] {
    return (this.actors.get(id)?.buffs ?? [])
      .filter((buff) => buff !== undefined)
      .map((buff) => ({ id: buff.id, source: buff.actorId, stacks: buff.extra }))
  }

  /** The slots of the holder as they are now, for a statuses input */
  slots(id: number): { slot: number; status: { id: number; source: number | null; stacks: number } | null }[] {
    return (this.actors.get(id)?.buffs ?? []).map((buff, slot) => ({
      slot,
      status: buff ? { id: buff.id, source: buff.actorId, stacks: buff.extra } : null,
    }))
  }

  /** @returns The statuses that left and came, in this order; nothing for an unknown holder */
  buffUpdate(id: number, index: number, incoming: TestBuff): BuffAction[] {
    const actor = this.actors.get(id)
    if (!actor) return []
    const saved = actor.buffs[index]
    const remove = (): BuffAction[] => {
      if (!saved) return []
      actor.buffs[index] = undefined
      return [{ remove: true, index, buff: saved }]
    }
    if (incoming.id === 0) return remove()
    let buff = incoming
    let update = false
    const actions: BuffAction[] = []
    if (!saved) {
      update = true
    } else if (buff.id === saved.id && (buff.actorId === saved.actorId || buff.actorId === invalidTarget)) {
      if (buff.actorId === invalidTarget)
        buff = buff.duration === 0 ? { ...saved, extra: buff.extra } : { ...buff, actorId: saved.actorId }
      if (
        buff.duration !== 0 &&
        Math.abs(buff.timestamp / 1000 + buff.duration - (saved.timestamp / 1000 + saved.duration)) > 2
      )
        update = true
      else if (buff.extra !== saved.extra) update = true
    } else {
      actions.push(...remove())
      update = true
    }
    if (update) {
      actor.buffs[index] = buff
      actions.push({ remove: false, index, buff })
    }
    return actions
  }
}
