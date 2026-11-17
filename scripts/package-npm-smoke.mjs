import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { generatePrivateKey, packFiles, verifyPackage } from '../packages/package/dist/index.js'

const repository = fileURLToPath(new URL('../', import.meta.url))
const native = path.join(repository, 'target/release', `mojito-package${process.platform === 'win32' ? '.exe' : ''}`)
const root = await mkdtemp(path.join(tmpdir(), 'mojito-package-npm-'))
const run = (command, args, options = {}) => execFileSync(command, args, { encoding: 'utf8', ...options })
try {
  const manifest = { id: 'Distribution.Test', version: '1.0.0', entry: { path: 'backend/main.mjs' } }
  const source = Buffer.from('export const activate = () => 42')
  const files = [
    { path: 'plugin.json', bytes: Buffer.from(JSON.stringify(manifest)) },
    { path: 'backend/main.mjs', bytes: source },
  ]
  const input = path.join(root, 'plugin')
  await mkdir(path.join(input, 'backend'), { recursive: true })
  for (const { path: name, bytes } of files) await writeFile(path.join(input, name), bytes)
  const key = path.join(root, 'author.jwk')
  await writeFile(key, generatePrivateKey(), { mode: 0o600, flag: 'wx' })
  for (const compression of ['copy', 'lzma2']) {
    const wasmBytes = packFiles(files, await readFile(key, 'utf8'), compression)
    const wasmFile = path.join(root, `wasm-${compression}.mojito`)
    await writeFile(wasmFile, wasmBytes)
    const nativeResult = JSON.parse(run(native, ['verify', wasmFile]))
    assert.deepEqual(nativeResult.metadata.manifest, manifest)
    assert.equal(run(native, ['read', wasmFile, 'backend/main.mjs']), source.toString())
    const nativeFile = path.join(root, `native-${compression}.mojito`)
    run(native, ['pack', input, key, nativeFile, compression])
    assert.deepEqual(verifyPackage(await readFile(nativeFile)).metadata.manifest, manifest)
  }

  const pack = JSON.parse(
    run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', root], {
      cwd: path.join(repository, 'packages/package'),
    }),
  )[0]
  assert.ok(pack.files.some(({ path: name }) => name === 'wasm/package_bg.wasm'))
  assert.ok(
    pack.files.every(
      ({ path: name }) =>
        name === 'package.json' ||
        name.startsWith('dist/') ||
        name.startsWith('wasm/') ||
        /^README|^LICENSE|^COPYING/.test(name),
    ),
  )
  const app = path.join(root, 'app')
  await mkdir(app)
  await writeFile(path.join(app, 'package.json'), '{"private":true,"type":"module"}')
  const env = {
    ...process.env,
    PATH: path.dirname(process.execPath),
    npm_config_cache: path.join(root, 'npm-cache'),
    npm_config_script_shell: process.platform === 'win32' ? process.env.ComSpec : '/bin/sh',
  }
  run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--offline', path.join(root, pack.filename)], {
    cwd: app,
    env,
  })
  const cli = path.join(app, 'node_modules/@ffcafe/mojito-package/dist/cli.js')
  const output = path.join(root, 'installed.mojito')
  run(process.execPath, [cli, 'pack', input, '--key', key, '--output', output], { cwd: app, env })
  const result = JSON.parse(run(process.execPath, [cli, 'verify', output], { cwd: app, env }))
  assert.deepEqual(
    JSON.parse(run('npm', ['exec', '--offline', '--', 'mojito-package', 'verify', output], { cwd: app, env })),
    result,
  )
  const bytes = await readFile(output)
  assert.equal(result.size, bytes.length)
  assert.equal(result.sha256, createHash('sha256').update(bytes).digest('hex'))
  const freshKey = path.join(root, 'installed.jwk')
  run(process.execPath, [cli, 'keygen', freshKey], { cwd: app, env })
  assert.equal(JSON.parse(await readFile(freshKey, 'utf8')).crv, 'Ed25519')
  run(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      "import {generatePrivateKey} from '@ffcafe/mojito-package'; if(typeof generatePrivateKey() !== 'string') process.exit(1)",
    ],
    { cwd: app, env },
  )
  console.log('Native/WASM interoperability and installed npm tarball without Rust, git or compression tools passed')
} finally {
  await rm(root, { recursive: true, force: true })
}
