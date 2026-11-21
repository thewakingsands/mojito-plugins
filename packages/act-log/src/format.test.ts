import { createHash } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { LogFormat } from './format.js'

afterEach(() => vi.unstubAllEnvs())

it('uses the source instant, its local offset and a fresh sequence for each zone', () => {
  vi.stubEnv('TZ', 'Asia/Kolkata')
  const format = new LogFormat()
  for (const [type, count, value] of [
    [0, 1, '合成'],
    [0, 2, 'two'],
    [1, 1, 'zone'],
    [11, 2, 'party'],
  ] as const) {
    const line = `${String(type).padStart(2, '0')}|2000-01-01T05:30:00.1230000+05:30|${value}`
    const hash = createHash('sha256').update(`${line}|${count}`).digest('hex').slice(0, 16)
    expect(
      Buffer.from(format.encode({ type, timestamp: Date.UTC(2000, 0, 1, 0, 0, 0, 123), fields: [value] })),
    ).toEqual(Buffer.from(`${line}|${hash}\r\n`, 'utf8'))
  }
})

it('rejects an unhandled separator without consuming a line number', () => {
  const format = new LogFormat()
  expect(() => format.encode({ type: 0, timestamp: 1, fields: ['a|b'] })).toThrow('separator')
  const row = { type: 0, timestamp: 1, fields: ['one'] }
  expect(format.encode(row)).toEqual(new LogFormat().encode(row))
})
