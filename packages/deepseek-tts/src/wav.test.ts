import { expect, it } from 'vitest'
import { wav } from './wav.js'

const text = (bytes: Uint8Array, offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4))

it('writes a PCM RIFF header', () => {
  const out = wav([new Uint8Array([1, 2]), new Uint8Array([3, 4, 5, 6])])
  const view = new DataView(out.buffer)
  expect(text(out, 0)).toBe('RIFF')
  expect(view.getUint32(4, true)).toBe(42)
  expect(text(out, 8)).toBe('WAVE')
  expect(text(out, 12)).toBe('fmt ')
  expect(view.getUint32(16, true)).toBe(16)
  expect(view.getUint16(20, true)).toBe(1)
  expect(view.getUint16(22, true)).toBe(1)
  expect(view.getUint32(24, true)).toBe(24000)
  expect(view.getUint32(28, true)).toBe(48000)
  expect(view.getUint16(32, true)).toBe(2)
  expect(view.getUint16(34, true)).toBe(16)
  expect(text(out, 36)).toBe('data')
  expect(view.getUint32(40, true)).toBe(6)
  expect([...out.subarray(44)]).toEqual([1, 2, 3, 4, 5, 6])
})
it('writes an empty data chunk for no parts', () => {
  const out = wav([])
  expect(out.length).toBe(44)
  expect(new DataView(out.buffer).getUint32(40, true)).toBe(0)
})
