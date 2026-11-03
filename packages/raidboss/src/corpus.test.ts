/// <reference types="vite/client" />
import { writeFile } from 'node:fs/promises'
import { expect, it } from 'vitest'
import PartyTracker from '../vendor/cactbot/resources/party'
import { options, RaidbossEngine } from './engine'
import { raidbossData } from './game'

const modules = import.meta.glob('../vendor/cactbot/ui/raidboss/data/**/*.ts', { eager: true, import: 'default' })
const raw = import.meta.glob('../vendor/cactbot/ui/raidboss/data/**/*.txt', {
  eager: true,
  query: '?raw',
  import: 'default',
})
// Parses and starts every upstream collection: about 6-9 s alone, slower in a full test run.
it('loads every fixed official collection and records rule and timeline diagnostics', { timeout: 60_000 }, async () => {
  const timelines = Object.fromEntries(
    Object.entries(raw).map(([path, text]) => [path.split('/').at(-1)!, text as string]),
  )
  const rows = []
  for (const [path, input] of Object.entries(modules)) {
    if (path.endsWith('/test.ts') || path.includes('/test/')) continue
    const set = input as any
    const opts = options('cn'),
      party = new PartyTracker(opts)
    const data = raidbossData('Tester', 19, party, opts, () => {})
    const clock: any = {
      now: () => 10000,
      setTimeout: () => () => {},
      state: () => ({ now: 10000, generation: 1, base: 'packet-unix', source: 'replay', paused: false }),
    }
    const engine = new RaidbossEngine([{ path, set }], timelines, clock, { changed() {}, say() {}, play() {} })
    let fault: string | undefined
    try {
      engine.start(Array.isArray(set.zoneId) ? set.zoneId[0] : (set.zoneId ?? 0), data, {
        language: 'cn',
        audio: 'none',
        rules: {},
      })
    } catch (error) {
      fault = String(error)
    }
    rows.push({ path, fault, diagnostics: structuredClone(engine.diagnostics) })
    engine.reset()
  }
  if (process.env.MOJITO_RAIDBOSS_AUDIT)
    await writeFile(process.env.MOJITO_RAIDBOSS_AUDIT, JSON.stringify(rows, null, 2))
  expect(rows.length).toBeGreaterThan(400)
  expect(rows.filter((row) => row.fault)).toEqual([])
})
