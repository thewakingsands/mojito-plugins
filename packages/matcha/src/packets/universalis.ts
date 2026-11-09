// Copyright (c) FFCafe. All rights reserved.
// Licensed under AGPL-3.0. Universalis adapter for the SDK's permission-checked HTTP service.

import type { HttpService } from '@ffcafe/mojito-plugin-sdk'
import type { MarketComparison, MatchaMarketService } from './market.js'

export interface UniversalisSettings {
  enabled: boolean
  uploadEnabled: boolean
  apiKey?: string
  /** A configured anonymous installation identifier, never a raw character content ID. */
  uploaderId?: string
}

export interface UniversalisOptions {
  http: Pick<HttpService, 'request'>
  getSettings: () => UniversalisSettings
  dataCenters: Readonly<Record<number, string>>
  worldNames?: Readonly<Record<string, number>>
  onDiagnostic?: (message: string) => void
}

const base = 'https://universalis.app'
const positive = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) > 0 && (value as number) <= 0x7fffffff
const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null

/**
 * No requests occur until explicitly enabled. Upload credentials stay behind the worker boundary.
 * API contracts: https://docs.universalis.app/ and Universalis.Application/Controllers/V1/{Upload,DeleteListing}Controller.cs.
 */
export function createUniversalisClient(options: UniversalisOptions): MatchaMarketService {
  let inFlight = 0
  const request: HttpService['request'] = async (url, init) => {
    if (inFlight >= 4) throw new Error('Universalis request limit reached')
    inFlight++
    try {
      const result = await options.http.request(url, { ...init, credentials: 'omit', timeoutMs: 10_000 })
      if (result.status < 200 || result.status >= 300) throw new Error('HTTP request failed')
      return result
    } catch {
      // Neither the /upload/{key} URL nor a transport error containing it may escape to diagnostics.
      throw new Error('Universalis request failed')
    } finally {
      inFlight--
    }
  }
  const credentials = () => {
    const settings = options.getSettings()
    if (!settings.enabled || !settings.uploadEnabled || !settings.apiKey?.trim() || !settings.uploaderId?.trim())
      return null
    return { key: settings.apiKey.trim(), uploader: settings.uploaderId.trim() }
  }
  const upload = async (body: Record<string, unknown>): Promise<void> => {
    const auth = credentials()
    if (!auth) return
    await request(`${base}/upload/${encodeURIComponent(auth.key)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...body, uploaderID: auth.uploader }),
    })
  }
  return {
    async query(world, item) {
      if (!options.getSettings().enabled || !positive(world) || !positive(item)) return []
      const dc = options.dataCenters[world]
      if (!dc) return []
      const response = await request(`${base}/api/v2/${encodeURIComponent(dc)}/${item}?listings=999&entries=0`)
      if (!options.getSettings().enabled) return []
      if (response.body.byteLength > 2 * 1024 * 1024) throw new Error('Universalis response exceeds the supported size')
      let raw: Record<string, unknown> | null
      try {
        raw = object(JSON.parse(new TextDecoder().decode(response.body)))
      } catch {
        throw new Error('Invalid Universalis response')
      }
      if (!raw || !Array.isArray(raw.listings) || (raw.itemID !== undefined && raw.itemID !== item))
        throw new Error('Invalid Universalis response')
      if (raw.listings.length > 10_000) throw new Error('Too many Universalis listings')
      const rows: MarketComparison[] = []
      for (const value of raw.listings) {
        const row = object(value)
        if (!row) continue
        const id = positive(row.worldID)
          ? row.worldID
          : typeof row.worldName === 'string'
            ? options.worldNames?.[row.worldName]
            : undefined
        if (!positive(id) || !positive(row.pricePerUnit) || !positive(row.quantity) || typeof row.hq !== 'boolean')
          continue
        rows.push({ world: id, price: row.pricePerUnit, quantity: row.quantity, hq: row.hq })
      }
      return rows
    },
    async upload(batch) {
      if (!credentials() || !positive(batch.world) || !positive(batch.item)) return
      if (
        batch.listings.length > 1000 ||
        batch.sales.length > 20 ||
        batch.listings.some((row) => row.item !== batch.item)
      ) {
        options.onDiagnostic?.('Discarded invalid Universalis batch')
        return
      }
      await upload({
        worldID: batch.world,
        itemID: batch.item,
        listings: batch.listings.map(({ item: _item, ...listing }) => listing),
        entries: batch.sales,
      })
    },
    async deleteListing(purchase) {
      const auth = credentials()
      if (
        !auth ||
        !positive(purchase.world) ||
        !positive(purchase.item) ||
        !positive(purchase.quantity) ||
        !positive(purchase.pricePerUnit)
      )
        return
      await request(`${base}/api/v2/${purchase.world}/${purchase.item}/delete`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: auth.key },
        body: JSON.stringify({
          retainerID: purchase.retainerID,
          listingID: purchase.listingID,
          quantity: purchase.quantity,
          pricePerUnit: purchase.pricePerUnit,
          uploaderID: auth.uploader,
        }),
      })
    },
    async uploadTaxRates(world, rates) {
      if (!positive(world) || Object.values(rates).some((rate) => !Number.isInteger(rate) || rate < 0 || rate > 100))
        return
      await upload({ worldID: world, marketTaxRates: rates })
    },
  }
}
