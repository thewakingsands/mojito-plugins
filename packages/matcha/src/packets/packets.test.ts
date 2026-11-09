import { describe, expect, it, vi } from 'vitest'
import type { MatchaPacket } from '../protocol.js'
import { MatchaPacketHandlers } from './index.js'
import type { MatchaMarketService } from './market.js'

function packet(type: string | null, size: number, direction: MatchaPacket['direction'] = 'recv') {
  const data = new Uint8Array(size)
  const view = new DataView(data.buffer)
  const value: MatchaPacket = {
    type,
    data,
    seq: 1,
    timestamp: 1_700_000_000_000,
    direction,
    channel: 'zone',
    opcode: 0xabcd,
    sourceActor: 0x10000001,
    targetActor: 0x10000001,
    serverId: 1,
    ipcTimestamp: 1,
  }
  return {
    value,
    u8(offset: number, n: number) {
      view.setUint8(offset, n)
      return this
    },
    u16(offset: number, n: number) {
      view.setUint16(offset, n, true)
      return this
    },
    u32(offset: number, n: number) {
      view.setUint32(offset, n, true)
      return this
    },
    u64(offset: number, n: bigint) {
      view.setBigUint64(offset, n, true)
      return this
    },
    f32(offset: number, n: number) {
      view.setFloat32(offset, n, true)
      return this
    },
    text(offset: number, s: string) {
      data.set(new TextEncoder().encode(s), offset)
      return this
    },
  }
}

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}
const ac = (category: number) => packet('ActorControlSelf', 40).u16(0, category)
const count = (n: number) => packet('MarketBoardItemListingCount', 8).u32(4, n)
const query = (item: number) => packet('MarketBoardRequestItemListingInfo', 8, 'send').u32(0, item)
const history = (item: number) => packet('MarketBoardItemListingHistory', 964).u32(0, item)
function listing(item: number, ids: bigint[] = [1n], requestId = 7) {
  const data = packet('MarketBoardItemListing', 1444).u16(1442, requestId)
  ids.forEach((id, i) => {
    const base = i * 144
    data
      .u64(base, id)
      .u64(base + 8, 9007199254740993n)
      .u64(base + 16, 23n)
      .u64(base + 24, 25n)
      .u32(base + 32, 500)
      .u32(base + 40, 7)
      .u32(base + 44, item)
      .u16(base + 54, 0x32)
      .text(base + 70, '雇员甲')
      .u8(base + 134, 1)
      .u8(base + 137, 2)
      .u8(base + 138, 3)
      .u8(base + 139, 4)
  })
  return data
}

function setup(market?: MatchaMarketService) {
  const emit = vi.fn()
  const onDiagnostic = vi.fn()
  let time = 1_700_000_000_000
  const handlers = new MatchaPacketHandlers({ emit, onDiagnostic, market, now: () => time })
  return {
    emit,
    onDiagnostic,
    handlers,
    advance: (amount: number) => {
      time += amount
    },
  }
}

