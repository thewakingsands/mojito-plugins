import { describe, expect, it, vi } from 'vitest'
import { FishingApiError } from './api.js'
import { attributes, cast, caught, deferred, flush } from './fixtures.test-helper.js'
import { FishingService } from './service.js'
import type { FishingDistribution } from './types.js'

const distribution: FishingDistribution = {
  bait_id: 10,
  fish_id: 30,
  is_chum: false,
  tug_type: 1,
  count: 20,
  range: { min: 1000, max: 10000, effective_min: 2000, effective_max: 9000 },
  percentiles: { p50: 5000 },
}
function fixture() {
  let now = 100000,
    live = true
  let next = deferred<FishingDistribution[]>(),
    sent = deferred<void>()
  const api = { query: vi.fn(() => next.promise), upload: vi.fn(() => sent.promise) }
  const emit = vi.fn()
  const service = new FishingService({
    api,
    now: () => now,
    knownPlace: (place) => place === 20 || place === 21,
    attributes: () => attributes(now),
    emit,
    live: () => live,
    id: () => 'session',
  })
  return {
    service,
    api,
    emit,
    get now() {
      return now
    },
    advance(ms: number) {
      now += ms
    },
    setLive(value: boolean) {
      live = value
    },
    get next() {
      return next
    },
    newQuery() {
      next = deferred()
      return next
    },
    get sent() {
      return sent
    },
    newUpload() {
      sent = deferred()
      return sent
    },
  }
}
describe('fishing community service', () => {
  it('uses one switch for query and upload, never backfills and rejects late responses after disable', async () => {
    const f = fixture(),
      frame = cast('before', f.now)
    f.service.observe(frame)
    f.service.tick()
    expect(f.api.query).not.toHaveBeenCalled()
    f.service.setEnabled(true)
    expect(f.api.query).toHaveBeenCalledTimes(1)
    f.service.setEnabled(false)
    f.next.resolve([distribution])
    await flush()
    expect(f.service.snapshot).toMatchObject({ enabled: false, distributions: [], state: 'disabled' })
    f.newQuery()
    f.service.setEnabled(true)
    f.service.observe(caught(frame))
    f.advance(61000)
    f.service.tick()
    expect(f.api.upload).not.toHaveBeenCalled()
    f.service.dispose()
  })
  it('filters cached distributions by bait, coalesces queries, preserves stale values and honors retry-after', async () => {
    const f = fixture()
    f.service.setEnabled(true)
    f.service.observe(cast('a', f.now))
    f.service.tick()
    expect(f.api.query).toHaveBeenCalledTimes(1)
    f.next.resolve([distribution])
    await flush()
    expect(f.service.snapshot).toMatchObject({ state: 'ready', distributions: [distribution] })
    f.service.observe({ ...cast('b', f.now), baitId: 11 })
    expect(f.api.query).toHaveBeenCalledTimes(1)
    expect(f.service.snapshot.state).toBe('empty')
    f.advance(600001)
    f.newQuery()
    f.service.observe(cast('c', f.now))
    expect(f.service.snapshot).toMatchObject({ state: 'refreshing', distributions: [distribution] })
    f.next.reject(new FishingApiError(180000, 429))
    await flush()
    expect(f.service.snapshot).toMatchObject({ state: 'stale', distributions: [distribution] })
    f.advance(60001)
    f.service.tick()
    expect(f.api.query).toHaveBeenCalledTimes(2)
    f.advance(120000)
    f.newQuery()
    f.service.tick()
    expect(f.api.query).toHaveBeenCalledTimes(3)
    f.service.observe(cast('other', f.now, 21))
    expect(f.service.snapshot.distributions).toEqual([])
    f.next.resolve([])
    await flush()
    expect(f.service.snapshot.state).toBe('empty')
    const queries = f.api.query.mock.calls.length
    f.advance(299999)
    f.service.tick()
    expect(f.api.query).toHaveBeenCalledTimes(queries)
    f.service.observe({ ...cast('other', f.now, 21), action: 'quit' })
    f.advance(86400001)
    f.service.tick()
    expect(f.api.query).toHaveBeenCalledTimes(queries)
    f.service.dispose()
  })
  it('sends each immutable batch once, retains new records and does not retry failed batches', async () => {
    const f = fixture()
    f.service.setEnabled(true)
    const one = cast('one', f.now)
    f.service.observe(one)
    f.service.observe(caught(one))
    f.service.observe(caught(one))
    f.advance(60000)
    f.service.tick()
    expect(f.api.upload).toHaveBeenCalledTimes(1)
    const sentBytes = (f.api.upload.mock.calls as unknown as [Uint8Array][])[0][0].slice()
    const two = cast('two', f.now)
    f.service.observe(two)
    f.service.observe(caught(two))
    f.sent.resolve()
    await flush()
    expect((f.api.upload.mock.calls as unknown as [Uint8Array][])[0][0]).toEqual(sentBytes)
    f.newUpload()
    f.advance(60000)
    f.service.tick()
    expect(f.api.upload).toHaveBeenCalledTimes(2)
    f.sent.reject(new FishingApiError(120000, 429))
    await flush()
    f.advance(300000)
    f.service.tick()
    expect(f.api.upload).toHaveBeenCalledTimes(2)
    expect(f.service.snapshot.uploadState).toBe('error')
    f.service.dispose()
  })
  it('caps upload queues at 120 and expires records after ten minutes', () => {
    const f = fixture()
    f.service.setEnabled(true)
    for (let i = 0; i < 125; i++) {
      const frame = cast(String(i), f.now)
      f.service.observe(frame)
      f.service.observe(caught(frame))
    }
    f.advance(60000)
    f.service.tick()
    const bytes = (f.api.upload.mock.calls as unknown as [Uint8Array][])[0][0]
    expect([...bytes.subarray(0, 2)]).toEqual([0x98, 120])
    const expired = fixture()
    expired.service.setEnabled(true)
    const frame = cast('expired', expired.now)
    expired.service.observe(frame)
    expired.service.observe(caught(frame))
    expired.advance(600000)
    expired.service.tick()
    expect(expired.api.upload).not.toHaveBeenCalled()
    f.service.dispose()
    expired.service.dispose()
  })
  it('clears pending work on replay, rejects unknown places and surfaces missing attributes', async () => {
    const f = fixture()
    f.service.setEnabled(true)
    f.service.observe(cast('unknown', f.now, 950))
    expect(f.api.query).not.toHaveBeenCalled()
    const one = cast('one', f.now)
    f.service.observe(one)
    f.service.observe(caught(one))
    f.setLive(false)
    f.advance(60000)
    f.service.tick()
    f.next.resolve([distribution])
    await flush()
    expect(f.api.upload).not.toHaveBeenCalled()
    expect(f.service.snapshot).toMatchObject({ state: 'unavailable', distributions: [], cast: null })
    const noStats = new FishingService({
      api: f.api,
      now: () => f.now,
      knownPlace: () => true,
      attributes: () => null,
      emit() {},
      live: () => true,
    })
    noStats.setEnabled(true)
    noStats.observe(one)
    noStats.observe(caught(one))
    expect(noStats.snapshot).toMatchObject({ uploadState: 'incomplete' })
    expect(noStats.snapshot.unavailable).toContain('采集属性')
    noStats.dispose()
    f.service.dispose()
  })
})

it('stops both querying and queued uploads when the single switch is disabled', async () => {
  const f = fixture()
  f.service.setEnabled(true)
  const frame = cast('one', f.now)
  f.service.observe(frame)
  f.service.observe(caught(frame))
  expect(f.api.query).toHaveBeenCalledTimes(1)
  f.service.setEnabled(false)
  f.next.resolve([distribution])
  await flush()
  f.advance(61000)
  f.service.tick()
  expect(f.api.query).toHaveBeenCalledTimes(1)
  expect(f.api.upload).not.toHaveBeenCalled()
  expect(f.service.snapshot).toMatchObject({ enabled: false, state: 'disabled', distributions: [] })
  f.service.dispose()
})
