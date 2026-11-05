import { TelemetryCollector, type TelemetrySample } from '@ffcafe/mojito-combat-model'
import type { PluginContext } from '@ffcafe/mojito-plugin-sdk'

export const TELEMETRY_URL = 'https://mojo.ffcafe.cn/api/telemetry/v1/events'
export const TELEMETRY_TYPE = 'combat.unknown-status'
export interface TelemetryContext {
  producerVersion: string
  modelVersion: string
  dataGameVersion: string
  opcodeVersion: string
  territoryId: number
}
export function randomEventId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 15) | 64
  bytes[8] = (bytes[8] & 63) | 128
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
interface Fight {
  id: string
  context: TelemetryContext
  collector: TelemetryCollector
  ended: boolean
}
/** Keeps one live encounter and no retry queue. HTTP runs outside the input queue. */
export class Telemetry {
  private fight: Fight | null = null
  private requests = new Set<AbortController>()
  constructor(
    private ctx: Pick<PluginContext, 'http' | 'capabilities' | 'log'>,
    private eventId = randomEventId,
  ) {}

  permitted(): boolean {
    return this.ctx.capabilities.get().granted.includes('http.request')
  }

  start(id: string, context: TelemetryContext | null): void {
    this.flush()
    this.fight?.collector.invalidate()
    this.fight = context && this.permitted() ? { id, context, collector: new TelemetryCollector(), ended: false } : null
  }

  add(sample: TelemetrySample, owner = this.fight?.id): void {
    if (owner && owner === this.fight?.id) this.fight.collector.add(sample)
  }
  profile(actor: number, job: number, level: number): void {
    this.fight?.collector.profile(actor, job, level)
  }

  end(id: string, reason: string, afterInput: boolean): void {
    const fight = this.fight
    if (!fight || fight.id !== id || fight.ended) return
    fight.ended = true
    if (!['manual', 'quiet', 'outOfCombat'].includes(reason)) fight.collector.invalidate()
    if (!afterInput) this.flush()
  }

  invalidate(): void {
    this.fight?.collector.invalidate()
    this.fight = null
  }

  stop(): void {
    this.invalidate()
    for (const request of this.requests) request.abort()
    this.requests.clear()
  }

  flush(): void {
    const fight = this.fight
    if (!fight?.ended) return
    this.fight = null
    const observations = fight.collector.finish()
    if (!observations.length || !this.permitted()) return
    const controller = new AbortController()
    this.requests.add(controller)
    // The encounter is already terminal, including when ID generation or transport fails.
    void this.send(fight.context, observations, controller).finally(() => this.requests.delete(controller))
  }

  private async send(
    context: TelemetryContext,
    observations: ReturnType<TelemetryCollector['finish']>,
    controller: AbortController,
  ): Promise<void> {
    try {
      const { producerVersion, ...payload } = context
      const body = JSON.stringify({
        eventId: this.eventId(),
        type: TELEMETRY_TYPE,
        schemaVersion: 1,
        producerVersion,
        payload: { ...payload, observations },
      })
      if (new TextEncoder().encode(body).byteLength > 256 * 1024 || controller.signal.aborted || !this.permitted())
        return
      const result = await this.ctx.http.request(TELEMETRY_URL, {
        method: 'POST',
        credentials: 'omit',
        headers: { 'Content-Type': 'application/json' },
        body,
        timeoutMs: 5000,
        signal: controller.signal,
      })
      if (result.status !== 201 && result.status !== 200)
        this.ctx.log.warn('匿名状态样本未送达', { type: TELEMETRY_TYPE, category: `http_${result.status}` })
    } catch (error) {
      const code = (error as { code?: unknown })?.code
      this.ctx.log.warn('匿名状态样本未送达', {
        type: TELEMETRY_TYPE,
        category: controller.signal.aborted
          ? 'cancelled'
          : ['timeout', 'permission_denied', 'network_error'].includes(String(code))
            ? String(code)
            : 'request_failed',
      })
    }
  }
}
