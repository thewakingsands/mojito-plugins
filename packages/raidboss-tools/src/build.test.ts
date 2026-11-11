import { execFileSync } from 'node:child_process'
import { generateKeyPairSync } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, expect, it } from 'vitest'
import { buildCommunity } from './build.js'

const directories: string[] = []
const cli = fileURLToPath(
  new URL(`../../../target/release/mojito-package${process.platform === 'win32' ? '.exe' : ''}`, import.meta.url),
)
async function readPackage(bytes: Uint8Array) {
  const directory = await mkdtemp(join(tmpdir(), 'raidboss-package-check-'))
  directories.push(directory)
  const file = join(directory, 'plugin.mojito')
  await writeFile(file, bytes)
  const inspection = JSON.parse(execFileSync(cli, ['inspect', file], { encoding: 'utf8' }))
  const files = new Map(
    ['entry.mjs', 'collection.json', 'manage.html', 'overlay.html', 'LICENSE-cactbot'].map((name) => [
      name,
      execFileSync(cli, ['read', file, name]),
    ]),
  )
  return { ...inspection, manifest: inspection.metadata.manifest, files }
}
afterEach(async () => {
  for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true })
})
const input = async (source: string) => {
  const root = await mkdtemp(join(tmpdir(), 'raidboss-tools-'))
  directories.push(root)
  const entry = join(root, 'rule.ts')
  await writeFile(entry, source)
  return {
    root,
    entry,
    options: {
      privateJwk: JSON.stringify(generateKeyPairSync('ed25519').privateKey.export({ format: 'jwk' })),
      id: 'CommunitySynthetic',
      name: 'Synthetic collection',
      version: '1.0.0',
      entries: [entry],
    },
  }
}
it('compiles default and Options registrations without executing input or npm scripts in Node', async () => {
  const f = await input(`
    import Outputs from '@cactbot/resources/outputs';
    globalThis.__raidbossBuildExecuted = true;
    let calls = 0;
    Options.Triggers.push({ id: 'registered', zoneId: 1, triggers: [{ id: 'call', type: 'HeadMarker', netRegex: { id: '003E' }, infoText: () => String(++calls) }] });
    export default { id: 'default', zoneId: 1, timelineFile: 'timeline.txt', triggers: [{ id: 'text', type: 'HeadMarker', netRegex: { id: '003F' }, outputStrings: { text: Outputs.unknown }, infoText: (_data, _matches, output) => output.text() }] };
  `)
  await writeFile(join(f.root, 'package.json'), JSON.stringify({ scripts: { prebuild: 'not-a-real-command' } }))
  await writeFile(join(f.root, 'tsconfig.json'), '{ deliberately invalid local config }')
  const timeline = join(f.root, 'timeline.txt')
  await writeFile(timeline, '0 "Synthetic"')
  const pkg = await readPackage(await buildCommunity({ ...f.options, timelines: [timeline] }))
  expect((globalThis as Record<string, unknown>).__raidbossBuildExecuted).toBeUndefined()
  expect(pkg.metadata.formatVersion).toBe(1)
  expect(pkg.signer.fingerprint).toMatch(/^[a-f0-9]{64}$/)
  expect(pkg.manifest.id).toBe('CommunitySynthetic')
  expect(pkg.manifest.capabilities).not.toContain('http.request')
  expect(pkg.files.has('manage.html')).toBe(true)
  expect(pkg.files.has('overlay.html')).toBe(true)
  expect(pkg.files.has('LICENSE-cactbot')).toBe(true)
  const collection = JSON.parse(pkg.files.get('collection.json')!.toString())
  expect(collection.entries).toEqual(['rule.ts'])
  expect(collection.timelines).toEqual(['timeline.txt'])
  expect(pkg.files.get('entry.mjs')!.toString()).toContain('Runtime trigger registration is unsupported')
})
it.each(['node:fs', 'fs', 'https://example.invalid/rule.js', 'uninstalled-package'])(
  'rejects dependency %s that cannot be bundled for the Worker, without evaluating it',
  async (dependency) => {
    const f = await input(`import value from ${JSON.stringify(dependency)}; export default value;`)
    await expect(buildCommunity(f.options)).rejects.toThrow(/Unsupported dependency|Could not resolve/)
  },
)
it('allows local helper modules and rejects a community package using the official identity', async () => {
  const f = await input(
    "import { text } from './helper.ts'; export default { id: 'local', zoneId: 1, triggers: [], timeline: text };",
  )
  await writeFile(join(f.root, 'helper.ts'), 'export const text = "0 Synthetic"')
  expect((await readPackage(await buildCommunity(f.options))).manifest.id).toBe('CommunitySynthetic')
  await expect(buildCommunity({ ...f.options, id: 'MojitoRaidbossOfficial' })).rejects.toThrow('own stable')
})
it('rejects duplicate inputs and timeline names instead of silently replacing registrations', async () => {
  const f = await input('export default { triggers: [] }')
  await expect(buildCommunity({ ...f.options, entries: [f.entry, f.entry] })).rejects.toThrow('Duplicate entry')
  await expect(buildCommunity({ ...f.options, timelines: [f.entry, f.entry] })).rejects.toThrow('Duplicate timeline')
})
it('loads generated registrations and closures into the runtime while keeping unsupported rules visible', async () => {
  const f = await input(`
    let calls = 0;
    Options.Triggers = [{ id: 'registered', zoneId: 1, triggers: [{ id: 'counter', type: 'HeadMarker', netRegex: { id: '003E' }, infoText: () => String(++calls) }] }];
    export default { id: 'default', zoneId: 1, triggers: [{ id: 'unsupported', type: 'UnavailableEvent', netRegex: { flags: '1' }, infoText: 'not supported' }] };
  `)
  const pkg = await readPackage(await buildCommunity(f.options))
  const bundle = join(f.root, 'compiled.mjs')
  await writeFile(bundle, pkg.files.get('entry.mjs')!)
  // Only this synthetic fixture executes in the test process; buildCommunity never imports input.
  const module = await import(pathToFileURL(bundle).href)
  const subscription = () => ({ ready: Promise.resolve(), closed: new Promise(() => {}), dispose() {} })
  let receive!: (batch: unknown) => void, latest: any, catalog: any
  const meta = {
    sessionId: 'synthetic',
    characterGeneration: 1,
    clockGeneration: 1,
    observedAt: 1000,
    source: 'replay',
    timeBase: 'packet-unix',
    sampleStartedAt: null,
    sampleEndedAt: null,
  }
  const field = (value: unknown) => ({ state: 'ok', value, observedAt: 1000, from: 'memory', timeBase: 'packet-unix' })
  const batch = (value: unknown) => ({
    subscriptionId: 'test',
    batchId: 1,
    firstSeq: 1,
    lastSeq: 1,
    initial: false,
    complete: true,
    items: [value],
  })
  const game: Record<string, unknown> = {
    entities: { entities: [{ id: 1, name: field('Synthetic'), classJob: field(19) }], missingIds: [] },
    player: { name: field('Synthetic'), classJob: field(19), hpCur: field(100), inCombat: field(true) },
    party: { isInParty: field(true), members: field([{ id: 1, name: 'Synthetic', slot: 0, ownParty: true }]) },
    zone: { territoryType: field(1), mapId: field(1) },
  }
  const flush = async () => {
    for (let i = 0; i < 30; i++) await Promise.resolve()
  }
  const ctx = {
    config: { get: async () => null, set: async () => {} },
    capabilities: { get: () => ({}) },
    clock: {
      now: () => 1000,
      state: () => ({ now: 1000, generation: 1, source: 'replay', base: 'packet-unix', paused: false }),
      setTimeout: () => () => {},
      sleep: async () => {},
    },
    views: {
      set: (channel: string, value: unknown) => {
        if (channel === 'raidboss-catalog') catalog = structuredClone(value)
        else latest = structuredClone(value)
      },
      flush: async () => {},
      onCommand: async () => () => {},
    },
    ui: { registerFeature: async () => () => {}, registerOverlay: async () => () => {} },
    session: {
      subscribe: (fn: (value: unknown) => void) => {
        queueMicrotask(() =>
          fn(batch({ sessionId: 'synthetic', characterGeneration: 1, state: 'replay', clock: ctx.clock.state() })),
        )
        return subscription()
      },
    },
    game: {
      subscribe: (topic: string, fn: (value: unknown) => void) => {
        queueMicrotask(() => fn(batch({ meta, value: game[topic] })))
        return subscription()
      },
    },
    events: {
      subscribe: (_types: unknown, fn: typeof receive) => {
        receive = fn
        return subscription()
      },
    },
    audio: { say: async () => {}, play: async () => {} },
    log: { error() {} },
  }
  const dispose = await module.activate(ctx)
  await flush()
  expect(latest.moduleFault).toBeNull()
  expect(catalog.revision).toBe(latest.catalogRevision)
  expect(catalog.definitions.map((item: any) => item.setId)).toEqual(expect.arrayContaining(['registered', 'default']))
  expect(latest.diagnostics).toEqual(
    expect.arrayContaining([expect.objectContaining({ triggerId: 'unsupported', state: 'unsupported' })]),
  )
  for (let seq = 1; seq <= 2; seq++) {
    receive(
      batch({
        meta,
        value: {
          type: 'actorControl',
          packet: { seq, timestamp: 1000, sourceActorId: 1, targetActorId: 1 },
          data: { actorId: 1, category: 34, params: [0x3e, 0, 0, 0], self: false },
        },
      }),
    )
    await flush()
    expect(latest.alerts.at(-1).text).toBe(String(seq))
  }
  await dispose()
})
it('rejects runtime module paths that cannot be resolved into the package', async () => {
  const f = await input('export default { id: "dynamic", initData: () => import(globalThis.modulePath) }')
  await expect(buildCommunity(f.options)).rejects.toThrow()
})
