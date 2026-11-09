import type { GameService, MemoryService, SessionService } from '@ffcafe/mojito-plugin-sdk'
import type { FishingAttributes } from './types.js'

export interface FishingMemoryReaderOptions {
  memory: MemoryService
  game: GameService
  session: SessionService
  now: () => number
}
/** Read-only adapter. Mojito owns signatures, process identity, quotas and handle lifetime. */
export function createFishingMemoryReader(options: FishingMemoryReaderOptions) {
  let cached: { sessionId: string; generation: number; address: number } | null = null
  let epoch = 0
  let disposed = false
  let cancellation = new AbortController()
  let pending: Promise<FishingAttributes> | null = null
  let snapshot: FishingAttributes | null = null
  const empty = (reason: string): FishingAttributes => ({
    sampledAt: options.now(),
    gathering: null,
    perception: null,
    currentGp: null,
    maxGp: null,
    baitId: null,
    unavailable: reason,
  })
  const sample = async (): Promise<FishingAttributes> => {
    const started = options.now(),
      captured = epoch
    const signal = cancellation.signal
    try {
      const session = await options.session.get({ signal })
      signal.throwIfAborted()
      if (disposed || session.state !== 'live' || session.login !== 'logged-in' || !session.sessionId)
        return empty('当前未连接已登录的游戏角色。')
      const sessionId = session.sessionId,
        generation = session.characterGeneration
      if (!cached || cached.sessionId !== sessionId || cached.generation !== generation) {
        const resolved = await options.memory.resolve({ kind: 'builtin', name: 'playerState' }, { signal })
        signal.throwIfAborted()
        if (
          resolved.meta.sessionId !== sessionId ||
          resolved.meta.characterGeneration !== generation ||
          resolved.value.addresses.length !== 1
        )
          return empty('角色内存签名不可用或角色已切换。')
        cached = { sessionId, generation, address: resolved.value.addresses[0] }
      }
      const address = cached.address
      const selection = {
        sessionId,
        characterGeneration: generation,
        ranges: [
          { key: 'loaded', address, length: 1 },
          { key: 'actor', address: address + 0x64, length: 4 },
          { key: 'job', address: address + 0x7e, length: 1 },
          { key: 'attributes', address: address + 0x2c8, length: 8 },
          { key: 'bait', address: address + 0x4e4, length: 4 },
        ],
      }
      const first = await options.memory.read(selection, { signal })
      signal.throwIfAborted()
      const bytes = (values: typeof first, key: string, length: number) => {
        const value = values[key]
        if (
          !value ||
          value.meta.sessionId !== sessionId ||
          value.meta.characterGeneration !== generation ||
          !('data' in value.value) ||
          value.value.data.length !== length
        )
          throw new Error('Incomplete or stale memory sample')
        return new DataView(value.value.data.buffer, value.value.data.byteOffset, length)
      }
      const loaded = bytes(first, 'loaded', 1).getUint8(0),
        actor = bytes(first, 'actor', 4).getUint32(0, true),
        job = bytes(first, 'job', 1).getUint8(0)
      if (
        loaded !== 1 ||
        actor === 0 ||
        job !== 18 ||
        (session.character?.actorId !== null &&
          session.character?.actorId !== undefined &&
          session.character.actorId !== actor)
      )
        return empty('角色尚未就绪或当前职业不是捕鱼人。')
      const stats = bytes(first, 'attributes', 8),
        bait = bytes(first, 'bait', 4).getUint32(0, true)
      const player = await options.game.getPlayer({ fields: ['actorId', 'gpCur', 'gpMax'] }, { signal })
      signal.throwIfAborted()
      const guard = await options.memory.read({ ...selection, ranges: selection.ranges.slice(0, 3) }, { signal })
      signal.throwIfAborted()
      const after = await options.session.get({ signal })
      if (
        captured !== epoch ||
        disposed ||
        after.sessionId !== sessionId ||
        after.characterGeneration !== generation ||
        after.login !== 'logged-in' ||
        bytes(guard, 'loaded', 1).getUint8(0) !== loaded ||
        bytes(guard, 'actor', 4).getUint32(0, true) !== actor ||
        bytes(guard, 'job', 1).getUint8(0) !== job
      )
        return empty('采样期间角色已切换。')
      const positive = (value: number) => (value > 0 && value < 100000 ? value : null)
      let currentGp: number | null = null,
        maxGp: number | null = null
      if (
        player.meta.sessionId === sessionId &&
        player.meta.characterGeneration === generation &&
        player.value.actorId?.state === 'ok' &&
        player.value.actorId.value === actor &&
        player.value.gpCur?.state === 'ok' &&
        player.value.gpMax?.state === 'ok'
      ) {
        currentGp = player.value.gpCur.value
        maxGp = player.value.gpMax.value
        if (!Number.isInteger(currentGp) || !Number.isInteger(maxGp) || currentGp < 0 || maxGp < 0 || currentGp > maxGp)
          currentGp = maxGp = null
      }
      const gathering = positive(stats.getInt32(0, true)),
        perception = positive(stats.getInt32(4, true))
      return {
        sampledAt: started,
        gathering,
        perception,
        currentGp,
        maxGp,
        baitId: bait || null,
        ...(gathering === null || perception === null || currentGp === null
          ? { unavailable: '采集力、获得力或采集力点数不可用；不上传不完整记录。' }
          : {}),
      }
    } catch {
      return empty('只读内存能力未授权、签名不可用或当前采样失败。')
    }
  }
  return {
    get snapshot(): FishingAttributes | null {
      return structuredClone(snapshot)
    },
    read(): Promise<FishingAttributes> {
      if (disposed) return Promise.resolve(empty('钓鱼内存读取已停止。'))
      if (pending) return pending
      const generation = epoch
      const operation = sample()
        .then((value) => {
          if (epoch === generation && !disposed) snapshot = value
          return value
        })
        .finally(() => {
          if (pending === operation) pending = null
        })
      pending = operation
      return operation
    },
    reset(): void {
      epoch++
      cancellation.abort()
      cancellation = new AbortController()
      cached = null
      snapshot = null
      pending = null
    },
    dispose(): void {
      epoch++
      cancellation.abort()
      disposed = true
      cached = null
      snapshot = null
    },
  }
}
