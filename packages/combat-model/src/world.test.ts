import { describe, expect, it } from 'vitest'
import { invalidTarget } from './constants.js'
import { MemoryWorld } from './world.js'

const PLAYER = 0x10000001
const OTHER = 0x10000002
const ENEMY = 0x40000001

describe('MemoryWorld', () => {
  it('keeps the profile of an actor from its last actor input', () => {
    const world = new MemoryWorld()
    expect(world.get(PLAYER)).toEqual({})
    world.handle({ type: 'actor', time: 0, actorId: PLAYER, classJob: 34, level: 90, ownerId: null })
    world.handle({ type: 'actor', time: 1, actorId: PLAYER, classJob: 34, level: 100, ownerId: null })
    expect(world.get(PLAYER)).toEqual({ classJob: 34, level: 100, ownerId: 0 })
    expect(world.get(0)).toEqual({})
    expect(world.get(invalidTarget)).toEqual({})
  })

  it('changes only the slots a statuses input names, and keeps their order', () => {
    const world = new MemoryWorld()
    world.handle({
      type: 'statuses',
      time: 0,
      holder: ENEMY,
      slots: [
        { slot: 2, status: { id: 1881, source: PLAYER, stacks: 0 } },
        { slot: 0, status: { id: 714, source: null, stacks: 3 } },
      ],
      changes: [],
    })
    expect(world.getBuffs(ENEMY)).toEqual([
      { id: 714, source: invalidTarget, stacks: 3 },
      { id: 1881, source: PLAYER, stacks: 0 },
    ])
    world.handle({ type: 'statuses', time: 1, holder: ENEMY, slots: [{ slot: 0, status: null }], changes: [] })
    expect(world.getBuffs(ENEMY)).toEqual([{ id: 1881, source: PLAYER, stacks: 0 }])
    world.handle({ type: 'statuses', time: 1, holder: null, slots: [{ slot: 0, status: null }], changes: [] })
    expect(world.getBuffs(invalidTarget)).toEqual([])
  })

  it('forgets every actor but the receiver of a zone change, who keeps the statuses', () => {
    const world = new MemoryWorld()
    for (const id of [PLAYER, OTHER])
      world.handle({ type: 'actor', time: 0, actorId: id, classJob: 34, level: 100, ownerId: null })
    for (const holder of [PLAYER, OTHER])
      world.handle({
        type: 'statuses',
        time: 0,
        holder,
        slots: [{ slot: 0, status: { id: 1298, source: holder, stacks: 0 } }],
        changes: [],
      })
    world.handle({ type: 'zone', time: 1, territory: 1, receiver: PLAYER })
    expect(world.get(PLAYER)).toEqual({ classJob: 34, level: 100, ownerId: 0 })
    expect(world.getBuffs(PLAYER)).toEqual([{ id: 1298, source: PLAYER, stacks: 0 }])
    expect(world.get(OTHER)).toEqual({})
    expect(world.getBuffs(OTHER)).toEqual([])
  })
})
