// Copyright (c) FFCafe. Licensed under AGPL-3.0-only.
// Migrated from Cafe.Matcha's FATE/NPC telemetry. Endpoints and consent are supplied by the user.

import type { HttpService } from '@ffcafe/mojito-plugin-sdk'
import type { MatchaObservation } from './packets/index.js'
import type { MatchaSettings } from './settings.js'

type TelemetrySettings = MatchaSettings['telemetry']
type Row = Record<string, string | number>
interface PendingRow {
  type: 'fate' | 'npc'
  value: Row
}

export interface MatchaTelemetryOptions {
  http: Pick<HttpService, 'request'>
  getSettings: () => TelemetrySettings
  now?: () => number
  version?: string
  onDiagnostic?: (message: string) => void
}

/**
 * Coalesces observations for ten seconds. No disk queue, retry, or data collected while disabled.
 * tick() is driven by the runtime clock; reset() must be called on a capture/session discontinuity.
 */
export class MatchaTelemetry {
  private readonly pending = new Map<string, PendingRow>()
  private readonly now: () => number
  private readonly version: string
  private startedAt: number | null = null
  private configurationKey: string | null = null
  private generation = 0
  private inFlight: Promise<void> | null = null
  private controller: AbortController | null = null
  private disposed = false
  private overflowReported = false

  constructor(private readonly options: MatchaTelemetryOptions) {
    this.now = options.now ?? Date.now
    this.version = options.version ?? 'mojito-matcha'
  }

  observe(observations: readonly MatchaObservation[]): void {
    const settings = this.configuration()
    if (!settings || observations.length === 0) return
    const timestamp = this.now()
    if (!Number.isFinite(timestamp)) return
    const date = new Date(timestamp)
    const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    for (const observation of observations) {
      if (observation.world <= 0 || observation.zone <= 0) continue
      const scope = {
        world: observation.world,
        server: observation.server,
        zone: observation.zone,
        instance: observation.instance,
        client_id: settings.clientId,
        version: this.version,
        date: day,
        timestamp,
      }
      const state = observation.state
      let row: Row
      if (observation.type === 'fate') {
        row = {
          ...scope,
          fate: observation.state.id,
          start_time: observation.state.startTime,
          duration: observation.state.duration,
          progress: observation.state.progress,
        }
      } else {
        row = {
          ...scope,
          cid: observation.state.id,
          npc: observation.state.bNpcName,
          fate: observation.state.fate,
          x: observation.state.position.x,
          y: observation.state.position.y,
          z: observation.state.position.z,
          level: observation.state.level,
          cur_hp: observation.state.curHP,
          max_hp: observation.state.maxHP,
          location: observation.state.location,
        }
      }
      if (Object.values(row).some((value) => typeof value === 'number' && !Number.isFinite(value))) continue
      const key = `${observation.type}/${observation.world}/${observation.server}/${observation.zone}/${observation.instance}/${state.id}`
      if (!this.pending.has(key) && this.pending.size >= 1024) {
        this.pending.delete(this.pending.keys().next().value as string)
        if (!this.overflowReported) {
          this.options.onDiagnostic?.('Telemetry queue full; discarded oldest observations')
          this.overflowReported = true
        }
      }
      // Full snapshots include terminal progress=-1 and HP=0; zero values must not revive old state.
      this.pending.set(key, { type: observation.type, value: row })
      this.startedAt ??= timestamp
    }
  }

  async tick(): Promise<void> {
    const settings = this.configuration()
    if (!settings || this.startedAt === null || this.now() - this.startedAt < 10_000 || this.pending.size === 0) return
    if (this.inFlight) return this.inFlight
    const rows = [...this.pending.values()]
    this.pending.clear()
    this.startedAt = null
    this.overflowReported = false
    const generation = this.generation
    const controller = new AbortController()
    this.controller = controller
    const send = async (type: 'fate' | 'npc', bucket: string): Promise<void> => {
      const body = rows.filter((row) => row.type === type).map((row) => row.value)
      if (body.length === 0 || controller.signal.aborted) return
      try {
        const response = await this.options.http.request(
          `${settings.root.replace(/\/$/, '')}/${encodeURIComponent(bucket)}/batch`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            credentials: 'omit',
            body: JSON.stringify(body),
            signal: controller.signal,
            timeoutMs: 5_000,
          },
        )
        if (response.status < 200 || response.status >= 300) throw new Error('HTTP request failed')
      } catch {
        if (!controller.signal.aborted && generation === this.generation) {
          this.options.onDiagnostic?.(`Telemetry ${type} batch failed; batch discarded`)
        }
      }
    }
    const pending = Promise.all([send('fate', settings.fateBucket), send('npc', settings.npcBucket)]).then(() => {})
    this.inFlight = pending
    try {
      await pending
    } finally {
      if (generation === this.generation) {
        this.inFlight = null
        this.controller = null
      }
    }
  }

  reset(): void {
    this.generation++
    this.controller?.abort()
    this.controller = null
    this.inFlight = null
    this.pending.clear()
    this.startedAt = null
    this.configurationKey = null
    this.overflowReported = false
  }

  dispose(): void {
    this.reset()
    this.disposed = true
  }

  private configuration(): TelemetrySettings | null {
    if (this.disposed) return null
    const settings = this.options.getSettings()
    const key = JSON.stringify(settings)
    if (key !== this.configurationKey) {
      this.reset()
      this.configurationKey = key
    }
    if (!settings.enabled) return null
    try {
      const url = new URL(settings.root)
      if (
        url.protocol !== 'https:' ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        !settings.clientId ||
        settings.clientId.length > 256 ||
        [settings.fateBucket, settings.npcBucket].some(
          (bucket) => !bucket || bucket === '.' || bucket === '..' || bucket.length > 128,
        )
      )
        return null
    } catch {
      return null
    }
    return { ...settings }
  }
}
