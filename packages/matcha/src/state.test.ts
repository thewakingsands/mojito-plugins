import { describe, expect, it, vi } from 'vitest'
import { Notices } from './notifications.js'
import { OverlayStorage } from './overlay-storage.js'
import { defaultSettings, settingsFrom } from './settings.js'
import { MatchaSnapshot } from './snapshot.js'
import { sendWebhook } from './webhooks.js'

describe('Matcha display state', () => {
  it('restores independent market worlds, gear slots and boats to a reopened view', () => {
    const state = new MatchaSnapshot()
    let sequence = 0
    const add = (type: string, content: Record<string, never> | object) =>
      state.add({ sequence: ++sequence, timestamp: sequence, type, content: content as never })
    add('MarketBoardItemListingCount', { item: 10, world: 1, count: 2 })
    add('MarketBoardItemListing', { item: 10, world: 1, data: [{ price: 100 }] })
    add('MarketBoardItemListing', { item: 10, world: 1, data: [{ price: 200 }] })
    add('MarketBoardItemListing', { item: 10, world: 2, data: [{ price: 300 }] })
    add('Gearset', { self: true, slot: 1, item: 20 })
    add('Gearset', { self: false, slot: 1, item: 21 })
    add('SubmarineStatus', { index: 0, name: 'one' })
    add('SubmarineStatus', { index: 1, name: 'two' })
    expect(state.events()).toHaveLength(7)
    expect(state.events().find((event) => event.sequence === 3)?.content).toMatchObject({
      data: [{ price: 100 }, { price: 200 }],
    })
    add('MarketBoardItemListingCount', { item: 10, world: 1, count: 0 })
    expect(state.events().filter((event) => event.type === 'MarketBoardItemListing')).toHaveLength(1)
    add('SubmarineParts', { reset: true, index: -1, parts: [] })
    expect(state.events().filter((event) => event.type === 'SubmarineStatus')).toHaveLength(0)
    state.clear()
    expect(state.events()).toEqual([])
  })
  it('does not replay completed FATEs or prior fishing casts', () => {
    const state = new MatchaSnapshot()
    state.add({ type: 'Fate', sequence: 1, timestamp: 1, content: { fate: 8, type: 'start' } })
    state.add({ type: 'Fate', sequence: 2, timestamp: 2, content: { fate: 8, type: 'end' } })
    state.add({ type: 'Fishing', sequence: 3, timestamp: 3, content: { castId: 'a', action: 'cast' } })
    state.add({ type: 'Fishing', sequence: 4, timestamp: 4, content: { castId: 'b', action: 'cast' } })
    expect(state.events()).toEqual([
      { type: 'Fishing', sequence: 4, timestamp: 4, content: { castId: 'b', action: 'cast' } },
    ])
  })
})

describe('settings and outbound events', () => {
  it('defaults services off and validates endpoints without mutating defaults', () => {
    expect(settingsFrom(null).fishing).toEqual({ enabled: false })
    const result = settingsFrom({ watch: { fates: [480, 480] } })
    expect(result.watch.fates).toEqual([480])
    expect(defaultSettings.watch.fates).toEqual([])
    expect(settingsFrom({ telemetry: { enabled: true } })).not.toHaveProperty('telemetry')
    expect(() =>
      settingsFrom({ webhooks: [{ event: 'Fate', type: 'JSON', endpoint: 'http://example.com' }] }),
    ).toThrow()
    expect(() =>
      settingsFrom({ webhooks: [{ event: 'Fate', type: 'JSON', endpoint: 'https://user:secret@example.com' }] }),
    ).toThrow()
  })
  it('only notifies watched FATEs once per occurrence and resets on zone change', () => {
    const notices = new Notices()
    const settings = settingsFrom({ watch: { fates: [480] } })
    expect(notices.message('Fate', { fate: 480, type: 'start' }, 10000, settings)).toBeTruthy()
    expect(notices.message('Fate', { fate: 480, type: 'progress', progress: 30 }, 11000, settings)).toBeNull()
    notices.message('Fate', { fate: 480, type: 'end' }, 12000, settings)
    expect(notices.message('Fate', { fate: 480, type: 'start' }, 13000, settings)).toBeTruthy()
    expect(notices.message('Fate', { fate: 481, type: 'start' }, 14000, settings)).toBeNull()
    notices.message('InitZone', { zone: 1, instance: 0 }, 15000, settings)
    settings.formatter.fate.muteWhileLoading = true
    expect(notices.message('Fate', { fate: 480, type: 'start' }, 15001, settings)).toBeNull()
  })
  it.each(['GET', 'JSON', 'FORM', 'MULTIPART'] as const)(
    'keeps the existing %s webhook event/data envelope',
    async (type) => {
      const request = vi.fn(async () => ({ status: 200, headers: {}, body: new Uint8Array(), url: '' }))
      const signal = new AbortController().signal
      await sendWebhook(
        { request },
        {
          id: '1',
          name: 'test',
          type,
          event: 'Fate',
          endpoint: 'https://example.com/hook',
          headers: { authorization: 'test-only' },
        },
        'Fate',
        { fate: 480 },
        signal,
      )
      const [url, options] = request.mock.calls[0] as unknown as [
        string,
        { body?: string; signal: AbortSignal; credentials: string },
      ]
      expect(options.signal).toBe(signal)
      expect(options.credentials).toBe('omit')
      if (type === 'JSON') expect(JSON.parse(options.body!)).toEqual({ event: 'Fate', data: { fate: 480 } })
      else if (type === 'GET') expect(JSON.parse(new URL(url).searchParams.get('data')!)).toEqual({ fate: 480 })
      else expect(options.body).toContain(type === 'FORM' ? 'event=Fate' : 'name="event"\r\n\r\nFate')
    },
  )
})

it('serializes archive writes, propagates storage errors and restricts setting keys', async () => {
  const config = new Map<string, unknown>(),
    files = new Map<string, Uint8Array>()
  const storage = new OverlayStorage({
    config: {
      get: async (key) => config.get(key) as never,
      set: async (key, value) => {
        config.set(key, value)
      },
    },
    storage: {
      read: async (key) => {
        const value = files.get(key)
        if (!value) throw { code: 'not_found' }
        return value
      },
      write: async (key, bytes) => {
        files.set(key, bytes)
      },
      delete: async (key) => {
        files.delete(key)
      },
      list: async () => [],
    },
    limits: { values: { 'storage.fileBytes': 100 } } as never,
  })
  expect(await storage.get('overlay.matcha-fishing-v1')).toBeNull()
  await Promise.all([
    storage.set('overlay.matcha-fishing-v1', 'first'),
    storage.set('overlay.matcha-fishing-v1', 'last'),
  ])
  expect(await storage.get('overlay.matcha-fishing-v1')).toBe('last')
  await expect(storage.set('overlay.matcha-fishing-v1', 'x'.repeat(101))).rejects.toThrow('限制')
  await expect(storage.get('overlay.unknown')).rejects.toThrow('Unknown')
  await storage.drain()
})

it('normalizes old split switches and discards removed telemetry configuration', () => {
  const value = settingsFrom({
    fishing: { enabled: true, uploadEnabled: false },
    universalis: { enabled: false, uploadEnabled: true },
    telemetry: { enabled: true, root: 'https://old-service.test', clientId: 'old-id' },
  })
  expect(value.fishing).toEqual({ enabled: true })
  expect(value.universalis).toEqual({ enabled: false })
  expect(value).not.toHaveProperty('telemetry')
})