describe('Matcha packet compatibility', () => {
  it('uses IPC payload offsets and preserves non-zero Uint8Array byte offsets', () => {
    const { emit, handlers } = setup()
    const scratch = packet('ResumeEventScene32', 136).u32(0, 0x250000).u32(12, 2).u32(16, 1).u32(20, 9)
    const transport = new Uint8Array(160)
    transport.set(scratch.value.data, 11)
    handlers.handle({ ...scratch.value, data: transport.subarray(11, 147) })
    expect(emit).toHaveBeenCalledExactlyOnceWith(
      'MiniCactpot',
      { isNewGame: true, x: 2, y: 1, value: 9 },
      scratch.value.timestamp,
    )
    handlers.handle(ac(109).u32(4, 0x250000).u32(8, 2).u32(12, 0).u32(16, 1).u32(20, 3).value)
    expect(emit.mock.calls[1][1]).toEqual({ isNewGame: false, x: 0, y: 1, value: 3 })
    handlers.handle(ac(109).u32(4, 0x250000).u32(8, 2).u32(12, 3).u32(20, 1).value)
    expect(emit).toHaveBeenCalledTimes(2)
  })

  it('decodes equipped items, removals and all 14 examined slots with UTF-8 names', () => {
    const { emit, handlers } = setup()
    const item = packet('ItemInfo', 64)
      .u16(8, 1000)
      .u16(10, 2)
      .u32(16, 54321)
      .u8(32, 1)
      .u32(40, 987)
      .u16(44, 11)
      .u8(54, 4)
      .u16(52, 15)
      .u8(58, 8)
    handlers.handle(item.value)
    expect(emit.mock.calls[0][1]).toEqual({
      self: true,
      name: '',
      slot: 2,
      item: 54321,
      hq: true,
      glamour: 987,
      materias: [
        { type: 11, tier: 4 },
        { type: 0, tier: 0 },
        { type: 0, tier: 0 },
        { type: 0, tier: 0 },
        { type: 15, tier: 8 },
      ],
    })
    item.u16(8, 0)
    handlers.handle(item.value)
    expect(emit).toHaveBeenCalledTimes(1)
    handlers.handle(packet('InventoryTransaction', 48).u16(12, 1000).u16(16, 2).value)
    expect(emit.mock.calls[1][1]).toMatchObject({ self: true, slot: 2, item: 0, materias: [] })
    handlers.handle(
      packet('Examine', 944).u32(80, 444).u8(96, 1).u16(98, 12).u16(100, 5).u32(600, 777).text(640, '蜜酱萝卜煎肉')
        .value,
    )
    expect(emit).toHaveBeenCalledTimes(16)
    expect(emit.mock.calls[2][1]).toMatchObject({
      self: false,
      name: '蜜酱萝卜煎肉',
      item: 444,
      hq: true,
      materias: [
        { type: 12, tier: 5 },
        { type: 0, tier: 0 },
        { type: 0, tier: 0 },
        { type: 0, tier: 0 },
        { type: 0, tier: 0 },
      ],
    })
    expect(emit.mock.calls[15][1]).toMatchObject({ slot: 13, item: 777 })
  })

  it('decodes queue stages, roulette/instance alerts and four airships', () => {
    const { emit, handlers } = setup()
    handlers.handle(packet('WorldVisitQueue', 12).u32(0, 2).u32(4, 47).u32(8, 120).value)
    expect(emit.mock.calls[0][1]).toEqual({ type: 'world-visit', stage: 'ready', order: 47, time: 120 })
    handlers.handle(packet('ContentFinderNotifyPop', 40).u16(28, 222).value)
    expect(emit.mock.calls[1]).toEqual(['MatchAlert', { roulette: 0, instance: 222 }, 1_700_000_000_000])
    handlers.handle(packet('CFNotifyPop', 40).u16(2, 10).u16(28, 222).value)
    expect(emit.mock.calls[2][1]).toEqual({ roulette: 10, instance: 0 })
    handlers.handle(
      packet('CompanyAirshipStatus', 144)
        .u32(108, 123456789)
        .u16(112, 99)
        .text(114, '飞空艇')
        .u8(137, 1)
        .u8(138, 2)
        .u8(139, 3)
        .u8(140, 4)
        .u8(141, 5).value,
    )
    expect(emit.mock.calls[3][1]).toMatchObject({
      type: 'airship',
      list: expect.arrayContaining([
        { returnTime: 123456789, maxDistance: 99, name: '飞空艇', destination: [1, 2, 3, 4, 5] },
      ]),
    })
    expect(emit.mock.calls[3][1].list).toHaveLength(4)
  })

  it('decodes treasure spots and only recognizes unknown packets with exact scene discriminators', () => {
    const { emit, handlers } = setup()
    handlers.handle(ac(84).u32(4, 234).u32(8, 567).u32(12, 1).value)
    expect(emit.mock.calls[0][1]).toEqual({ item: 234, location: 567, isNew: true })
    handlers.handle(packet(null, 56).u32(24, 9413549).u8(40, 195).value)
    handlers.handle(packet(null, 64).u32(16, 0x04482c03).u8(32, 3).u8(40, 1).value)
    expect(emit.mock.calls.slice(1).map((row) => row[1])).toEqual([
      { value: 'wheel-special', round: 0 },
      { value: 'gate-open', round: 4 },
    ])
    for (const bad of [packet('OtherNamedPacket', 56), packet(null, 57), packet(null, 56, 'send')]) {
      bad.u32(24, 9413549).u8(40, 195)
      handlers.handle(bad.value)
    }
    handlers.handle(packet(null, 56).u32(24, 1234).u8(40, 195).value)
    expect(emit).toHaveBeenCalledTimes(3)
  })

  it('keeps zone/content, world and dynamic event fields distinct; reset removes old character state', () => {
    const { emit, handlers } = setup()
    handlers.setWorld(1060)
    handlers.handle(packet('InitZone', 136).u16(0, 5).u16(2, 814).u16(4, 3).u16(6, 420).value)
    const other = packet('PlayerSpawn', 24).u16(20, 2000).value
    handlers.handle({ ...other, targetActor: 0x10000002 })
    expect(handlers.snapshot().world).toBe(1060)
    handlers.handle(packet('CEDirector', 16).u32(0, 99).u32(4, 15).u8(8, 4).u8(9, 48).u8(10, 2).u8(12, 60).value)
    expect(emit.mock.calls[0][1]).toEqual({ zone: 814, instance: 420 })
    expect(emit.mock.calls[1][1]).toEqual({
      zone: 814,
      nextStage: 99,
      countdown: 15,
      event: 4,
      participants: 48,
      stage: 2,
      progress: 60,
    })
    handlers.handle(ac(325).u32(4, 55).value)
    expect(handlers.snapshot()).toMatchObject({
      world: 1060,
      server: 5,
      zone: 814,
      instance: 3,
      content: 420,
      bait: 55,
    })
    handlers.handle(packet('PlayerSetup', 8).value)
    expect(handlers.snapshot()).toEqual({
      world: 0,
      server: 0,
      zone: 0,
      instance: 0,
      content: 0,
      bait: 0,
      lastZoneChange: 0,
      npcs: [],
      fates: [],
    })
  })

  it('tracks FATE state, terminal observations and NPC deaths without leaking references', () => {
    const { emit, handlers } = setup()
    handlers.setWorld(1060)
    handlers.handle(packet('FateInfo', 24).u16(0, 8).u32(8, 1_700_000_000).u32(16, 600).value)
    handlers.handle(ac(2370).u16(4, 8).value)
    handlers.handle(ac(2364).u16(4, 8).u8(8, 100).value)
    handlers.handle(ac(2357).u16(4, 8).u16(28, 10).value)
    expect(emit.mock.calls.map((row) => row[1])).toEqual([
      { type: 'start', fate: 8, progress: 0, extra: 0 },
      { type: 'progress', fate: 8, progress: 100, extra: 0 },
      { type: 'end', fate: 8, progress: 0, extra: 10 },
    ])
    expect(handlers.snapshot().fates).toEqual([])
    expect(handlers.drainObservations().at(-1)).toMatchObject({
      type: 'fate',
      world: 1060,
      state: { id: 8, progress: -1 },
    })
    const npc = packet('NpcSpawn', 656)
      .u32(68, 2919)
      .u32(72, 123)
      .u32(92, 500)
      .u32(96, 450)
      .u8(127, 50)
      .f32(508, 123.5)
      .f32(512, -4)
      .f32(516, 567.25)
    handlers.handle(npc.value)
    const snapshot = handlers.snapshot()
    expect(snapshot.npcs[0]).toMatchObject({
      bNpcName: 2919,
      curHP: 450,
      maxHP: 500,
      position: { x: 123.5, y: -4, z: 567.25 },
    })
    snapshot.npcs[0].position.x = 999
    expect(handlers.snapshot().npcs[0].position.x).toBe(123.5)
    handlers.handle(packet('ActorControl', 24).u16(0, 2).u32(4, 2).value)
    expect(handlers.snapshot().npcs).toEqual([])
    expect(handlers.drainObservations().at(-1)).toMatchObject({ type: 'npc', state: { curHP: 0 } })
    expect(handlers.drainObservations()).toEqual([])
  })

  it.each([
    ['ResumeEventScene32', 136],
    ['InitZone', 136],
    ['NpcSpawn', 656],
    ['ActorControl', 24],
    ['ActorControlSelf', 40],
    ['FateInfo', 24],
    ['PlayerSpawn', 24],
    ['ItemInfo', 64],
    ['InventoryTransaction', 48],
    ['Examine', 944],
    ['ContentFinderNotifyPop', 40],
    ['CompanyAirshipStatus', 144],
    ['WorldVisitQueue', 12],
    ['CEDirector', 13],
    ['MarketBoardItemListingCount', 8],
    ['MarketBoardItemListing', 1444],
    ['MarketBoardItemListingHistory', 964],
  ])('rejects truncated %s before exposing partial output or mutating state', (type, size) => {
    const { emit, onDiagnostic, handlers } = setup()
    handlers.setWorld(1060)
    const before = handlers.snapshot()
    handlers.handle(packet(type, size - 1).value)
    expect(emit).not.toHaveBeenCalled()
    expect(handlers.snapshot()).toEqual(before)
    expect(onDiagnostic).toHaveBeenCalledTimes(1)
  })

  it('ignores non-zone traffic and wrongly directed server packets', () => {
    const { emit, handlers } = setup()
    const p = ac(84).u32(4, 9).value
    handlers.handle({ ...p, channel: 'chat' })
    handlers.handle({ ...p, direction: 'send' })
    expect(emit).not.toHaveBeenCalled()
  })
})

