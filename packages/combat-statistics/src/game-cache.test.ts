import type { DataRow } from '@ffcafe/mojito-plugin-sdk'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { type GameData, GameDataCache } from './game-cache.js'
import { memoryStorage } from './log/storage.test-helper.js'

/** Game data whose Action rows have the icon 1000 + id and the cooldown group 58; it counts every request */
function fakeData() {
  const calls: string[] = []
  const state = {
    version: 'v1' as string | null,
    closed: false,
    iconBytes: 4,
    rowsError: null as object | null,
    iconError: null as object | null,
  }
  const open = () => {
    if (state.closed) throw { code: 'unavailable' }
  }
  const data: GameData = {
    version: async () => {
      open()
      return state.version
    },
    name: async (kind, id, language) => {
      open()
      calls.push(`name:${kind}:${id}`)
      return id === 0 ? '' : `${kind} ${id} ${language}`
    },
    rows: async (sheet, ids) => {
      open()
      calls.push(`rows:${sheet}:${ids.join(',')}`)
      if (state.rowsError) throw state.rowsError
      return ids.map((rowId): DataRow => {
        const cells: DataRow['subrows'][number]['cells'] = Array.from({ length: 42 }, () => ({
          type: 'number',
          value: 0,
        }))
        cells[2] = { type: 'number', value: 1000 + rowId }
        cells[41] = { type: 'number', value: 58 }
        cells[6] = { type: 'number', value: 1 }
        return { rowId, subrows: [{ subrowId: null, cells }] }
      })
    },
    icon: async (id) => {
      open()
      calls.push(`icon:${id}`)
      if (state.iconError) throw state.iconError
      return { mime: 'image/png', width: 1, height: 1, data: new Uint8Array(state.iconBytes).fill(id % 256) }
    },
  }
  return { data, calls, state }
}

function setup(memory = memoryStorage(), game = fakeData()) {
  const warnings: string[] = []
  const cache = new GameDataCache(memory.storage, game.data, { warn: (message) => warnings.push(message) }, 100)
  return { cache, memory, game, warnings }
}
const stored = (files: Map<string, Uint8Array>) =>
  [...files.keys()].filter((name) => name.startsWith('game-data/')).sort()

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

it('reads a name, an icon and a column once', async () => {
  const { cache, game } = setup()
  await cache.validate('chs')
  for (let i = 0; i < 2; i++) {
    expect(await cache.name('action', 7)).toEqual({ name: 'action 7 chs', complete: true })
    expect(await cache.iconId('action:7')).toBe(1007)
    expect(await cache.icon(1007)).toMatchObject({ mime: 'image/png' })
    expect((await cache.columns('cooldownGroup', [7])).values.get(7)).toBe(58)
  }
  expect(game.calls).toEqual(['name:action:7', 'rows:Action:7', 'icon:1007', 'rows:Action:7'])
})

it('gives what an earlier cache stored without reading the game data, even while it is closed', async () => {
  const first = setup()
  await first.cache.validate('chs')
  await first.cache.name('status', 3)
  await first.cache.iconId('status:3')
  await first.cache.icon(1003)
  await first.cache.columns('statusCategory', [3])
  await first.cache.flush()
  expect(stored(first.memory.files)).toEqual([
    'game-data/icons/1003.png',
    'game-data/index.json',
    'game-data/names-chs.json',
  ])

  const game = fakeData()
  game.state.closed = true
  const second = setup(first.memory, game)
  await second.cache.load()
  await second.cache.validate(null)
  expect(second.cache.cached('status', 3)).toBe('status 3 chs')
  expect(await second.cache.name('status', 3)).toEqual({ name: 'status 3 chs', complete: true })
  expect(await second.cache.iconId('status:3')).toBe(1003)
  expect((await second.cache.icon(1003))?.data).toEqual(new Uint8Array(4).fill(1003 % 256))
  expect(await second.cache.columns('statusCategory', [3])).toEqual({ values: new Map([[3, 1]]), complete: true })
  expect(game.calls).toEqual([])
  // What it lacks cannot be read while the game data is closed.
  expect(await second.cache.name('status', 4)).toEqual({ name: null, complete: false })
  await expect(second.cache.iconId('status:4')).rejects.toMatchObject({ code: 'unavailable' })
  expect(await second.cache.columns('statusCategory', [3, 4])).toMatchObject({ complete: false })
})

it('drops everything when the version of the game data changes', async () => {
  const { cache, memory, game } = setup()
  await cache.validate('chs')
  await cache.name('action', 7)
  await cache.icon(1007)
  await cache.flush()
  game.state.version = 'v2'
  await cache.validate('chs')
  expect(stored(memory.files)).toEqual([])
  expect(cache.cached('action', 7)).toBeNull()
  await cache.name('action', 7)
  await cache.icon(1007)
  expect(game.calls).toEqual(['name:action:7', 'icon:1007', 'name:action:7', 'icon:1007'])
  await cache.flush()
  expect(new TextDecoder().decode(memory.files.get('game-data/index.json'))).toContain('"version":"v2"')
})

