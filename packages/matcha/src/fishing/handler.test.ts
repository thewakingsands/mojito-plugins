import { describe, expect, it } from 'vitest'
import { attributes, packet } from './fixtures.test-helper.js'
import { FishingHandler } from './handler.js'
import type { FishingFrame } from './types.js'
import { createUpload, encodeUpload } from './upload.js'

describe('fishing protocol state machine', () => {
  it('waits for server transitions, freezes cast state and captures lure and catch metadata', () => {
    let time = 100000
    const events: unknown[] = [],
      frames: FishingFrame[] = []
    const handler = new FishingHandler({
      now: () => time,
      id: () => String(time),
      emit: (type, content) => events.push({ type, content }),
      observe: (value) => frames.push(value),
      attributes: () => attributes(time),
      actorId: () => 1,
    })
    const action = (command: number) =>
      handler.handle(
        packet(
          'ClientTrigger',
          12,
          time,
          [
            [0, 0x2bd, 4],
            [4, command, 4],
          ],
          'send',
        ),
      )
    const play = (kind: number, animation = 0) =>
      handler.handle(
        packet('EventPlay', 40, time, [
          [0, 1, 4],
          [8, 0x00150001, 4],
          [12, kind, 2],
          [28, animation, 2],
        ]),
      )
    const log = (message: number, parameter: number) =>
      handler.handle(
        packet('SystemLogMessage', 24, time, [
          [0, 0x00150001, 4],
          [4, message, 4],
          [12, parameter, 4],
        ]),
      )
    handler.handle(packet('PlayerSetup', 0x30, time, [[0x2c, 10, 4]]))
    handler.handle(packet('StatusEffectList', 380, time, [[20, 763, 2]]))
    action(0)
    expect(frames.filter((value) => value.action === 'cast')).toHaveLength(0)
    play(1)
    play(1)
    expect(frames.filter((value) => value.action === 'cast')).toHaveLength(1)
    const first = frames.at(-1)!
    expect(first).toMatchObject({ chum: true, baitId: 10, placeId: null })
    log(1110, 20)
    time += 1000
    handler.handle(
      packet('ActorControl', 24, time, [
        [0, 20, 2],
        [4, 3972, 4],
        [8, 1, 4],
      ]),
    )
    log(5564, 30)
    time += 4000
    play(5, 292)
    action(2)
    play(6)
    handler.handle(
      packet('FishCaught', 16, time, [
        [0, 30, 4],
        [4, 42, 2],
        [6, 1, 2],
        [12, 16, 4],
      ]),
    )
    const catchFrame = frames.at(-1)!
    expect(catchFrame).toMatchObject({
      action: 'catch',
      tug: 1,
      fishId: 30,
      capture: { terminal: true, size: 42, large: true, quantity: 1, lure: 1, hiddenStack: 1 },
    })
    expect(catchFrame.capture?.lureTimes).toEqual([101000])
    expect(first.capture?.lureTimes).toEqual([])
    expect(createUpload(catchFrame, attributes(time))).not.toBeNull()
    expect(JSON.stringify(events)).not.toContain('capture')
    const before = frames.length
    handler.handle(packet('FishCaught', 16, time, [[0, 30, 4]]))
    expect(frames).toHaveLength(before)
    time += 1000
    action(3)
    play(1)
    expect(frames.at(-1)).toMatchObject({ baitId: null, placeId: null })
    log(1121, 30)
    expect(frames.at(-1)).toMatchObject({ baitId: 30, placeId: 20, mooch: true })
    log(3527, 0)
    expect(frames.at(-1)?.capture).toMatchObject({ terminal: true, gatheringFailed: true })
  })
  it('does not infer absent baseline or accept another actor and clears session data', () => {
    const frames: FishingFrame[] = []
    const handler = new FishingHandler({ emit() {}, observe: (frame) => frames.push(frame), actorId: () => 1 })
    const play = packet('EventPlay', 40, 100, [
      [0, 1, 4],
      [8, 0x00150001, 4],
      [12, 1, 2],
    ])
    handler.handle({ ...packet('StatusEffectList', 380, 50), sourceActor: 2, targetActor: 2 })
    handler.handle(play)
    expect(frames.at(-1)).toMatchObject({ chum: null, capture: { unsupported: true } })
    handler.reset(200)
    expect(frames.at(-1)).toMatchObject({ action: 'reset', baitId: null, placeId: null, castId: null })
    expect(handler.handle({ ...play, data: new Uint8Array(39) })).toBe(false)
  })
  it('encodes an independent CBOR vector with each integer width', () => {
    const bytes = encodeUpload([[0, 23, 24, 256, 65536, 4294967296, true, false, null, [1, 2]]])
    expect([...bytes].map((value) => value.toString(16).padStart(2, '0')).join('')).toBe(
      '818a001718181901001a000100001b0000000100000000f5f4f6820102',
    )
    expect(() => encodeUpload([-1])).toThrow()
  })
})
