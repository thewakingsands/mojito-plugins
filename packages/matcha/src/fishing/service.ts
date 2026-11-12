// Ported from Cafe.Matcha (AGPL-3.0), FishingService.
import type { Json } from '@ffcafe/mojito-plugin-sdk'
import type { MatchaEmitter } from '../protocol.js'
import { FishingApiError } from './api.js'
import {
  type FishingApi,
  type FishingAttributes,
  type FishingDistribution,
  type FishingFrame,
  type FishingStatistics,
  publicFrame,
} from './types.js'
import { type CborValue, createUpload, encodeUpload } from './upload.js'

export interface FishingServiceOptions {
  api: FishingApi | null
  now: () => number
  knownPlace: (place: number) => boolean
  attributes: () => FishingAttributes | null
  emit: MatchaEmitter
  live: () => boolean
  id?: () => string
}
export class FishingService {
  private readonly cache = new Map<number, { time: number; rows: FishingDistribution[] }>()
  private readonly retry = new Map<number, number>()
  private readonly loading = new Set<number>()
  private readonly pending: { time: number; row: CborValue[] }[] = []
  private cancellation = new AbortController()
  private enabled = false
  private disposed = false
  private uploading = false
  private generation = 0
  private revision = 0
  private nextUpload = 0
  private uploadRetry = 0
  private readonly session: string
  private current: FishingFrame | null = null
  private castAttributes: FishingAttributes | null = null
  private eligible = false
  private uploadState: FishingStatistics['uploadState'] = 'idle'
  private lastLive = false
  constructor(private readonly options: FishingServiceOptions) {
    this.session = options.id?.() ?? crypto.randomUUID()
    this.lastLive = options.live()
  }
  setEnabled(value: boolean): void {
    if (this.disposed || this.enabled === value) return
    this.enabled = value
    this.resetRequests()
    if (value) {
      this.nextUpload = this.options.now() + 60000
      this.queryIfNeeded()
    }
    this.publish()
  }
  private resetRequests(): void {
    this.generation++
    this.cancellation.abort()
    this.cancellation = new AbortController()
    this.loading.clear()
    this.pending.length = 0
    this.retry.clear()
    this.cache.clear()
    this.uploading = this.eligible = false
    this.castAttributes = null
    this.uploadRetry = 0
    this.uploadState = 'idle'
  }
  reset(): void {
    if (this.disposed) return
    this.resetRequests()
    this.current = null
    this.nextUpload = this.options.now() + 60000
    this.publish()
  }
  private checkSource(): void {
    const live = this.options.live()
    if (live !== this.lastLive) {
      this.lastLive = live
      this.resetRequests()
      this.current = null
    }
  }
  observe(value: FishingFrame): void {
    if (this.disposed) return
    this.checkSource()
    if (value.action === 'reset') {
      this.reset()
      return
    }
    if (value.action === 'quit') {
      this.current = null
      this.eligible = false
      this.publish()
      return
    }
    if (value.action === 'bait') return
    if (value.action === 'cast') {
      if (this.current?.castId === value.castId) return
      this.castAttributes = structuredClone(this.options.attributes())
      if (
        this.castAttributes &&
        (this.options.now() < this.castAttributes.sampledAt ||
          this.options.now() - this.castAttributes.sampledAt > 2000)
      )
        this.castAttributes = null
      this.eligible = this.enabled && this.options.live()
    } else if (!this.current || this.current.castId !== value.castId) return
    this.current = structuredClone(value)
    if (this.eligible && value.capture?.terminal) {
      this.eligible = false
      if (this.known(value.placeId)) {
        const row = createUpload(value, this.castAttributes)
        if (row) {
          while (this.pending.length >= 120) this.pending.shift()
          this.pending.push({ time: this.options.now(), row })
        } else this.uploadState = 'incomplete'
      }
    }
    this.queryIfNeeded()
    this.publish()
  }
  private known(place: number | null | undefined): place is number {
    return !!place && place !== 950 && this.options.knownPlace(place)
  }
  private queryIfNeeded(): void {
    if (
      !this.enabled ||
      !this.options.live() ||
      !this.options.api ||
      !this.current ||
      ['catch', 'end'].includes(this.current.action) ||
      !this.known(this.current.placeId) ||
      !this.current.baitId
    )
      return
    const place = this.current.placeId,
      time = this.options.now(),
      cached = this.cache.get(place)
    if (cached && time - cached.time >= 0 && time - cached.time < (cached.rows.length ? 600000 : 300000)) return
    if (this.loading.has(place) || (this.retry.get(place) ?? 0) > time) return
    this.loading.add(place)
    void this.query(place, this.generation, this.cancellation.signal)
  }
  private async query(place: number, generation: number, signal: AbortSignal): Promise<void> {
    let rows: FishingDistribution[] | null = null,
      delay = 60000
    try {
      rows = await this.options.api!.query(place, signal)
    } catch (error) {
      if (error instanceof FishingApiError) delay = Math.min(86400000, Math.max(60000, error.retryAfter))
    }
    if (this.disposed || !this.enabled || !this.options.live() || generation !== this.generation) return
    this.loading.delete(place)
    if (rows) {
      if (this.cache.size >= 32 && !this.cache.has(place)) {
        const oldest = [...this.cache].sort((a, b) => a[1].time - b[1].time)[0]
        if (oldest) this.cache.delete(oldest[0])
      }
      this.cache.set(place, { time: this.options.now(), rows: structuredClone(rows) })
      this.retry.delete(place)
    } else this.retry.set(place, this.options.now() + delay)
    this.publish()
  }
  tick(): void {
    if (this.disposed) return
    this.checkSource()
    const time = this.options.now()
    while (this.pending.length && time - this.pending[0].time >= 600000) this.pending.shift()
    this.queryIfNeeded()
    if (
      this.enabled &&
      this.options.live() &&
      this.options.api &&
      !this.uploading &&
      this.pending.length &&
      time >= this.nextUpload &&
      time >= this.uploadRetry
    ) {
      const batch = this.pending.splice(0).map((item) => item.row)
      this.uploading = true
      this.uploadState = 'sending'
      this.nextUpload = time + 60000
      void this.upload(batch, this.generation, this.cancellation.signal)
    }
    this.publish()
  }
  private async upload(batch: CborValue[], generation: number, signal: AbortSignal): Promise<void> {
    let success = false,
      delay = 60000
    try {
      await this.options.api!.upload(encodeUpload(batch), this.options.now(), signal)
      success = true
    } catch (error) {
      if (error instanceof FishingApiError) delay = Math.min(86400000, Math.max(60000, error.retryAfter))
    }
    if (this.disposed || !this.enabled || !this.options.live() || generation !== this.generation) return
    this.uploading = false
    this.uploadState = success ? 'ok' : 'error'
    if (!success) this.uploadRetry = this.options.now() + delay
    // Deliberately do not requeue an ambiguous upload result.
    this.publish()
  }
  get snapshot(): FishingStatistics {
    const value: FishingStatistics = {
      version: 1,
      enabled: this.enabled,
      session: this.session,
      revision: this.revision,
      cast: this.current ? publicFrame(this.current) : null,
      state: 'disabled',
      cachedAt: null,
      uploadState: this.uploadState,
      distributions: [],
      unavailable: null,
    }
    if (!this.enabled) return value
    if (!this.options.live() || !this.options.api) {
      value.state = 'unavailable'
      value.uploadState = 'unavailable'
      value.unavailable = !this.options.live() ? '回放或未连接状态不请求社区服务。' : 'HTTP 能力未授权或不可用。'
      return value
    }
    value.state = 'waiting'
    if (this.known(this.current?.placeId) && this.current?.baitId) {
      const place = this.current.placeId!,
        cached = this.cache.get(place),
        age = cached ? this.options.now() - cached.time : -1
      const available = !!cached && age >= 0 && age < 86400000
      if (available) {
        value.cachedAt = cached.time
        value.distributions = structuredClone(cached.rows.filter((row) => row.bait_id === this.current!.baitId))
      }
      value.state = this.loading.has(place)
        ? available
          ? 'refreshing'
          : 'loading'
        : this.retry.has(place)
          ? available
            ? 'stale'
            : 'error'
          : available
            ? value.distributions.length
              ? 'ready'
              : 'empty'
            : 'waiting'
    }
    if (this.uploadState === 'incomplete')
      value.unavailable = this.castAttributes?.unavailable ?? '钓鱼记录缺少完整包数据或采集属性，未上传。'
    return value
  }
  private publish(): void {
    this.revision++
    this.options.emit('FishingStatistics', this.snapshot as unknown as Json)
  }
  dispose(): void {
    if (this.disposed) return
    this.enabled = false
    this.resetRequests()
    this.current = null
    this.publish()
    this.disposed = true
  }
}
