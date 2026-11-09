import type { MatchaPacket } from '../protocol.js'
import type { FishingAttributes, FishingFrame } from './types.js'
export function packet(
  type: string,
  size: number,
  timestamp: number,
  fields: [number, number, 2 | 4][] = [],
  direction: 'recv' | 'send' = 'recv',
): MatchaPacket {
  const data = new Uint8Array(size),
    view = new DataView(data.buffer)
  for (const [offset, value, width] of fields)
    width === 2 ? view.setUint16(offset, value, true) : view.setUint32(offset, value, true)
  return {
    type,
    data,
    direction,
    timestamp,
    seq: 0,
    channel: 'zone',
    opcode: 1,
    sourceActor: 1,
    targetActor: 1,
    serverId: 1,
    ipcTimestamp: 1,
  }
}
export const attributes = (sampledAt: number): FishingAttributes => ({
  sampledAt,
  gathering: 200,
  perception: 300,
  currentGp: 0,
  maxGp: 600,
  baitId: 10,
})
export function cast(id: string, time: number, placeId: number | null = 20): FishingFrame {
  return {
    action: 'cast',
    time,
    castId: id,
    castTime: time,
    biteTime: null,
    hookTime: null,
    baitId: 10,
    baseBaitId: 10,
    placeId,
    tug: null,
    fishId: null,
    mooch: false,
    chum: false,
    snagging: false,
    statuses: [],
    capture: {
      serverCastTime: time,
      hook: 1,
      size: null,
      quantity: null,
      large: null,
      gatheringFailed: false,
      unsupported: false,
      terminal: false,
      patiencePrecision: null,
      patienceSuccess: null,
      slap: 0,
      identical: 0,
      hidden: 0,
      hiddenStack: 0,
      lure: 0,
      lureTarget: false,
      lureTimes: [],
    },
  }
}
export function caught(frame: FishingFrame): FishingFrame {
  return {
    ...structuredClone(frame),
    action: 'catch',
    fishId: 30,
    biteTime: frame.castTime! + 5000,
    tug: 1,
    capture: { ...structuredClone(frame.capture!), terminal: true, size: 42, quantity: 1, large: false },
  }
}
export async function flush() {
  for (let i = 0; i < 6; i++) await Promise.resolve()
}
export function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}
