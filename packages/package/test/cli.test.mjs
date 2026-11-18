import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url))
test('CLI defaults, key protection, git confirmation, output replacement and input exclusions', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mojito-package-cli-'))
  try {
    const home = path.join(root, 'user')
    const preload = path.join(root, 'user.mjs')
    await writeFile(
      preload,
      `import os from 'node:os'; import { syncBuiltinESMExports } from 'node:module'; os.homedir = () => ${JSON.stringify(home)}; syncBuiltinESMExports()`,
    )
    const invoke = (args, expected = 0) => {
      const result = spawnSync(process.execPath, ['--import', pathToFileURL(preload).href, cli, ...args], {
        cwd: root,
        env: { ...process.env, PATH: path.dirname(process.execPath) },
        encoding: 'utf8',
      })
      assert.equal(result.status, expected, result.stderr)
      return result
    }
    const input = path.join(root, '目录 with spaces')
    await mkdir(input)
    const manifest = { id: 'CLI.Test', version: '1.0.0', entry: { path: 'index.mjs' } }
    await writeFile(path.join(input, 'plugin.json'), JSON.stringify(manifest))
    await writeFile(path.join(input, 'index.mjs'), 'export default 1')
    invoke(['keygen'])
    const key = path.join(home, '.mojito-keys/author.jwk')
    const saved = await readFile(key, 'utf8')
    assert.equal(JSON.parse(saved).crv, 'Ed25519')
    if (process.platform !== 'win32') assert.equal((await stat(key)).mode & 0o777, 0o600)
    assert.match(invoke(['keygen'], 1).stderr, /EEXIST/)
    assert.equal(await readFile(key, 'utf8'), saved)
    const packed = JSON.parse(invoke(['pack', input]).stdout)
    const output = `${input}.mojito`
    assert.equal(packed.size, (await readFile(output)).length)
    assert.deepEqual(JSON.parse(invoke(['verify', output]).stdout), packed)
    await writeFile(path.join(input, 'index.mjs'), 'export default 2')
    const replacement = JSON.parse(invoke(['pack', input]).stdout)
    assert.notEqual(replacement.sha256, packed.sha256)
    invoke(['pack', input, '--key', key, '--output', path.join(root, 'custom.mojito'), '--compression', 'copy'])
    const repository = path.join(root, 'repo')
    await mkdir(path.join(repository, '.git'), { recursive: true })
    const gitKey = path.join(repository, 'author.jwk')
    assert.match(invoke(['keygen', gitKey], 1).stderr, /--allow-git/)
    invoke(['keygen', gitKey, '--allow-git', '--gitignore'])
    assert.ok((await readFile(path.join(repository, '.gitignore'), 'utf8')).split('\n').includes('author.jwk'))
    await writeFile(path.join(input, 'author.jwk'), saved)
    assert.match(invoke(['pack', input, '--key', path.join(input, 'author.jwk')], 1).stderr, /outside/)
    await rm(path.join(input, 'author.jwk'))
    assert.match(invoke(['pack', input, '--output', path.join(input, 'output.mojito')], 1).stderr, /outside/)
    await symlink(
      process.platform === 'win32' ? path.dirname(key) : key,
      path.join(input, 'linked-key'),
      process.platform === 'win32' ? 'junction' : 'file',
    )
    assert.match(invoke(['pack', input], 1).stderr, /symlinks/)
    assert.equal(await readFile(key, 'utf8'), saved)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
