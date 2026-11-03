import { decode, encode } from '@msgpack/msgpack'
import type { Value } from './types.js'

export const protocolVersion = 1 as const
export const maxMessageBytes = 4 * 1024 * 1024
export const maxValueDepth = 32
export const maxCollectionItems = 65536
const keyText = new TextDecoder('utf-8', { ignoreBOM: true })

export class ProtocolError extends Error {
  readonly code = 'invalid_argument'
  constructor(message: string) {
    super(message)
    this.name = 'ProtocolError'
  }
}

function ensure(condition: unknown, message: string): asserts condition {
  if (!condition) throw new ProtocolError(message)
}

/**
 * Check that a value has the shape MessagePack can carry: plain data within the
 * depth and collection limits. Strings are not inspected, and the encoded size is
 * only known after encoding.
 */
export function validateValue(input: unknown): asserts input is Value {
  const visiting = new Set<object>()
  const walk = (value: unknown, depth: number) => {
    ensure(depth <= maxValueDepth, 'Value exceeds depth limit')
    if (value === null || typeof value === 'boolean' || typeof value === 'string') return
    if (typeof value === 'number') {
      ensure(Number.isFinite(value), 'Non-finite number')
      return
    }
    if (typeof value === 'bigint') {
      ensure(value >= -(1n << 63n) && value < 1n << 64n, 'Bigint outside protocol range')
      return
    }
    ensure(typeof value === 'object' && value !== null, 'Unsupported value')
    if (value instanceof Uint8Array) return
    ensure(!visiting.has(value), 'Cyclic value')
    visiting.add(value)
    if (Array.isArray(value)) {
      ensure(value.length <= maxCollectionItems, 'Array exceeds item limit')
      ensure(Object.keys(value).length === value.length, 'Sparse or decorated array')
      ensure(Reflect.ownKeys(value).length === value.length + 1, 'Hidden or symbol array property')
      for (let index = 0; index < value.length; index++) {
        const property = Object.getOwnPropertyDescriptor(value, String(index))
        ensure(property && 'value' in property, 'Accessor or missing array item')
        walk(property.value, depth + 1)
      }
    } else {
      const prototype = Object.getPrototypeOf(value)
      ensure(prototype === Object.prototype || prototype === null, 'Expected a plain object')
      const keys = Reflect.ownKeys(value)
      ensure(keys.length <= maxCollectionItems, 'Object exceeds item limit')
      for (const key of keys) {
        ensure(typeof key === 'string', 'Symbol object key')
        const property = Object.getOwnPropertyDescriptor(value, key)!
        ensure('value' in property && property.enumerable, 'Accessor or hidden property')
        walk(property.value, depth + 1)
      }
    }
    visiting.delete(value)
  }
  walk(input, 0)
}

/**
 * Allocation preflight only; @msgpack/msgpack still performs all value decoding.
 * The library limits collection lengths but has no decode-depth option. Inspect
 * headers first so a truncated/nested input cannot allocate collections first.
 */
function preflight(bytes: Uint8Array) {
  ensure(bytes.length > 0 && bytes.length <= maxMessageBytes, 'Invalid message length')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let offset = 0
  const take = (length: number) => {
    ensure(length <= bytes.length - offset, 'Truncated MessagePack')
    const start = offset
    offset += length
    return start
  }
  const length = (width: 1 | 2 | 4) => {
    const at = take(width)
    return width === 1 ? view.getUint8(at) : width === 2 ? view.getUint16(at) : view.getUint32(at)
  }
  const scan = (depth: number, key = false): void => {
    ensure(depth <= maxValueDepth, 'Message exceeds depth limit')
    const marker = view.getUint8(take(1))
    let count = 0
    let map = false
    let stringLength: number | undefined
    if ((marker & 0xe0) === 0xa0) stringLength = marker & 0x1f
    else if (marker === 0xd9 || marker === 0xda || marker === 0xdb)
      stringLength = length(marker === 0xd9 ? 1 : marker === 0xda ? 2 : 4)
    if (stringLength !== undefined) {
      take(stringLength)
      return
    }
    ensure(!key, 'Map keys must be strings')
    if (marker <= 0x7f || marker >= 0xe0 || marker === 0xc0 || marker === 0xc2 || marker === 0xc3) return
    if ((marker & 0xf0) === 0x90) count = marker & 0x0f
    else if ((marker & 0xf0) === 0x80) {
      count = marker & 0x0f
      map = true
    } else if (marker === 0xdc || marker === 0xdd) count = length(marker === 0xdc ? 2 : 4)
    else if (marker === 0xde || marker === 0xdf) {
      count = length(marker === 0xde ? 2 : 4)
      map = true
    } else if (marker === 0xc4 || marker === 0xc5 || marker === 0xc6) {
      take(length(marker === 0xc4 ? 1 : marker === 0xc5 ? 2 : 4))
      return
    } else {
      const widths: Record<number, number> = {
        202: 4,
        203: 8,
        204: 1,
        205: 2,
        206: 4,
        207: 8,
        208: 1,
        209: 2,
        210: 4,
        211: 8,
      }
      const width = widths[marker]
      ensure(width !== undefined, 'Unsupported MessagePack marker or extension')
      take(width)
      return
    }
    ensure(count <= maxCollectionItems, 'Collection exceeds item limit')
    ensure(count * (map ? 2 : 1) <= bytes.length - offset, 'Truncated collection')
    for (let i = 0; i < count; i++) {
      if (map) scan(depth + 1, true)
      scan(depth + 1)
    }
  }
  scan(0)
  ensure(offset === bytes.length, 'Trailing MessagePack data')
}

