import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { decodeValue, encodeFrame, encodeValue, FrameDecoder, maxMessageBytes } from './protocol.js'
import type { Value } from './types.js'

const fixtures = JSON.parse(
  readFileSync(new URL('../../../crates/plugin-protocol/fixtures/values.json', import.meta.url), 'utf8'),
) as Vector[]
interface Vector {
  name?: string
  hex?: string
  type: string
  value: any
}
function expected(vector: Vector): Value {
  switch (vector.type) {
    case 'bigint':
      return BigInt(vector.value)
    case 'binary':
      return Uint8Array.from(vector.value)
    case 'array':
      return vector.value.map(expected)
    case 'map':
      return Object.fromEntries(Object.entries(vector.value).map(([k, v]) => [k, expected(v as Vector)]))
    default:
      return vector.value
  }
}

describe('shared TS/Rust fixed vectors', () => {
  it.each(fixtures)('$name preserves its type and exact bytes', (fixture) => {
    const value = expected(fixture)
    const bytes = Uint8Array.from(Buffer.from(fixture.hex!, 'hex'))
    expect(encodeValue(value)).toEqual(bytes)
    expect(decodeValue(bytes)).toEqual(value)
  })
})
it('keeps every string map key without prototype mutation and copies binary payloads', () => {
  const object = Object.create(null)
  for (const key of ['__proto__', 'constructor', '$data', '\ufeffkey', '']) object[key] = Uint8Array.of(7)
  const bytes = encodeValue(object)
  const result = decodeValue(bytes)
  bytes.fill(0)
  expect(result).toEqual(object)
  expect(Object.getPrototypeOf(result)).toBeNull()
})
it.each([undefined, Number.NaN, Infinity, new Date(), new Map(), () => {}, 1n << 64n, -(1n << 63n) - 1n])(
  'rejects unsupported input %s',
  (value) => {
    expect(() => encodeValue(value)).toThrow()
  },
)
it('carries unpaired surrogates in values and replaces them in keys', () => {
  expect(decodeValue(encodeValue('a\ud800b'))).toBe('a\ud800b')
  expect(decodeValue(encodeValue({ 'a\udc00': 1 }))).toEqual({ 'a���': 1 })
})
it('rejects cycles, sparse arrays and getters without invoking them', () => {
  const cycle: any = {}
  cycle.self = cycle
  expect(() => encodeValue(cycle)).toThrow('Cyclic')
  expect(() => encodeValue(Array(3))).toThrow('Sparse')
  let invoked = false
  const accessor = {
    get item() {
      invoked = true
      return 1
    },
  }
  expect(() => encodeValue(accessor)).toThrow('Accessor')
  expect(invoked).toBe(false)
})
it.each(['c7ffffff', 'd4ff00', '810100', 'ddffffffff', 'dbffffffff', 'c600400000', 'c1', '01c0', 'cb7ff0000000000000'])(
  'rejects malformed frame %s before allocation',
  (hex) => {
    expect(() => decodeValue(Buffer.from(hex, 'hex'))).toThrow()
  },
)
it('bounds depth, collections and encoded size on both paths', () => {
  const valid = Uint8Array.from([...Array(32).fill(0x91), 0xc0])
  expect(() => decodeValue(valid)).not.toThrow()
  expect(() => decodeValue(Uint8Array.from([0x91, ...valid]))).toThrow('depth')
  let nested: Value = null
  for (let i = 0; i < 33; i++) nested = [nested]
  expect(() => encodeValue(nested)).toThrow('depth')
  expect(() => encodeValue(Array(65537).fill(null))).toThrow('item')
  expect(() => encodeValue(new Uint8Array(maxMessageBytes))).toThrow('byte')
  expect(() => encodeValue(Array(5).fill('x'.repeat(maxMessageBytes / 4)))).toThrow('byte')
})
it('handles every pipe split and multiple consecutive frames', () => {
  const a = encodeFrame({ id: 1n, data: Uint8Array.of(0, 255) })
  const b = encodeFrame(false)
  const bytes = Uint8Array.from([...a, ...b])
  for (let split = 0; split <= bytes.length; split++) {
    const decoder = new FrameDecoder()
    expect([...decoder.push(bytes.slice(0, split)), ...decoder.push(bytes.slice(split))]).toEqual([
      { id: 1n, data: Uint8Array.of(0, 255) },
      false,
    ])
    decoder.end()
  }
})
it('fails permanently on invalid lengths and truncated EOF', () => {
  for (const size of [0, maxMessageBytes + 1]) {
    const decoder = new FrameDecoder()
    const header = new Uint8Array(4)
    new DataView(header.buffer).setUint32(0, size, true)
    expect(() => decoder.push(header)).toThrow('length')
    expect(() => decoder.push(encodeFrame(null))).toThrow('closed')
  }
  const decoder = new FrameDecoder()
  decoder.push(Uint8Array.of(1, 0))
  expect(() => decoder.end()).toThrow('Truncated')
})
it('copies binary data even when the native pipe supplies a Node Buffer', () => {
  const source = Buffer.from('c40200ff', 'hex')
  const decoded = decodeValue(source)
  source.fill(0)
  expect(decoded).toEqual(Uint8Array.of(0, 255))
  expect(Object.getPrototypeOf(decoded)).toBe(Uint8Array.prototype)
})
