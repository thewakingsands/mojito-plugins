import { describe, expect, it } from 'vitest'
import { parseStatusEntries } from './status-entries.js'

describe('parseStatusEntries', () => {
  it('reads the statuses the entries of types 14 and 15 apply, with their bytes', () => {
    expect(
      parseStatusEntries([
        // Damage, not a status
        [3 | (0x40 << 8), 1234],
        // Combust III on the target, bytes 174 and 58
        [14 | (174 << 8) | (58 << 16), 1881 << 16],
        // Divination on the caster, byte 6
        [15 | (6 << 8), 1878 << 16],
        [0, 0],
      ]),
    ).toEqual([
      { status: 1881, onSource: false, byte1: 174, byte2: 58 },
      { status: 1878, onSource: true, byte1: 6, byte2: 0 },
    ])
  })

  it('reads the highest status ids and bytes without a sign', () => {
    expect(parseStatusEntries([[(14 | (0xff << 8) | (0xff << 16) | (0xff << 24)) >>> 0, 0xffff0000]])).toEqual([
      { status: 0xffff, onSource: false, byte1: 0xff, byte2: 0xff },
    ])
  })
})
