import type { HttpService } from '@ffcafe/mojito-plugin-sdk'
import { describe, expect, it, vi } from 'vitest'
import { createFishingApi, FishingApiError } from './api.js'

describe('fishing HTTP adapter', () => {
  it('uses fixed public endpoints, bounded requests and the CBOR contract headers', async () => {
    const request = vi.fn<HttpService['request']>().mockImplementation(async (url) => ({
      status: 200,
      headers: {},
      body: new TextEncoder().encode(JSON.stringify({ spot_id: 20, distributions: [] })),
      url,
    }))
    const api = createFishingApi({ request }, { headers: () => ({ Authorization: 'Bearer user-supplied-test' }) })
    const signal = new AbortController().signal
    await expect(api.query(20, signal)).resolves.toEqual([])
    expect(request.mock.calls[0]).toEqual([
      'https://api.ffxiv.cyou/fisher/fish-duration?spot_id=20&min_count=10',
      {
        signal,
        method: 'GET',
        credentials: 'omit',
        timeoutMs: 5000,
        headers: { Authorization: 'Bearer user-supplied-test' },
      },
    ])
    const bytes = new Uint8Array([0x80])
    await api.upload(bytes, 123, signal)
    expect(request.mock.calls[1][1]).toMatchObject({
      method: 'POST',
      body: bytes,
      headers: { 'Content-Type': 'application/cbor', 'X-Client-Timestamp': '123' },
    })
  })
  it('rejects missing fields, mismatched spots, oversized bodies, redirects and invalid ranges', async () => {
    let body: unknown = { spot_id: 20, distributions: [{}] }
    let alternateUrl = false,
      oversized = false
    const api = createFishingApi({
      request: async (url) => ({
        status: 200,
        headers: {},
        body: oversized ? new Uint8Array(2 * 1024 * 1024 + 1) : new TextEncoder().encode(JSON.stringify(body)),
        url: alternateUrl ? `${url}&redirected=1` : url,
      }),
    })
    const signal = new AbortController().signal
    await expect(api.query(20, signal)).rejects.toThrow('distribution')
    body = { spot_id: 21, distributions: [] }
    await expect(api.query(20, signal)).rejects.toThrow('response')
    body = { spot_id: 20, distributions: [] }
    alternateUrl = true
    await expect(api.query(20, signal)).rejects.toThrow(FishingApiError)
    alternateUrl = false
    oversized = true
    await expect(api.query(20, signal)).rejects.toThrow('large')
    oversized = false
    body = {
      spot_id: 20,
      distributions: [
        {
          bait_id: 1,
          fish_id: 2,
          count: 10,
          is_chum: false,
          tug_type: 1,
          range: { min: 2, max: 1, effective_min: 2, effective_max: 1 },
          percentiles: { p50: 1 },
        },
      ],
    }
    await expect(api.query(20, signal)).rejects.toThrow('range')
  })
  it('honors Retry-After with a one-minute minimum and one-day maximum', async () => {
    let retry = '180'
    const api = createFishingApi({
      request: async (url) => ({ status: 429, headers: { 'Retry-After': retry }, body: new Uint8Array(), url }),
    })
    const signal = new AbortController().signal
    await expect(api.query(20, signal)).rejects.toMatchObject({ status: 429, retryAfter: 180000 })
    retry = '1'
    await expect(api.query(20, signal)).rejects.toMatchObject({ retryAfter: 60000 })
    retry = '1000000'
    await expect(api.query(20, signal)).rejects.toMatchObject({ retryAfter: 86400000 })
  })
})