it('keeps working in memory on a host that cannot tell the version', async () => {
  const { cache, memory, game } = setup()
  game.data.version = async () => {
    throw { code: 'unavailable' }
  }
  await cache.validate('chs')
  expect(await cache.name('action', 7)).toEqual({ name: 'action 7 chs', complete: true })
  expect(await cache.icon(1007)).toMatchObject({ mime: 'image/png' })
  await cache.flush()
  expect(stored(memory.files)).toEqual([])
  await cache.name('action', 7)
  await cache.icon(1007)
  expect(game.calls).toEqual(['name:action:7', 'icon:1007'])
})

it('keeps everything in memory only while the game data has no version', async () => {
  const { cache, memory, game } = setup()
  game.state.version = null
  await cache.validate('chs')
  await cache.name('action', 7)
  await cache.icon(1007)
  await vi.advanceTimersByTimeAsync(5000)
  await cache.flush()
  expect(stored(memory.files)).toEqual([])
  await cache.name('action', 7)
  expect(game.calls).toEqual(['name:action:7', 'icon:1007'])
})

it('writes the index and the names a while after the last change', async () => {
  const { cache, memory } = setup()
  await cache.validate('chs')
  await cache.name('action', 7)
  expect(stored(memory.files)).toEqual([])
  await vi.advanceTimersByTimeAsync(2000)
  expect(stored(memory.files)).toEqual(['game-data/index.json', 'game-data/names-chs.json'])
})

it('drops the oldest icon files over the size limit', async () => {
  const { cache, memory, game } = setup()
  game.state.iconBytes = 1024 * 1024
  await cache.validate('chs')
  for (const id of [1, 2, 3, 4]) await cache.icon(id)
  expect(stored(memory.files)).toEqual(['game-data/icons/2.png', 'game-data/icons/3.png', 'game-data/icons/4.png'])
})

it('drops the oldest names over the limit', async () => {
  const { cache } = setup()
  await cache.validate('chs')
  for (let id = 1; id <= 8001; id++) await cache.name('action', id)
  expect(cache.cached('action', 1)).toBeNull()
  expect(cache.cached('action', 2)).toBe('action 2 chs')
  expect(cache.all('action').size).toBe(8000)
})

it('keeps working in memory when the storage is full, and warns once', async () => {
  const { cache, memory, game, warnings } = setup()
  await cache.validate('chs')
  for (let i = 0; i < 4; i++) memory.failures.push(() => ({ code: 'quota_exceeded' }))
  expect(await cache.icon(1)).toMatchObject({ mime: 'image/png' })
  expect(await cache.icon(2)).toMatchObject({ mime: 'image/png' })
  expect(await cache.name('action', 7)).toMatchObject({ name: 'action 7 chs' })
  await cache.flush()
  expect(stored(memory.files)).toEqual([])
  expect(await cache.icon(1)).toMatchObject({ mime: 'image/png' })
  expect(game.calls).toEqual(['icon:1', 'icon:2', 'name:action:7'])
  expect(warnings).toEqual(['游戏数据缓存写入失败'])
})

it('asks again after a while for a name the game data lacks, without storing it', async () => {
  let now = 0
  const game = fakeData()
  const memory = memoryStorage()
  const cache = new GameDataCache(memory.storage, game.data, { warn() {} }, 100, () => now)
  await cache.validate('chs')
  expect(await cache.name('action', 0)).toEqual({ name: null, complete: true })
  expect(await cache.name('action', 0)).toEqual({ name: null, complete: true })
  now = 60_000
  await cache.name('action', 0)
  expect(game.calls).toEqual(['name:action:0', 'name:action:0'])
})

it('keeps the names of the language of the open game data only', async () => {
  const { cache, memory, game } = setup()
  await cache.validate('chs')
  await cache.name('action', 7)
  await cache.flush()
  await cache.validate('ja')
  expect(cache.cached('action', 7)).toBeNull()
  expect(await cache.name('action', 7)).toMatchObject({ name: 'action 7 ja' })
  await cache.flush()
  expect(stored(memory.files)).toEqual(['game-data/index.json', 'game-data/names-ja.json'])
  expect(game.calls).toEqual(['name:action:7', 'name:action:7'])
})

it('keeps nothing of a row or icon the host failed to read for another reason than its absence', async () => {
  const { cache, game } = setup()
  await cache.validate('chs')
  game.state.rowsError = { code: 'quota_exceeded' }
  await expect(cache.iconId('action:1')).rejects.toEqual({ code: 'quota_exceeded' })
  game.state.rowsError = null
  expect(await cache.iconId('action:1')).toBe(1001)
  expect(game.calls.filter((call) => call === 'rows:Action:1')).toHaveLength(2)

  game.state.iconError = { code: 'quota_exceeded' }
  await expect(cache.icon(1001)).rejects.toEqual({ code: 'quota_exceeded' })
  game.state.iconError = null
  expect(await cache.icon(1001)).toMatchObject({ mime: 'image/png' })
  expect(game.calls.filter((call) => call === 'icon:1001')).toHaveLength(2)
})

it.each(['not_found', 'invalid_argument'])('keeps a row or icon the host reports %s as missing', async (code) => {
  const { cache, game } = setup()
  await cache.validate('chs')
  game.state.rowsError = game.state.iconError = { code }
  expect(await cache.iconId('action:2')).toBeNull()
  expect(await cache.icon(1002)).toBeNull()
  game.state.rowsError = game.state.iconError = null
  const calls = game.calls.length
  expect(await cache.iconId('action:2')).toBeNull()
  expect(await cache.icon(1002)).toBeNull()
  expect(game.calls).toHaveLength(calls)
})
