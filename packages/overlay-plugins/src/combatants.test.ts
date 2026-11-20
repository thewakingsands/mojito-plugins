import type { CombatantState, Field, PluginContext, Value } from '@ffcafe/mojito-plugin-sdk'
import { pluginError } from '@ffcafe/mojito-plugin-sdk/errors'
import { expect, it, vi } from 'vitest'
import { registerCombatants } from './combatants.js'

const ok = <T>(value: T): Field<T> => ({
  state: 'ok',
  value,
  observedAt: 1,
  timeBase: 'host-monotonic-unix',
  from: 'memory',
})
const actor = (id = 16, name = 'Example Player'): CombatantState => ({
  id,
  name: ok(name),
  classJob: ok(21),
  level: ok(100),
  hpCur: ok(0),
  hpMax: ok(500),
  mpCur: ok(0),
  mpMax: ok(10000),
  position: ok({ x: 1, y: 2, z: 3 }),
  rotation: ok(Math.PI / 2),
  ownerId: ok(null),
  targetId: ok(17),
  homeWorldId: ok(42),
  currentWorldId: ok(43),
  bNpcBase: ok(0),
  bNpcName: ok(0),
  objectKind: ok(1),
})
async function fixture(entities = [actor()]) {
  let command!: (input: Value) => Promise<Value>
  const meta = { sessionId: 'synthetic', source: 'live', characterGeneration: 1, clockGeneration: 0 }
  const getCombatants = vi.fn(async () => ({ meta, value: { entities, missingIds: [] } }))
  const get = vi.fn(async () => ({
    sessionId: 'synthetic',
    state: 'live',
    characterGeneration: 1,
    clock: { generation: 0 },
  }))
  const rows = vi.fn(async () => [{ rowId: 42, subrows: [{ cells: [{ type: 'string', value: 'Example World' }] }] }])
  const capabilities = vi.fn(() => ({ 'data.read': { state: 'available' } }))
  const dispose = vi.fn()
  const ctx = {
    game: { getCombatants },
    session: { get },
    data: { rows },
    capabilities: { get: capabilities },
    views: {
      onCommand: async (channel: string, handler: typeof command) => {
        expect(channel).toBe('combat/combatants')
        command = handler
        return dispose
      },
    },
  } as unknown as PluginContext
  const stop = await registerCombatants(ctx, 'combat')
  return { command, stop, dispose, entities, meta, getCombatants, get, rows, capabilities }
}
it('maps every supported field, preserving zero and ngld coordinate order', async () => {
  const f = await fixture()
  expect(await f.command({})).toEqual({
    combatants: [
      {
        ID: 16,
        Name: 'Example Player',
        Job: 21,
        Level: 100,
        CurrentHP: 0,
        MaxHP: 500,
        CurrentMP: 0,
        MaxMP: 10000,
        PosX: 1,
        PosY: 3,
        PosZ: 2,
        Heading: Math.PI / 2,
        OwnerID: 0,
        TargetID: 17,
        WorldID: 42,
        CurrentWorldID: 43,
        WorldName: 'Example World',
        BNpcID: 0,
        BNpcNameID: 0,
        Type: 1,
      },
    ],
  })
  expect(f.rows).toHaveBeenCalledWith('World', [42], 'en', { columns: ['Name'] })
  expect(f.get).toHaveBeenCalledOnce()
  Object.assign(f.entities[0], { position: ok({ x: 0, y: 0, z: 0 }), rotation: ok(0) })
  expect(await f.command({ props: ['PosX', 'PosY', 'PosZ', 'Heading'] })).toEqual({
    combatants: [{ PosX: 0, PosY: 0, PosZ: 0, Heading: 0 }],
  })
  await f.stop()
  expect(f.dispose).toHaveBeenCalledOnce()
})
it('filters the union before projection and deduplicates IDs in source order', async () => {
  const f = await fixture([actor(1, 'Alice'), actor(2, '中文'), actor(3, 'Alice'), actor(1, 'Alice')])
  expect(await f.command({ ids: [2], names: ['ALICE'], props: ['ID'] })).toEqual({
    combatants: [{ ID: 1 }, { ID: 2 }, { ID: 3 }],
  })
  expect(f.getCombatants).toHaveBeenLastCalledWith({ fields: expect.any(Array) })
  expect(await f.command({ ids: [2], props: ['Name'] })).toEqual({ combatants: [{ Name: '中文' }] })
  expect(f.getCombatants).toHaveBeenLastCalledWith({ fields: expect.any(Array), ids: [2] })
  expect(await f.command({ names: ['中文'], props: ['unknown', 'id'] })).toEqual({ combatants: [{}] })
  expect(await f.command({ names: [' Alice'], props: ['ID'] })).toEqual({ combatants: [] })
  expect(await f.command({ ids: [], names: [], props: [] })).toEqual(await f.command({}))
})
it('omits unavailable fields and invalid values without inventing defaults', async () => {
  const f = await fixture([
    {
      id: 1,
      name: { state: 'unknown', reason: 'missing' },
      hpCur: ok(NaN),
      hpMax: { state: 'unavailable', reason: 'missing' },
      ownerId: { state: 'unknown', reason: 'missing' },
      targetId: ok(null),
      homeWorldId: ok(0xfffe),
      currentWorldId: ok(0xffff),
      position: ok({ x: 0, y: NaN, z: 0 }),
    },
  ])
  expect(await f.command({})).toEqual({ combatants: [{ ID: 1, TargetID: 0 }] })
  expect(f.rows).not.toHaveBeenCalled()
})
it('joins world rows by ID, reads each world once and only when requested', async () => {
  const f = await fixture([actor(1), { ...actor(2), homeWorldId: ok(43) }, actor(3)])
  f.rows.mockResolvedValue([
    { rowId: 43, subrows: [{ cells: [{ type: 'string', value: 'Visited' }] }] },
    { rowId: 42, subrows: [{ cells: [{ type: 'string', value: 'Home' }] }] },
  ])
  expect(await f.command({ props: ['WorldName'] })).toEqual({
    combatants: [{ WorldName: 'Home' }, { WorldName: 'Visited' }, { WorldName: 'Home' }],
  })
  expect(f.rows).toHaveBeenCalledWith('World', [42, 43], 'en', { columns: ['Name'] })
  f.rows.mockClear()
  await f.command({ props: ['ID'] })
  expect(f.rows).not.toHaveBeenCalled()
  f.rows.mockResolvedValue([{ rowId: 42, subrows: [{ cells: [{ type: 'string', value: '' }] }] }])
  expect(await f.command({ props: ['WorldName'] })).toEqual({ combatants: [{}, {}, {}] })
})
it('degrades only missing world data and rejects stale or failed queries', async () => {
  const f = await fixture()
  for (const code of ['not_found', 'unavailable'] as const) {
    f.rows.mockRejectedValueOnce(pluginError(code))
    expect(await f.command({ props: ['ID', 'WorldName'] })).toEqual({ combatants: [{ ID: 16 }] })
  }
  for (const code of ['stale_session', 'clock_reset', 'cancelled', 'plugin_stopped', 'internal'] as const) {
    f.rows.mockRejectedValueOnce(pluginError(code))
    expect(await f.command({})).toEqual({ error: 'unavailable' })
  }
  f.getCombatants.mockRejectedValueOnce(pluginError('not_found'))
  expect(await f.command({})).toEqual({ error: 'unavailable' })
})
it('uses the SDK identity consistently and does not require data permission', async () => {
  const f = await fixture([{ ...actor(100, 'Player 1'), ownerId: ok(101), targetId: ok(102) }])
  f.capabilities.mockReturnValue({} as ReturnType<typeof f.capabilities>)
  expect(await f.command({ names: ['Player 1'], props: ['ID', 'Name', 'OwnerID', 'TargetID', 'WorldName'] })).toEqual({
    combatants: [{ ID: 100, Name: 'Player 1', OwnerID: 101, TargetID: 102 }],
  })
  expect(f.rows).not.toHaveBeenCalled()
})
it.each([
  null,
  [],
  { extra: true },
  { ids: [-1] },
  { ids: [0x100000000] },
  { ids: [1.5] },
  { ids: ['1'] },
  { names: [1] },
  { props: 'ID' },
])('rejects invalid arguments before reading', async (input) => {
  const f = await fixture()
  expect(await f.command(input as Value)).toEqual({ error: 'invalid_argument' })
  expect(f.getCombatants).not.toHaveBeenCalled()
})

it('checks the source once after an in-flight query crosses a character change', async () => {
  const f = await fixture()
  f.getCombatants.mockImplementationOnce(async () => {
    await Promise.resolve()
    f.get.mockResolvedValue({ sessionId: 'synthetic', state: 'live', characterGeneration: 2, clock: { generation: 0 } })
    return { meta: f.meta, value: { entities: f.entities, missingIds: [] } }
  })
  expect(await f.command({})).toEqual({ error: 'unavailable' })
  expect(f.get).toHaveBeenCalledOnce()
  expect(f.rows).toHaveBeenCalledOnce()
  expect(f.get.mock.invocationCallOrder[0]).toBeGreaterThan(f.rows.mock.invocationCallOrder[0])
})
