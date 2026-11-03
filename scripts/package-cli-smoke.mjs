import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { generateKeyPairSync } from 'node:crypto'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const cli = fileURLToPath(
  new URL(`../target/release/mojito-package${process.platform === 'win32' ? '.exe' : ''}`, import.meta.url),
)
const root = await mkdtemp(path.join(tmpdir(), 'package-cli-'))
try {
  const input = path.join(root, '目录 with spaces')
  await mkdir(path.join(input, 'backend'), { recursive: true })
  const manifest = {
    schemaVersion: 1,
    id: 'Smoke.Plugin',
    name: 'Package smoke',
    version: '1.0.0',
    apiVersion: '^1.0.0',
    entry: { kind: 'worker', path: 'backend/index.mjs' },
    capabilities: { required: [], optional: [] },
    networkOrigins: [],
  }
  await writeFile(path.join(input, 'plugin.json'), JSON.stringify(manifest))
  await writeFile(path.join(input, 'backend/index.mjs'), "import './依赖.mjs'; export const activate = () => {}")
  await writeFile(path.join(input, 'backend/依赖.mjs'), 'export default 42')
  const key = path.join(root, 'private.jwk')
  await writeFile(key, JSON.stringify(generateKeyPairSync('ed25519').privateKey.export({ format: 'jwk' })), {
    mode: 0o600,
  })
  for (const compression of ['copy', 'lzma2']) {
    const output = path.join(root, `${compression}.mojito`)
    const packed = JSON.parse(execFileSync(cli, ['pack', input, key, output, compression], { encoding: 'utf8' }))
    const verified = JSON.parse(execFileSync(cli, ['verify', output, packed.signer.fingerprint], { encoding: 'utf8' }))
    assert.equal(verified.signatureValid, true)
    assert.deepEqual(verified.metadata.manifest, manifest)
    assert.equal(execFileSync(cli, ['read', output, 'backend/依赖.mjs'], { encoding: 'utf8' }), 'export default 42')
    assert.throws(() => execFileSync(cli, ['verify', output, '0'.repeat(64)], { stdio: 'pipe' }))
    assert.throws(() => execFileSync(cli, ['pack', input, key, output, 'unsupported'], { stdio: 'pipe' }))
    const changed = await readFile(output)
    changed[changed.length - 1] ^= 1
    const tampered = path.join(root, `${compression}-tampered.mojito`)
    await writeFile(tampered, changed)
    assert.throws(() => execFileSync(cli, ['verify', tampered], { stdio: 'pipe' }))
  }
  assert.deepEqual((await readdir(input)).sort(), ['backend', 'plugin.json'])
  console.log('CLI packing, signatures, compression and Unicode paths passed')
} finally {
  await rm(root, { recursive: true, force: true })
}
