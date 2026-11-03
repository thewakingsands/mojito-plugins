import { pluginError } from './errors.js'
import type { SubscribeOptions, Value } from './types.js'

const VIEW_SEND_MS = 200

type Send = (channel: string, payload: Value) => Promise<void>
type Warn = (message: string, fields: Value) => void

/**
 * Keeps the latest value of each view channel and sends at most one round per interval, so a plugin
 * can update its views on every event without paying for each update on the host.
 */
export class ViewSender {
  private readonly pending = new Map<string, Value>()
  private timer: ReturnType<typeof setTimeout> | undefined
  private sending: Promise<void> | undefined
  private lastSendAt = -Infinity
  private failure: unknown

  constructor(
    private readonly send: Send,
    private readonly warn: Warn,
    private readonly signal: AbortSignal,
  ) {
    signal.addEventListener(
      'abort',
      () => {
        this.cancelTimer()
        this.pending.clear()
      },
      { once: true },
    )
  }

  /** The value is read when it is sent, not copied here. */
  set(channel: string, value: Value): void {
    this.check()
    this.pending.set(channel, value)
    this.schedule()
  }

  flush(options?: SubscribeOptions): Promise<void> {
    try {
      this.check()
    } catch (error) {
      return Promise.reject(error)
    }
    const signal = options?.signal
    if (signal?.aborted) return Promise.reject(pluginError('cancelled'))
    const drained = this.drain()
    const settled = signal
      ? new Promise<void>((resolve, reject) => {
          const abort = () => reject(pluginError('cancelled'))
          signal.addEventListener('abort', abort, { once: true })
          void drained.then(() => {
            signal.removeEventListener('abort', abort)
            resolve()
          })
        })
      : drained
    return settled.then(() => this.check())
  }

  /** Throws once for a rejected send so the next caller learns about it. */
  private check() {
    if (this.signal.aborted) throw pluginError('plugin_stopped')
    if (this.failure === undefined) return
    const failure = this.failure
    this.failure = undefined
    throw failure
  }

  private schedule() {
    if (this.timer !== undefined || this.sending || !this.pending.size) return
    const delay = Math.max(0, this.lastSendAt + VIEW_SEND_MS - Date.now())
    this.timer = setTimeout(() => {
      this.timer = undefined
      void this.start()
    }, delay)
  }

  private cancelTimer() {
    clearTimeout(this.timer)
    this.timer = undefined
  }

  private async drain() {
    for (;;) {
      this.cancelTimer()
      if (this.sending) await this.sending
      else if (this.pending.size && !this.signal.aborted) await this.start()
      else return
    }
  }

  private start() {
    const batch = [...this.pending]
    this.pending.clear()
    this.lastSendAt = Date.now()
    this.sending = this.sendAll(batch).finally(() => {
      this.sending = undefined
      this.schedule()
    })
    return this.sending
  }

  private async sendAll(batch: [string, Value][]) {
    for (const [channel, value] of batch) {
      if (this.signal.aborted) return
      try {
        await this.send(channel, value)
      } catch (error) {
        if (this.signal.aborted) return
        const code = error instanceof Object && 'code' in error ? error.code : undefined
        this.warn('View update rejected', { channel, code: typeof code === 'string' ? code : 'internal' })
        // The host keeps the last accepted value, so a rejected one is dropped rather than retried.
        this.failure ??= error
      }
    }
  }
}
