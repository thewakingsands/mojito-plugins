import { pluginError } from './errors.js'
import type { ClockState, Value } from './types.js'

export function clockState(input: Value): ClockState {
  if (!input || typeof input !== 'object' || Array.isArray(input) || input instanceof Uint8Array)
    throw pluginError('invalid_argument')
  const { now, base, generation, source, paused } = input
  if (
    (now !== null && (typeof now !== 'number' || !Number.isFinite(now))) ||
    !['packet-unix', 'host-monotonic-unix', null].includes(base as string | null) ||
    typeof generation !== 'number' ||
    !Number.isSafeInteger(generation) ||
    generation < 0 ||
    !['live', 'replay', null].includes(source as string | null) ||
    typeof paused !== 'boolean'
  )
    throw pluginError('invalid_argument')
  if (now === null && (base !== null || source !== null)) throw pluginError('invalid_argument')
  return Object.freeze({ now, base, generation, source, paused }) as ClockState
}

/** Only extrapolates source time. Timers remain host-owned, including max-speed replay. */
export class ClientClock {
  private value: ClockState
  private anchor = 0
  private rate = 0
  private last: number | null = null
  constructor(
    initial: ClockState,
    private readonly monotonic = () => performance.now(),
  ) {
    this.value = initial
    this.sync(initial, initial.source === 'live' ? 1 : 0)
  }
  sync(state: ClockState, rate: number): void {
    if (!Number.isFinite(rate) || rate < 0) throw pluginError('invalid_argument')
    const prior = this.now()
    if (state.generation !== this.value.generation || state.source !== this.value.source) this.last = null
    else this.last = prior
    this.value = state
    this.anchor = this.monotonic()
    this.rate = state.paused || state.now === null ? 0 : rate
  }
  now(): number | null {
    if (this.value.now === null) return null
    const current = this.value.now + Math.max(0, this.monotonic() - this.anchor) * this.rate
    this.last = Math.max(this.last ?? current, current)
    return this.last
  }
  state(): ClockState {
    return Object.freeze({ ...this.value, now: this.now() })
  }
}
