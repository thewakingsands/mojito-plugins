import type { ClockService, Disposer } from '@ffcafe/mojito-plugin-sdk'

/** Numeric handles preserve the upstream scheduler interface without wall-clock timers. */
export class TimelineClock {
  private next = 0
  private timers = new Map<number, Disposer>()
  constructor(private clock: ClockService) {}
  now(): number {
    const now = this.clock.now()
    if (now === null) throw new Error('Source clock unavailable')
    return now
  }
  setTimeout(callback: () => void, ms: number): number {
    const id = ++this.next
    const dispose = this.clock.setTimeout(() => {
      this.timers.delete(id)
      callback()
    }, ms)
    this.timers.set(id, dispose)
    return id
  }
  clearTimeout(id: number): void {
    const dispose = this.timers.get(id)
    this.timers.delete(id)
    if (dispose) void dispose()
  }
  clear(): void {
    for (const id of this.timers.keys()) this.clearTimeout(id)
  }
}
