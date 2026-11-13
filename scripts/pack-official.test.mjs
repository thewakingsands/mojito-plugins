import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash, generateKeyPairSync } from 'node:crypto'
import { access, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

test('packs and verifies every official plugin with one temporary signer', async () => {
  const root = fileURLToPath(new URL('../', import.meta.url))
  const output = path.join(root, 'dist/official')
  await assert.rejects(access(output), { code: 'ENOENT' })
  const temporary = await mkdtemp(path.join(tmpdir(), 'official-signing-'))
  try {
    const privateJwk = generateKeyPairSync('ed25519').privateKey.export({ format: 'jwk' })
    const fingerprint = createHash('sha256').update(Buffer.from(privateJwk.x, 'base64url')).digest('hex')
    const key = path.join(temporary, 'test.jwk')
    await writeFile(key, JSON.stringify(privateJwk), { mode: 0o600 })
    execFileSync(process.execPath, [path.join(root, 'scripts/pack-official.mjs'), key, fingerprint], { stdio: 'pipe' })
    const packages = (await readdir(output)).filter((file) => file.endsWith('.mojito'))
    assert.equal(packages.length, 16)
    const matcha = JSON.parse(await readFile(path.join(root, 'packages/matcha/plugin.json'), 'utf8'))
    const expectedDisplay = JSON.parse(
      await readFile(path.join(root, 'packages/plugin-skill-display/plugin.json'), 'utf8'),
    )
    const displayFile = `${expectedDisplay.id}-${expectedDisplay.version}.mojito`
    assert(packages.includes(`${matcha.id}-${matcha.version}.mojito`))
    assert(packages.includes(displayFile))
    const display = JSON.parse(
      execFileSync(
        path.join(root, `target/release/mojito-package${process.platform === 'win32' ? '.exe' : ''}`),
        ['read', path.join(output, displayFile), 'plugin.json'],
        { encoding: 'utf8' },
      ),
    )
    assert.deepEqual(display, expectedDisplay)
    const sums = await readFile(path.join(output, 'SHA256SUMS'), 'utf8')
    for (const file of packages) {
      const digest = createHash('sha256')
        .update(await readFile(path.join(output, file)))
        .digest('hex')
      assert(sums.includes(`${digest}  ${file}`))
    }
    assert.equal((await readdir(output)).filter((file) => file.endsWith('-source.tar.gz')).length, 12)
  } finally {
    await rm(output, { recursive: true, force: true })
    await rm(temporary, { recursive: true, force: true })
  }
})
