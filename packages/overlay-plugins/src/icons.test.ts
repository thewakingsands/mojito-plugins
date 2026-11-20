import type { PluginContext, Value } from '@ffcafe/mojito-plugin-sdk'
import { expect, it, vi } from 'vitest'
import { registerGameIcons } from './icons.js'

async function fixture(kinds: 'all' | 'job' = 'all') {
  let command!: (input: Value) => Promise<Value>
  const rows = vi.fn(async () => [
    { rowId: 3, subrows: [{ subrowId: null, cells: [{}, {}, { type: 'number', value: 104 }] }] },
  ])
  const image = vi.fn(
    async (path: string): Promise<string | null> => `mojito-plugin://runtime/client/test/1/image/${path}`,
  )
  const dispose = vi.fn()
  const ctx = {
    session: { get: async () => ({ dataLanguage: 'cn' }) },
    data: { rows, image },
    views: {
      onCommand: async (_channel: string, handler: typeof command) => {
        command = handler
        return dispose
      },
    },
  } as unknown as PluginContext
  const stop = await registerGameIcons(ctx, kinds)
  return { rows, image, dispose, stop, command: (input: Value) => command(input) }
}

it.each(['action', 'status'])(
  'resolves a %s row to the game icon, preferring high resolution with a standard fallback',
  async (type) => {
    const f = await fixture()
    expect(await f.command({ type, id: 3 })).toContain('/000000/000104_hr1.tex')
    expect(f.rows).toHaveBeenCalledWith(type === 'action' ? 'Action' : 'Status', [3], 'cn')
    f.image.mockResolvedValueOnce(null)
    expect(await f.command({ type, id: 3 })).toContain('/000000/000104.tex')
    f.rows.mockResolvedValueOnce([])
    expect(await f.command({ type, id: 9999 })).toBeNull()
    await f.stop()
    expect(f.dispose).toHaveBeenCalledOnce()
  },
)

it('rejects invalid icon selections before reading game data', async () => {
  const f = await fixture()
  const invalid: Value[] = [
    { type: 'image', id: 1 },
    { type: 'action', id: -1 },
    { type: 'job', id: 0 },
    { type: 'job', id: 400 },
    { type: 'status', id: '1' },
    { type: 'status', id: 1, path: 'arbitrary' },
  ]
  for (const value of invalid) expect(await f.command(value)).toEqual({ error: 'invalid_argument' })
  expect(f.image).not.toHaveBeenCalled()
  expect(f.rows).not.toHaveBeenCalled()
})

it.each([1, 19, 42, 43])('reads the game job icon for ClassJob %i without looking up a sheet', async (id) => {
  const f = await fixture()
  f.image.mockResolvedValueOnce(null)
  expect(await f.command({ type: 'job', id })).toContain(`/062000/0${62100 + id}.tex`)
  expect(f.image.mock.calls[0][0]).toBe(`ui/icon/062000/0${62100 + id}_hr1.tex`)
  expect(f.rows).not.toHaveBeenCalled()
  f.image.mockResolvedValue(null)
  expect(await f.command({ type: 'job', id })).toBeNull()
})

it('limits job-only overlays to ClassJob icons', async () => {
  const f = await fixture('job')
  for (const type of ['action', 'status'])
    expect(await f.command({ type, id: 3 })).toEqual({ error: 'invalid_argument' })
  expect(f.image).not.toHaveBeenCalled()
  expect(f.rows).not.toHaveBeenCalled()
  expect(await f.command({ type: 'job', id: 19 })).toContain('/062000/062119_hr1.tex')
})