describe('market request correlation', () => {
  it('rejects repeated listing identities in one page and failed count responses', async () => {
    const service = { query: async () => [], upload: vi.fn(async () => {}) }
    const { handlers } = setup(service)
    handlers.setWorld(1060)
    handlers.handle(query(42).value)
    handlers.handle(count(2).value)
    handlers.handle(listing(42, [1n, 1n]).value)
    handlers.handle(history(42).value)
    await flush()
    expect(service.upload).not.toHaveBeenCalled()
    handlers.handle(count(1).u32(0, 0x70000003).value)
    handlers.handle(listing(42).value)
    handlers.handle(history(42).value)
    await flush()
    expect(service.upload).not.toHaveBeenCalled()
  })

  it('uploads taxes only for the result category and valid rates', async () => {
    const service = { query: async () => [], upload: async () => {}, uploadTaxRates: vi.fn(async () => {}) }
    const { handlers } = setup(service)
    handlers.setWorld(1060)
    const taxes = packet('ResultDialog', 40).u32(0, 0xb0009).u32(8, 5).u32(12, 3).u32(36, 4)
    handlers.handle(taxes.value)
    await flush()
    expect(service.uploadTaxRates).toHaveBeenCalledExactlyOnceWith(1060, {
      limsaLominsa: 5,
      gridania: 3,
      uldah: 0,
      ishgard: 0,
      kugane: 0,
      crystarium: 0,
      sharlayan: 0,
      tuliyollal: 4,
    })
    handlers.handle(taxes.u32(0, 99).value)
    handlers.handle(taxes.u32(0, 0xb0009).u32(8, 101).value)
    await flush()
    expect(service.uploadTaxRates).toHaveBeenCalledTimes(1)
  })

  it('combines listing pages and history, preserving 64-bit IDs and exact DTO casing', async () => {
    const service = { query: vi.fn(async () => []), upload: vi.fn(async () => {}) }
    const { emit, handlers } = setup(service)
    handlers.setWorld(1060)
    handlers.handle(query(42).value)
    handlers.handle(count(11).value)
    handlers.handle(history(42).u32(4, 123).u32(8, 1699999999).u32(12, 2).u8(16, 1).text(18, '买家').value)
    handlers.handle(
      listing(
        42,
        Array.from({ length: 10 }, (_, i) => BigInt(i + 1)),
      ).value,
    )
    await flush()
    expect(service.upload).not.toHaveBeenCalled()
    handlers.handle(listing(42, [11n]).value)
    await flush()
    expect(service.upload).toHaveBeenCalledTimes(1)
    const result = service.upload.mock.calls[0][0]
    expect(result).toMatchObject({
      world: 1060,
      item: 42,
      sales: [
        { pricePerUnit: 123, quantity: 2, timestamp: 1699999999, buyerName: '买家', hq: true, onMannequin: false },
      ],
    })
    expect(result.listings).toHaveLength(11)
    expect(result.listings[0]).toMatchObject({
      retainerID: '9007199254740993',
      retainerName: '雇员甲',
      materia: [{ materiaID: 3, slotID: 2 }],
      stainID: 1027,
    })
    expect(emit.mock.calls[0][1]).toEqual({ item: 42, world: 1060, count: 0 })
    expect(emit.mock.calls[1][1]).toMatchObject({
      item: 42,
      world: 1060,
      data: [{ price: 500, quantity: 7, hq: true }, ...Array(9).fill({ price: 500, quantity: 7, hq: true })],
    })
  })

  it('also initializes from the first server page without outgoing capture and supports empty markets', async () => {
    const service = { query: vi.fn(async () => []), upload: vi.fn(async () => {}) }
    const { emit, handlers } = setup(service)
    handlers.setWorld(1060)
    handlers.handle(count(1).value)
    handlers.handle(listing(42).value)
    handlers.handle(history(42).value)
    await flush()
    expect(emit.mock.calls[0][0]).toBe('MarketBoardItemListingCount')
    expect(service.query).toHaveBeenCalledWith(1060, 42)
    expect(service.upload).toHaveBeenCalledTimes(1)
    handlers.handle(query(43).value)
    handlers.handle(count(0).value)
    handlers.handle(history(43).value)
    await flush()
    expect(service.upload.mock.calls[1][0]).toEqual({ world: 1060, item: 43, listings: [], sales: [] })
  })

  it('initializes every successive recv-only query and keeps each batch associated with its own item', async () => {
    const service = { query: vi.fn(async () => []), upload: vi.fn(async () => {}) }
    const { emit, handlers } = setup(service)
    handlers.setWorld(1060)
    for (const item of [42, 43]) {
      handlers.handle(count(1).value)
      handlers.handle(listing(item).value)
      handlers.handle(history(item).value)
      await flush()
    }
    expect(
      emit.mock.calls.filter(([type]) => type === 'MarketBoardItemListingCount').map(([, data]) => data.item),
    ).toEqual([42, 43])
    expect(service.query.mock.calls).toEqual([
      [1060, 42],
      [1060, 43],
    ])
    expect(service.upload.mock.calls.map(([batch]) => batch.item)).toEqual([42, 43])
  })

  it.each(['duplicate', 'request', 'item', 'expired', 'world', 'reset'] as const)(
    'does not upload a %s batch',
    async (cause) => {
      const service = { query: vi.fn(async () => []), upload: vi.fn(async () => {}) }
      const { handlers, advance } = setup(service)
      handlers.setWorld(1060)
      handlers.handle(query(42).value)
      handlers.handle(count(2).value)
      handlers.handle(listing(42, [1n]).value)
      if (cause === 'expired') advance(30_001)
      if (cause === 'world') handlers.setWorld(1061)
      if (cause === 'reset') handlers.reset()
      handlers.handle(
        listing(cause === 'item' ? 43 : 42, [cause === 'duplicate' ? 1n : 2n], cause === 'request' ? 8 : 7).value,
      )
      handlers.handle(history(42).value)
      await flush()
      expect(service.upload).not.toHaveBeenCalled()
    },
  )

  it('discards late cross-world comparisons after another query or session change', async () => {
    let finish: (value: { world: number; price: number; quantity: number; hq: boolean }[]) => void = () => {}
    const service: MatchaMarketService = {
      query: () =>
        new Promise((resolve) => {
          finish = resolve
        }),
      upload: async () => {},
    }
    const { emit, handlers } = setup(service)
    handlers.setWorld(1060)
    handlers.handle(query(42).value)
    await flush()
    handlers.reset()
    finish([{ world: 1061, price: 1, quantity: 2, hq: false }])
    await flush()
    expect(emit).toHaveBeenCalledTimes(1)
  })

  it('groups comparison results by world, excluding the locally captured world', async () => {
    const service: MatchaMarketService = {
      query: async () => [
        { world: 1060, price: 1, quantity: 2, hq: false },
        { world: 1061, price: 3, quantity: 4, hq: true },
      ],
      upload: async () => {},
    }
    const { emit, handlers } = setup(service)
    handlers.setWorld(1060)
    handlers.handle(query(42).value)
    await flush()
    expect(emit.mock.calls.slice(1).map((row) => row[1])).toEqual([
      { world: 1061, item: 42, count: 1 },
      { world: 1061, item: 42, data: [{ price: 3, quantity: 4, hq: true }] },
    ])
  })

  it('only deletes a purchased listing after the matching server acknowledgment', async () => {
    const service = { query: async () => [], upload: async () => {}, deleteListing: vi.fn(async () => {}) }
    const { handlers } = setup(service)
    handlers.setWorld(1060)
    const buy = packet('MarketBoardPurchaseHandler', 36, 'send')
      .u64(0, 222n)
      .u64(8, 333n)
      .u32(16, 42)
      .u32(20, 7)
      .u32(24, 500)
    handlers.handle(buy.value)
    await flush()
    expect(service.deleteListing).not.toHaveBeenCalled()
    handlers.handle(packet('MarketBoardPurchase', 12).u32(0, 42).u32(8, 7).value)
    await flush()
    expect(service.deleteListing).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        world: 1060,
        item: 42,
        retainerID: '222',
        listingID: '333',
        quantity: 7,
        pricePerUnit: 500,
      }),
    )
    handlers.handle(buy.value)
    handlers.handle(packet('MarketBoardPurchase', 12).u32(0, 99).u32(8, 7).value)
    await flush()
    expect(service.deleteListing).toHaveBeenCalledTimes(1)
  })
})
