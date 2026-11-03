export interface Hp {
  hpCur: number
  /** Only EffectResult carries it; the other HP events keep the one received before */
  hpMax: number | null
  /** Packet timestamp */
  at: number
  /** From UpdateHpMpTp, which has no action sequence */
  fromHpUpdate: boolean
}

/**
 * The last HP received for each actor, kept across encounters: the first heal of an encounter needs the HP received
 * before it started. The entry before the last is kept for HoT ticks, see beforeTick.
 */
export class HpTracker {
  private readonly actors = new Map<number, { last: Hp; previous: Hp | null }>()
  apply(actorId: number, hpCur: number, hpMax: number | null, at: number, fromHpUpdate: boolean) {
    const entry = this.actors.get(actorId)
    const last: Hp = { hpCur, hpMax: hpMax ?? entry?.last.hpMax ?? null, at, fromHpUpdate }
    this.actors.set(actorId, { last, previous: entry?.last ?? null })
  }
  current(actorId: number): Hp | null {
    return this.actors.get(actorId)?.last ?? null
  }
  /**
   * An UpdateHpMpTp with the timestamp of the tick may arrive before the tick and already include its healing; the
   * entry before it is the HP the tick landed on then.
   */
  beforeTick(actorId: number, tickAt: number | undefined): Hp | null {
    const entry = this.actors.get(actorId)
    if (!entry) return null
    return tickAt !== undefined && entry.last.fromHpUpdate && entry.last.at === tickAt ? entry.previous : entry.last
  }
  clear() {
    this.actors.clear()
  }
  carry(): [number, { last: Hp; previous: Hp | null }][] {
    return [...this.actors]
  }
  restore(value: [number, { last: Hp; previous: Hp | null }][]) {
    this.actors.clear()
    for (const [id, entry] of value) this.actors.set(id, entry)
  }
}
