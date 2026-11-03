import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { check, manifest, resourcePath } from '@ffcafe/mojito-plugin-sdk/schema'
import { build } from 'esbuild'

const packageRoot = fileURLToPath(new URL('../../', import.meta.url))
const runtime = join(packageRoot, 'raidboss')
const ui = join(packageRoot, 'plugin-raidboss/dist')
const upstream = 'e79ea7f16093be5b80cda0e2d5bc8eb899d6fb4b'
const specifier = (path: string) => JSON.stringify(path.replaceAll('\\', '/'))
const inside = (root: string, path: string) => {
  const child = relative(root, path)
  return child === '' || (!child.startsWith(`..${sep}`) && child !== '..' && !isAbsolute(child))
}
export interface BuildInput {
  id: string
  name: string
  version: string
  entries: string[]
  timelines?: string[]
  privateJwk: string
}

/** Compile input without importing it in Node, or loading its npm scripts, plugins or tsconfig. */
export async function buildCommunity(input: BuildInput): Promise<Buffer> {
  const metadata = manifest({
    schemaVersion: 1,
    id: input.id,
    name: input.name,
    version: input.version,
    apiVersion: '^1.7.0',
    entry: { kind: 'worker', path: 'entry.mjs' },
    capabilities: { required: ['session.read', 'game.read', 'events.read', 'ui.register'], optional: ['audio.play'] },
    networkOrigins: [],
  })
  check(metadata.id !== 'MojitoRaidbossOfficial', 'Community packages must use their own stable plugin ID')
  check(input.entries.length > 0, 'At least one local JS/TS entry is required')
  const entries = input.entries.map((entry) => resolve(entry))
  check(new Set(entries).size === entries.length, 'Duplicate entry')
  for (const entry of entries) check(['.js', '.mjs', '.ts'].includes(extname(entry)), 'Expected a JS/TS entry')
  let root = dirname(entries[0])
  for (const entry of entries)
    while (!inside(root, entry)) {
      const parent = dirname(root)
      check(parent !== root, 'Entries must share a filesystem root')
      root = parent
    }
  const entryNames = entries.map((entry) => relative(root, entry).replaceAll('\\', '/'))
  const timelines: Record<string, string> = Object.create(null)
  for (const file of input.timelines ?? []) {
    const name = resourcePath(basename(file))
    check(!(name in timelines), 'Duplicate timeline filename')
    timelines[name] = await readFile(file, 'utf8')
  }
  const registration = `const Options = { Triggers: [] }; export { Options };`
  const source = `
    import { activateRaidboss } from ${specifier(join(runtime, 'src/index.ts'))};
    import { Options } from 'mojito:registration';
    const sets = [];
    ${entries
      .map(
        (entry, index) => `{
      const loaded = await import(${specifier(entry)});
      const registered = Options.Triggers;
      if (!Array.isArray(registered)) throw new Error('Options.Triggers must be an array');
      if (loaded.default !== undefined) sets.push({ path: ${JSON.stringify(entryNames[index])}, set: loaded.default });
      for (const [index, set] of registered.entries()) if (set !== loaded.default) sets.push({ path: ${JSON.stringify(entryNames[index])} + '/' + index, set });
      Options.Triggers = [];
    } // entry ${index}`,
      )
      .join('\n')}
    const closed = Object.freeze([]);
    Object.defineProperty(Options, 'Triggers', { get: () => closed, set: () => { throw new Error('Runtime trigger registration is unsupported; rebuild and restart the plugin'); } });
    export const activate = (ctx) => activateRaidboss(ctx, sets, ${JSON.stringify(timelines)}, ${JSON.stringify(upstream)});
  `
  const compiled = await build({
    stdin: { contents: source, resolveDir: packageRoot, sourcefile: 'community-entry.ts', loader: 'ts' },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    target: 'es2023',
    charset: 'utf8',
    tsconfigRaw: { compilerOptions: { experimentalDecorators: false } },
    inject: ['mojito:registration'],
    loader: { '.txt': 'text' },
    logLevel: 'silent',
    logOverride: { 'unsupported-dynamic-import': 'error', 'unsupported-require-call': 'error' },
    plugins: [
      {
        name: 'fixed-raidboss-inputs',
        setup(context) {
          context.onResolve({ filter: /^mojito:registration$/ }, () => ({ path: 'registration', namespace: 'mojito' }))
          context.onLoad({ filter: /.*/, namespace: 'mojito' }, () => ({ contents: registration, loader: 'js' }))
          // esbuild leaves URL imports external; the Worker could not load them.
          context.onResolve({ filter: /^(?:https?|data):/ }, (args) => ({
            errors: [{ text: `Unsupported dependency: ${args.path}` }],
          }))
          context.onResolve({ filter: /^@cactbot\// }, (args) => {
            const path = resourcePath(args.path.slice('@cactbot/'.length))
            return { path: resolve(runtime, 'vendor/cactbot', path.endsWith('.ts') ? path : `${path}.ts`) }
          })
        },
      },
    ],
  })
  check(!compiled.warnings.some((warning) => warning.id === 'direct-eval'), 'Direct eval is not supported')
  const files: { name: string; body: Buffer | string }[] = [
    { name: 'entry.mjs', body: Buffer.from(compiled.outputFiles[0].contents) },
    { name: 'plugin.json', body: JSON.stringify(metadata, null, 2) },
    {
      name: 'collection.json',
      body: JSON.stringify(
        {
          collectionId: metadata.id,
          version: metadata.version,
          upstreamCommit: upstream,
          entries: entryNames,
          timelines: Object.keys(timelines),
        },
        null,
        2,
      ),
    },
    { name: 'LICENSE-cactbot', body: await readFile(join(runtime, 'vendor/cactbot/LICENSE')) },
    { name: 'PROVENANCE-cactbot.md', body: await readFile(join(runtime, 'vendor/cactbot/PROVENANCE.md')) },
  ]
  const copyUi = async (directory: string, prefix = '') => {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const name = prefix + item.name
      if (item.isDirectory()) await copyUi(join(directory, item.name), `${name}/`)
      else if (item.isFile() && !['entry.mjs', 'plugin.json', 'PROVENANCE-cactbot.md'].includes(name))
        files.push({ name, body: await readFile(join(directory, item.name)) })
    }
  }
  await copyUi(ui)
  const temporary = await mkdtemp(join(tmpdir(), 'raidboss-package-'))
  try {
    const directory = join(temporary, 'input')
    for (const { name, body } of files) {
      const destination = join(directory, resourcePath(name))
      await mkdir(dirname(destination), { recursive: true })
      await writeFile(destination, body, { flag: 'wx' })
    }
    const key = join(temporary, 'private.jwk')
    const output = join(temporary, 'plugin.mojito')
    await writeFile(key, input.privateJwk, { mode: 0o600 })
    const cli = resolve(packageRoot, '../target/release', `mojito-package${process.platform === 'win32' ? '.exe' : ''}`)
    execFileSync(cli, ['pack', directory, key, output, 'lzma2'], { stdio: ['ignore', 'pipe', 'pipe'] })
    return await readFile(output)
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}
