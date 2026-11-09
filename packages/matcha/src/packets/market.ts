// Copyright (c) FFCafe. All rights reserved.
// Licensed under AGPL-3.0. Ported from Cafe.Matcha's market board handlers.

import type { MatchaEmitter, MatchaPacket } from '../protocol.js'
import type { Payload } from './binary.js'

export interface MarketListing {
  item: number
  listingID: string
  retainerID: string
  sellerID: string
  creatorID: string
  retainerName: string
  creatorName: string
  pricePerUnit: number
  quantity: number
  hq: boolean
  onMannequin: boolean
  retainerCity: number
  stainID: number
  lastReviewTime: number
  materia: { materiaID: number; slotID: number }[]
}

export interface MarketSale {
  pricePerUnit: number
  timestamp: number
  quantity: number
  hq: boolean
  onMannequin: boolean
  buyerName: string
}

export interface MarketBatch {
  world: number
  item: number
  listings: MarketListing[]
  sales: MarketSale[]
}

export interface MarketComparison {
  world: number
  price: number
  quantity: number
  hq: boolean
}

export interface MarketDeletion {
  world: number
  item: number
  retainerID: string
  listingID: string
  quantity: number
  pricePerUnit: number
}

export type MarketTaxRates = Record<
  'limsaLominsa' | 'gridania' | 'uldah' | 'ishgard' | 'kugane' | 'crystarium' | 'sharlayan' | 'tuliyollal',
  number
>

export interface MatchaMarketService {
  query(world: number, item: number): Promise<MarketComparison[]>
  upload(batch: MarketBatch): Promise<void>
  deleteListing?(purchase: MarketDeletion): Promise<void>
  uploadTaxRates?(world: number, rates: MarketTaxRates): Promise<void>
}

interface PendingBatch {
  world: number
  item: number
  expected: number
  startedAt: number
  requestId: number | null
  listings: MarketListing[]
  sales: MarketSale[] | null
}

export function readMarketListings(data: Payload, timestamp: number): { requestId: number; listings: MarketListing[] } {
  data.require(1444)
  const listings: MarketListing[] = []
  for (let index = 0; index < 10; index++) {
    const offset = index * 144
    const item = data.u32(offset + 44)
    if (item === 0) continue
    const materia: MarketListing['materia'] = []
    for (let slot = 0; slot < 5; slot++) {
      const value = data.u16(offset + 54 + slot * 2)
      if ((value & 0xff0) !== 0) materia.push({ materiaID: (value & 0xff0) >>> 4, slotID: value & 0xf })
    }
    listings.push({
      item,
      listingID: data.u64(offset),
      retainerID: data.u64(offset + 8),
      sellerID: data.u64(offset + 16),
      creatorID: data.u64(offset + 24),
      pricePerUnit: data.u32(offset + 32),
      quantity: data.u32(offset + 40),
      retainerName: data.text(offset + 70, 32),
      creatorName: '',
      hq: data.u8(offset + 134) !== 0,
      onMannequin: data.u8(offset + 136) !== 0,
      retainerCity: data.u8(offset + 137),
      stainID: data.u8(offset + 138) | (data.u8(offset + 139) << 8),
      lastReviewTime: Math.floor(timestamp / 1000),
      materia,
    })
  }
  return { requestId: data.u16(1442), listings }
}

export function readMarketHistory(data: Payload): { item: number; sales: MarketSale[] } {
  data.require(964)
  const sales: MarketSale[] = []
  for (let index = 0; index < 20; index++) {
    const offset = 4 + index * 48
    const pricePerUnit = data.u32(offset)
    if (pricePerUnit === 0) break
    sales.push({
      pricePerUnit,
      timestamp: data.u32(offset + 4),
      quantity: data.u32(offset + 8),
      hq: data.u8(offset + 12) !== 0,
      onMannequin: data.u8(offset + 13) !== 0,
      buyerName: data.text(offset + 14, 32),
    })
  }
  return { item: data.u32(0), sales }
}

/** Keeps a single bounded request; a new query, world, or session cancels its association. */
export class MarketPackets {
  private queryItem = 0
  private firstPage = false
  private generation = 0
  private pending: PendingBatch | null = null
  private purchase: (MarketDeletion & { startedAt: number }) | null = null

  constructor(
    private readonly options: {
      emit: MatchaEmitter
      now: () => number
      world: () => number
      service?: MatchaMarketService
      onDiagnostic: (message: string) => void
    },
  ) {}

  reset(): void {
    this.generation++
    this.queryItem = 0
    this.firstPage = false
    this.pending = null
    this.purchase = null
  }