export function encodeValue(value: unknown): Uint8Array {
  validateValue(value)
  const bytes = encode(value, { useBigInt64: true, maxDepth: maxValueDepth + 1, sortKeys: true })
  ensure(bytes.length <= maxMessageBytes, 'Message exceeds byte limit')
  return bytes
}

export function decodeValue(bytes: Uint8Array): Value {
  preflight(bytes)
  const decoded = decode(bytes, {
    useBigInt64: true,
    maxArrayLength: maxCollectionItems,
    maxMapLength: maxCollectionItems,
    maxStrLength: maxMessageBytes,
    maxBinLength: maxMessageBytes,
    maxExtLength: 0,
    // Escape only the decoder's in-memory keys, never the wire. This keeps every
    // string key (including __proto__) without invoking a prototype setter.
    keyDecoder: {
      canBeCached: () => true,
      decode: (data, offset, size) => `$${keyText.decode(data.subarray(offset, offset + size))}`,
    },
    mapKeyConverter(key) {
      ensure(typeof key === 'string', 'Map keys must be strings')
      return key
    },
  })
  const restore = (value: unknown): unknown => {
    if (value instanceof Uint8Array) return new Uint8Array(value)
    if (Array.isArray(value)) return value.map(restore)
    if (value !== null && typeof value === 'object') {
      const result: Record<string, unknown> = Object.create(null)
      for (const [key, item] of Object.entries(value)) result[key.slice(1)] = restore(item)
      return result
    }
    return value
  }
  const result = restore(decoded)
  validateValue(result)
  return result
}

export function encodeFrame(value: unknown): Uint8Array {
  const payload = encodeValue(value)
  const frame = new Uint8Array(4 + payload.length)
  new DataView(frame.buffer).setUint32(0, payload.length, true)
  frame.set(payload, 4)
  return frame
}

/** Incremental pipe framing. A protocol error permanently closes this decoder. */
export class FrameDecoder {
  private header = new Uint8Array(4)
  private headerUsed = 0
  private payload: Uint8Array | undefined
  private payloadUsed = 0
  private failed = false

  push(chunk: Uint8Array): Value[] {
    ensure(!this.failed, 'Decoder is closed')
    const result: Value[] = []
    let offset = 0
    try {
      while (offset < chunk.length) {
        if (!this.payload) {
          const size = Math.min(4 - this.headerUsed, chunk.length - offset)
          this.header.set(chunk.subarray(offset, offset + size), this.headerUsed)
          this.headerUsed += size
          offset += size
          if (this.headerUsed < 4) continue
          const length = new DataView(this.header.buffer).getUint32(0, true)
          ensure(length > 0 && length <= maxMessageBytes, 'Invalid frame length')
          this.payload = new Uint8Array(length)
        }
        const size = Math.min(this.payload.length - this.payloadUsed, chunk.length - offset)
        this.payload.set(chunk.subarray(offset, offset + size), this.payloadUsed)
        this.payloadUsed += size
        offset += size
        if (this.payloadUsed === this.payload.length) {
          result.push(decodeValue(this.payload))
          this.headerUsed = 0
          this.payloadUsed = 0
          this.payload = undefined
        }
      }
      return result
    } catch (error) {
      this.failed = true
      this.payload = undefined
      throw error
    }
  }

  end(): void {
    this.failed = true
    ensure(this.headerUsed === 0 && !this.payload, 'Truncated frame at EOF')
  }
}
