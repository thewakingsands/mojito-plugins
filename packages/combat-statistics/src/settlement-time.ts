export interface TimeBounds {
  first: number
  last: number
  packetFirst: number | null
  packetLast: number | null
  packetComplete: boolean
}
export function point(at: number, packetAt?: number): TimeBounds {
  const packet = packetAt !== undefined && Number.isFinite(packetAt) ? packetAt : null
  return { first: at, last: at, packetFirst: packet, packetLast: packet, packetComplete: packet !== null }
}
export function mergeTime(a: TimeBounds | null, b: TimeBounds | null): TimeBounds | null {
  if (!a) return b ? { ...b } : null
  if (!b) return { ...a }
  return {
    first: Math.min(a.first, b.first),
    last: Math.max(a.last, b.last),
    packetFirst:
      a.packetFirst === null
        ? b.packetFirst
        : b.packetFirst === null
          ? a.packetFirst
          : Math.min(a.packetFirst, b.packetFirst),
    packetLast:
      a.packetLast === null
        ? b.packetLast
        : b.packetLast === null
          ? a.packetLast
          : Math.max(a.packetLast, b.packetLast),
    packetComplete: a.packetComplete && b.packetComplete,
  }
}
export function elapsed(time: TimeBounds | null): number {
  if (!time) return 0
  return time.packetComplete && time.packetFirst !== null && time.packetLast !== null
    ? time.packetLast - time.packetFirst
    : time.last - time.first
}
export class SettlementTime {
  private readonly fixed = new Map<string, TimeBounds>()
  private readonly pending = new Map<string, Map<string, TimeBounds>>()
  add(actor: string, at: number, packetAt?: number) {
    this.fixed.set(actor, mergeTime(this.fixed.get(actor) ?? null, point(at, packetAt))!)
  }
  replace(key: string, actors: Iterable<string>, at: number, packetAt?: number) {
    this.pending.set(key, new Map([...actors].map((actor) => [actor, point(at, packetAt)])))
  }
  finish(key: string) {
    const contribution = this.pending.get(key)
    if (!contribution) return
    for (const [actor, time] of contribution) this.fixed.set(actor, mergeTime(this.fixed.get(actor) ?? null, time)!)
    this.pending.delete(key)
  }
  seal() {
    for (const key of this.pending.keys()) this.finish(key)
  }
  snapshot(): Map<string, TimeBounds> {
    const result = new Map(this.fixed)
    for (const contribution of this.pending.values())
      for (const [actor, time] of contribution) result.set(actor, mergeTime(result.get(actor) ?? null, time)!)
    return result
  }
}
