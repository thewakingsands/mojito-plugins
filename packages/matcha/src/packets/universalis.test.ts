import type { HttpOptions } from '@ffcafe/mojito-plugin-sdk'
import { describe, expect, it, vi } from 'vitest'
import type { MarketBatch, MarketTaxRates } from './market.js'
import { createUniversalisClient, type UniversalisSettings } from './universalis.js'

const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value))
const reply = (value: unknown, status = 200) => ({
  body: encode(value),
  headers: {},
  status,
  url: 'https://universalis.app/',
})
const batch: MarketBatch = { world: 1060, item: 42, listings: [], sales: [] }
const purchase = {
  world: 1060,
  item: 42,
  retainerID: '9007199254740993',
  listingID: '17',
  quantity: 1,
  pricePerUnit: 100,
}
const rates: MarketTaxRates = {
  limsaLominsa: 5,
  gridania: 3,
  uldah: 5,
  ishgard: 0,
  kugane: 2,
  crystarium: 3,
  sharlayan: 3,
  tuliyollal: 5,
}

function setup(initial: Partial<UniversalisSettings> = {}) {
  const settings: UniversalisSettings = { enabled: false, uploadEnabled: false, apiKey: '', uploaderId: '', ...initial }
  const request = vi.fn(async (_url: string, _options?: HttpOptions) => reply({ itemID: 42, listings: [] }))
  const client = createUniversalisClient({
    http: { request },
    getSettings: () => settings,
    dataCenters: { 1060: '陆行鸟' },
    worldNames: { 红玉海: 1167 },
  })
  return { settings, request, client }
}

describe('Universalis SDK adapter', () => {
  it('does not contact external services by default, or upload without all explicit credentials', async () => {
    const { settings, request, client } = setup()
    expect(await client.query(1060, 42)).toEqual([])
    await client.upload(batch)
    await client.deleteListing?.(purchase)
    await client.uploadTaxRates?.(1060, rates)
    settings.enabled = true
    await client.upload(batch)
    settings.uploadEnabled = true
    await client.upload(batch)
    settings.apiKey = 'configured-key'
    await client.upload(batch)
    expect(request).not.toHaveBeenCalled()
  })

  it('queries an escaped data center and only emits validated rows with numeric world IDs', async () => {
    const { request, client } = setup({ enabled: true })
    request.mockResolvedValue(
      reply({
        itemID: 42,
        listings: [
          { worldID: 1061, pricePerUnit: 100, quantity: 9, hq: true },
          { worldName: '红玉海', pricePerUnit: 200, quantity: 10, hq: false },
          { worldName: 'missing', pricePerUnit: 300, quantity: 1, hq: false },
          { worldID: 1061, pricePerUnit: -1, quantity: 1, hq: false },
          { worldID: 1061, pricePerUnit: 10, quantity: 1, hq: 'yes' },
          { worldID: 1061, pricePerUnit: 10, quantity: Infinity, hq: false },
        ],
      }),
    )
    expect(await client.query(1060, 42)).toEqual([
      { world: 1061, price: 100, quantity: 9, hq: true },
      { world: 1167, price: 200, quantity: 10, hq: false },
    ])
    expect(request).toHaveBeenCalledWith(
      `https://universalis.app/api/v2/${encodeURIComponent('陆行鸟')}/42?listings=999&entries=0`,
      { credentials: 'omit', timeoutMs: 10_000 },
    )
    await client.query(9999, 42)
    await client.query(1060, -1)
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('redacts upload keys from transport failures and checks non-success HTTP status', async () => {
    const { request, client } = setup({
      enabled: true,
      uploadEnabled: true,
      apiKey: 'sensitive/value',
      uploaderId: 'anonymous-installation',
    })
    request.mockRejectedValueOnce(new Error('failed https://universalis.app/upload/sensitive%2Fvalue'))
    await expect(client.upload(batch)).rejects.toThrow(/^Universalis request failed$/)
    expect(request.mock.calls[0][0]).toBe('https://universalis.app/upload/sensitive%2Fvalue')
    request.mockResolvedValueOnce(reply({ listings: [] }, 429))
    await expect(client.query(1060, 42)).rejects.toThrow(/^Universalis request failed$/)
  })

  it('uploads listing/history, acknowledged deletions and all eight tax rates using their documented contracts', async () => {
    const { request, client } = setup({
      enabled: true,
      uploadEnabled: true,
      apiKey: 'configured-key',
      uploaderId: 'installation-id',
    })
    await client.upload(batch)
    expect(JSON.parse(request.mock.calls[0][1]?.body as string)).toEqual({
      worldID: 1060,
      itemID: 42,
      listings: [],
      entries: [],
      uploaderID: 'installation-id',
    })
    await client.deleteListing?.(purchase)
    expect(request.mock.calls[1][0]).toBe('https://universalis.app/api/v2/1060/42/delete')
    expect(request.mock.calls[1][1]?.headers).toMatchObject({ authorization: 'configured-key' })
    expect(JSON.parse(request.mock.calls[1][1]?.body as string)).toEqual({
      retainerID: '9007199254740993',
      listingID: '17',
      quantity: 1,
      pricePerUnit: 100,
      uploaderID: 'installation-id',
    })
    await client.uploadTaxRates?.(1060, rates)
    expect(JSON.parse(request.mock.calls[2][1]?.body as string)).toEqual({
      worldID: 1060,
      marketTaxRates: rates,
      uploaderID: 'installation-id',
    })
    await client.uploadTaxRates?.(1060, { ...rates, gridania: -1 })
    expect(request).toHaveBeenCalledTimes(3)
  })

  it('rejects malformed, wrong-item and oversized API responses', async () => {
    const { request, client } = setup({ enabled: true })
    request.mockResolvedValueOnce(reply({ itemID: 43, listings: [] }))
    await expect(client.query(1060, 42)).rejects.toThrow('Invalid Universalis response')
    request.mockResolvedValueOnce({ ...reply(null), body: new TextEncoder().encode('{invalid') })
    await expect(client.query(1060, 42)).rejects.toThrow('Invalid Universalis response')
    request.mockResolvedValueOnce({ ...reply(null), body: new Uint8Array(2 * 1024 * 1024 + 1) })
    await expect(client.query(1060, 42)).rejects.toThrow('exceeds')
  })

  it('bounds concurrent requests and stops returning comparisons when disabled mid-request', async () => {
    const { settings, request, client } = setup({ enabled: true })
    const finish: (() => void)[] = []
    request.mockImplementation(
      () =>
        new Promise((resolve) =>
          finish.push(() =>
            resolve(reply({ itemID: 42, listings: [{ worldID: 1061, pricePerUnit: 100, quantity: 1, hq: true }] })),
          ),
        ),
    )
    const pending = Array.from({ length: 4 }, () => client.query(1060, 42))
    await expect(client.query(1060, 42)).rejects.toThrow('request limit')
    settings.enabled = false
    finish.forEach((resolve) => {
      resolve()
    })
    expect(await Promise.all(pending)).toEqual([[], [], [], []])
    expect(request).toHaveBeenCalledTimes(4)
  })
})