  handle(packet: MatchaPacket, data: Payload): boolean {
    const { type, direction, timestamp } = packet
    if (type === 'MarketBoardRequestItemListingInfo') {
      if (direction !== 'send') return true
      data.require(8)
      const item = data.u32(0)
      this.reset()
      if (item !== 0) this.beginQuery(item, timestamp)
      return true
    }
    if (type === 'MarketBoardPurchaseHandler') {
      if (direction !== 'send') return true
      // Cafe.Matcha 7.x purchase layout. Do not infer an opcode or read a shorter legacy layout.
      data.require(36)
      this.purchase = {
        world: this.options.world(),
        item: data.u32(16),
        quantity: data.u32(20),
        pricePerUnit: data.u32(24),
        retainerID: data.u64(0),
        listingID: data.u64(8),
        startedAt: this.options.now(),
      }
      return true
    }
    if (direction !== 'recv') return false
    switch (type) {
      case 'MarketBoardItemListingCount': {
        data.require(8)
        this.firstPage = data.u32(0) === 0
        const expected = data.u32(4)
        this.pending =
          this.firstPage && expected <= 1000
            ? {
                world: this.options.world(),
                item: this.queryItem,
                expected,
                startedAt: this.options.now(),
                requestId: null,
                listings: [],
                sales: null,
              }
            : null
        return true
      }
      case 'MarketBoardItemListing': {
        const { listings, requestId } = readMarketListings(data, timestamp)
        const item = listings[0]?.item ?? this.queryItem
        if (listings.some((row) => row.item !== item)) {
          this.pending = null
          this.options.onDiagnostic('Market listing page contains different items')
          return true
        }
        if (this.firstPage && this.queryItem === 0 && item !== 0) this.beginQuery(item, timestamp)
        if (item !== 0)
          this.options.emit(
            'MarketBoardItemListing',
            {
              item,
              world: this.options.world(),
              data: listings
                .filter((row) => row.pricePerUnit !== 0)
                .map((row) => ({ price: row.pricePerUnit, quantity: row.quantity, hq: row.hq })),
            },
            timestamp,
          )
        this.firstPage = false
        // The pending batch retains its own item. Clear the one-shot outgoing hint so the next
        // recv-only query (including replays) can initialize from its first server page again.
        this.queryItem = 0
        const batch = this.activeBatch()
        if (batch) {
          const ids = new Set(batch.listings.map((row) => row.listingID))
          const pageIds = new Set(listings.map((row) => row.listingID))
          if (
            (batch.item !== 0 && batch.item !== item) ||
            (batch.requestId !== null && batch.requestId !== requestId) ||
            pageIds.size !== listings.length ||
            listings.some((row) => ids.has(row.listingID)) ||
            batch.listings.length + listings.length > batch.expected
          ) {
            this.pending = null
            this.options.onDiagnostic('Discarded inconsistent market listing batch')
          } else {
            batch.item = item
            batch.requestId = requestId
            batch.listings.push(...listings)
            this.finishBatch()
          }
        }
        return true
      }
      case 'MarketBoardItemListingHistory': {
        const { item, sales } = readMarketHistory(data)
        const batch = this.activeBatch()
        if (batch && item !== 0 && (batch.item === 0 || batch.item === item)) {
          batch.item = item
          batch.sales = sales
          this.finishBatch()
        }
        return true
      }
      case 'MarketBoardPurchase': {
        data.require(12)
        const purchase = this.purchase
        this.purchase = null
        if (
          purchase &&
          purchase.world === this.options.world() &&
          this.options.now() - purchase.startedAt <= 30_000 &&
          purchase.item === data.u32(0) &&
          purchase.quantity === data.u32(8)
        ) {
          this.run(() => this.options.service?.deleteListing?.(purchase), 'market purchase upload failed')
        }
        return true
      }
      case 'ResultDialog': {
        data.require(4)
        if (data.u32(0) !== 0xb0009) return false
        data.require(40)
        const names: (keyof MarketTaxRates)[] = [
          'limsaLominsa',
          'gridania',
          'uldah',
          'ishgard',
          'kugane',
          'crystarium',
          'sharlayan',
          'tuliyollal',
        ]
        const rates = Object.fromEntries(names.map((name, i) => [name, data.u32(8 + i * 4)])) as MarketTaxRates
        if (Object.values(rates).every((rate) => rate <= 100)) {
          this.run(
            () => this.options.service?.uploadTaxRates?.(this.options.world(), rates),
            'market tax upload failed',
          )
        }
        return true
      }
      default:
        return false
    }
  }

  private activeBatch(): PendingBatch | null {
    if (
      this.pending &&
      (this.pending.world !== this.options.world() || this.options.now() - this.pending.startedAt > 30_000)
    ) {
      this.pending = null
    }
    return this.pending
  }

  private finishBatch(): void {
    const batch = this.activeBatch()
    if (!batch?.sales || batch.item === 0 || batch.world === 0 || batch.listings.length !== batch.expected) return
    this.pending = null
    this.run(
      () =>
        this.options.service?.upload({
          world: batch.world,
          item: batch.item,
          listings: batch.listings,
          sales: batch.sales ?? [],
        }),
      'market upload failed',
    )
  }

  private beginQuery(item: number, timestamp: number): void {
    const generation = ++this.generation
    this.queryItem = item
    const world = this.options.world()
    this.options.emit('MarketBoardItemListingCount', { item, world, count: 0 }, timestamp)
    const service = this.options.service
    if (!service || world === 0) return
    void Promise.resolve()
      .then(() => {
        if (generation !== this.generation) return []
        return service.query(world, item)
      })
      .then((rows) => {
        if (generation !== this.generation || world !== this.options.world()) return
        const grouped = new Map<number, MarketComparison[]>()
        for (const row of rows) {
          if (row.world === world) continue
          const group = grouped.get(row.world) ?? []
          group.push(row)
          grouped.set(row.world, group)
        }
        for (const [otherWorld, group] of grouped) {
          this.options.emit('MarketBoardItemListingCount', { item, world: otherWorld, count: group.length }, timestamp)
          this.options.emit(
            'MarketBoardItemListing',
            {
              item,
              world: otherWorld,
              data: group.map(({ price, quantity, hq }) => ({ price, quantity, hq })),
            },
            timestamp,
          )
        }
      })
      .catch(() => this.options.onDiagnostic('Universalis query failed'))
  }

  private run(action: () => Promise<void> | undefined, diagnostic: string): void {
    const generation = this.generation
    void Promise.resolve()
      .then(() => (generation === this.generation ? action() : undefined))
      .catch(() => this.options.onDiagnostic(diagnostic))
  }
}
