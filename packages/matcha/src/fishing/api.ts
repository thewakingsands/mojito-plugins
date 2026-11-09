import type { HttpService } from '@ffcafe/mojito-plugin-sdk'
import type { FishingApi, FishingDistribution } from './types.js'

export class FishingApiError extends Error {
  constructor(
    readonly retryAfter = 60000,
    readonly status = 0,
  ) {
    super('Fishing service request failed')
  }
}
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const positiveInteger = (value: unknown): value is number => finite(value) && Number.isSafeInteger(value) && value > 0
export function parseDistributions(input: unknown, place: number): FishingDistribution[] {
  if (
    !object(input) ||
    input.spot_id !== place ||
    !Array.isArray(input.distributions) ||
    input.distributions.length > 10000
  )
    throw new Error('Invalid fishing response')
  for (const row of input.distributions) {
    if (
      !object(row) ||
      !positiveInteger(row.bait_id) ||
      !positiveInteger(row.fish_id) ||
      typeof row.is_chum !== 'boolean' ||
      !positiveInteger(row.count) ||
      row.count < 10 ||
      !positiveInteger(row.tug_type) ||
      row.tug_type > 3 ||
      !object(row.range) ||
      !object(row.percentiles)
    )
      throw new Error('Invalid fishing distribution')
    const r = row.range,
      p = row.percentiles
    if (
      ![r.min, r.max, r.effective_min, r.effective_max, p.p50].every(finite) ||
      !(
        Number(r.min) > 0 &&
        Number(r.max) <= 600000 &&
        Number(r.min) <= Number(r.effective_min) &&
        Number(r.effective_min) <= Number(r.effective_max) &&
        Number(r.effective_max) <= Number(r.max) &&
        Number(p.p50) >= Number(r.min) &&
        Number(p.p50) <= Number(r.max)
      )
    )
      throw new Error('Invalid fishing range')
  }
  return structuredClone(input.distributions) as FishingDistribution[]
}
export function createFishingApi(
  http: HttpService,
  options: { headers?: () => Record<string, string>; now?: () => number } = {},
): FishingApi {
  const base = 'https://api.ffxiv.cyou/fisher/'
  const check = (response: Awaited<ReturnType<HttpService['request']>>, expected: string) => {
    // The host may follow allowed-origin redirects; do not accept changed endpoint results.
    if (response.url !== expected) throw new FishingApiError()
    if (response.status >= 200 && response.status < 300) return
    const retry = Object.entries(response.headers).find(([key]) => key.toLowerCase() === 'retry-after')?.[1]
    const milliseconds =
      retry && /^\d+$/.test(retry)
        ? Number(retry) * 1000
        : retry
          ? Date.parse(retry) - (options.now?.() ?? Date.now())
          : 60000
    throw new FishingApiError(
      Number.isFinite(milliseconds) ? Math.min(86400000, Math.max(60000, milliseconds)) : 60000,
      response.status,
    )
  }
  return {
    async query(place, signal) {
      const url = `${base}fish-duration?spot_id=${place}&min_count=10`
      const response = await http.request(url, {
        signal,
        method: 'GET',
        credentials: 'omit',
        timeoutMs: 5000,
        headers: options.headers?.(),
      })
      check(response, url)
      if (response.body.byteLength > 2 * 1024 * 1024) throw new Error('Fishing response too large')
      return parseDistributions(JSON.parse(new TextDecoder().decode(response.body)), place)
    },
    async upload(data, timestamp, signal) {
      const url = `${base}upload`
      const response = await http.request(url, {
        signal,
        method: 'POST',
        credentials: 'omit',
        timeoutMs: 5000,
        headers: {
          ...options.headers?.(),
          'Content-Type': 'application/cbor',
          'X-Client-Timestamp': String(timestamp),
        },
        body: data,
      })
      check(response, url)
    },
  }
}
