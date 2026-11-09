import type { GameService, MemoryService, SessionService, SessionSnapshot, SourceMeta } from '@ffcafe/mojito-plugin-sdk'
import { describe, expect, it, vi } from 'vitest'
import { deferred, flush } from './fixtures.test-helper.js'
import { createFishingMemoryReader } from './memory.js'

function fixture() {
  let generation = 1,
    now = 1000,
    job = 18,
    actor = 1,
    loaded = 1,
    missing = false,
    failed = false,
    gp = 0
  let mutateDuringRead = false
  const meta = (): SourceMeta => ({
    sessionId: 's',
    characterGeneration: generation,
    source: 'live',
    observedAt: now,
    timeBase: 'host-monotonic-unix',
    clockGeneration: 1,
    sampleStartedAt: now,
    sampleEndedAt: now,
  })
  const sessionGet = vi.fn(
    async () =>
      ({
        state: 'live',
        login: 'logged-in',
        sessionId: 's',
        characterGeneration: generation,
        character: { actorId: 1, contentId: 1n },
      }) as SessionSnapshot,
  )
  const resolve = vi.fn<MemoryService['resolve']>(async () => ({
    meta: meta(),
    value: { addresses: [0x1000], build: 'test' },
  }))
  let reads = 0
  const read = vi.fn<MemoryService['read']>(async (selection) => {
    if (failed) throw new Error('permission_denied')
    reads++
    if (mutateDuringRead && reads % 2 === 0) actor = 2
    return Object.fromEntries(
      selection.ranges.map(({ key, length }) => {
        const data = new Uint8Array(missing && key === 'attributes' ? 4 : length),
          view = new DataView(data.buffer)
        if (key === 'loaded') view.setUint8(0, loaded)
        if (key === 'job') view.setUint8(0, job)
        if (key === 'actor') view.setUint32(0, actor, true)
        if (key === 'bait') view.setUint32(0, 10, true)
        if (key === 'attributes') {
          view.setUint32(0, 200, true)
          if (length === data.length) view.setUint32(4, 300, true)
        }
        return [key, { meta: meta(), value: { data } }]
      }),
    )
  })
  const getPlayer = vi.fn<GameService['getPlayer']>(async () => ({
    meta: meta(),
    value: {
      actorId: { state: 'ok', value: 1, observedAt: now, timeBase: 'host-monotonic-unix', from: 'memory' },
      gpCur: { state: 'ok', value: gp, observedAt: now, timeBase: 'host-monotonic-unix', from: 'memory' },
      gpMax: { state: 'ok', value: 600, observedAt: now, timeBase: 'host-monotonic-unix', from: 'memory' },
    },
  }))
  const reader = createFishingMemoryReader({
    memory: { resolve, read } as unknown as MemoryService,
    game: { getPlayer } as unknown as GameService,
    session: { get: sessionGet } as unknown as SessionService,
    now: () => now,
  })
  return {
    reader,
    resolve,
    read,
    sessionGet,
    getPlayer,
    change(options: {
      generation?: number
      now?: number
      job?: number
      actor?: number
      loaded?: number
      missing?: boolean
      failed?: boolean
      gp?: number
      mutate?: boolean
    }) {
      generation = options.generation ?? generation
      now = options.now ?? now
      job = options.job ?? job
      actor = options.actor ?? actor
      loaded = options.loaded ?? loaded
      missing = options.missing ?? missing
      failed = options.failed ?? failed
      gp = options.gp ?? gp
      mutateDuringRead = options.mutate ?? mutateDuringRead
    },
  }
}
describe('fishing SDK memory adapter', () => {
  it('binds reads to the session, caches resolved addresses and retains a valid zero GP', async () => {
    const f = fixture()
    expect(await f.reader.read()).toEqual({
      sampledAt: 1000,
      gathering: 200,
      perception: 300,
      currentGp: 0,
      maxGp: 600,
      baitId: 10,
    })
    expect(f.read.mock.calls[0][0]).toMatchObject({
      sessionId: 's',
      characterGeneration: 1,
      ranges: expect.arrayContaining([
        { key: 'attributes', address: 0x12c8, length: 8 },
        { key: 'bait', address: 0x14e4, length: 4 },
      ]),
    })
    await f.reader.read()
    expect(f.resolve).toHaveBeenCalledTimes(1)
    f.change({ generation: 2 })
    await f.reader.read()
    expect(f.resolve).toHaveBeenCalledTimes(2)
    const result = f.reader.snapshot!
    result.gathering = 0
    expect(f.reader.snapshot?.gathering).toBe(200)
  })
  it('rejects wrong jobs, unloaded state, partial reads and identity changes during sampling', async () => {
    for (const changes of [
      { job: 1 },
      { loaded: 0 },
      { actor: 2 },
      { missing: true },
      { failed: true },
      { mutate: true },
    ]) {
      const f = fixture()
      f.change(changes)
      const result = await f.reader.read()
      expect(result.gathering).toBeNull()
      expect(result.unavailable).toBeTruthy()
    }
    const f = fixture()
    f.change({ gp: 601 })
    const result = await f.reader.read()
    expect(result).toMatchObject({ gathering: 200, currentGp: null, maxGp: null })
    expect(result.unavailable).toContain('采集力点数')
  })
  it('coalesces reads and aborts work so reset/dispose cannot restore old snapshots', async () => {
    const f = fixture(),
      pause = deferred<SessionSnapshot>()
    f.sessionGet.mockImplementationOnce(() => pause.promise)
    const operation = f.reader.read()
    expect(f.reader.read()).toBe(operation)
    f.reader.reset()
    pause.resolve({ state: 'live', login: 'logged-in', sessionId: 's', characterGeneration: 1 } as SessionSnapshot)
    await operation
    await flush()
    expect(f.resolve).not.toHaveBeenCalled()
    expect(f.reader.snapshot).toBeNull()
    await f.reader.read()
    expect(f.reader.snapshot?.gathering).toBe(200)
    f.reader.dispose()
    expect(f.reader.snapshot).toBeNull()
    expect((await f.reader.read()).unavailable).toContain('停止')
  })
})
