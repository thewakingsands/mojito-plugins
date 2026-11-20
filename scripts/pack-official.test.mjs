import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash, generateKeyPairSync } from 'node:crypto'
import { access, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { sourceMetadata } from '../packages/matcha/scripts/source.mjs'

const templates = [
  'amethyst',
  'cmskin',
  'ember',
  'faceroll',
  'glass',
  'horizoverlay',
  'ikegami',
  'kagerou',
  'klondike',
  'mopimopi1',
  'skyline',
]
const native = ['matcha', 'plugin-skill-display', 'combat-statistics', 'plugin-raidboss', 'deepseek-tts']

test('official packages and checksums contain exactly the approved plugins and source archives', async () => {
  const root = fileURLToPath(new URL('../', import.meta.url))
  const output = path.join(root, 'dist/official')
  const sources = path.join(root, 'packages/overlay-plugins/dist/sources')
  const cli = path.join(root, 'target/release', `mojito-package${process.platform === 'win32' ? '.exe' : ''}`)
  await assert.rejects(access(output), { code: 'ENOENT' })
  const temporary = await mkdtemp(path.join(tmpdir(), 'official-signing-'))
  const staleSource = path.join(sources, 'mopimopi2-source.tar.gz')
  const originalStaleSource = await readFile(staleSource).catch((error) => {
    if (error.code !== 'ENOENT') throw error
    return null
  })
  try {
    const privateJwk = generateKeyPairSync('ed25519').privateKey.export({ format: 'jwk' })
    const fingerprint = createHash('sha256').update(Buffer.from(privateJwk.x, 'base64url')).digest('hex')
    const key = path.join(temporary, 'test.jwk')
    await writeFile(key, JSON.stringify(privateJwk), { mode: 0o600 })
    const pack = () =>
      execFileSync(process.execPath, [path.join(root, 'scripts/pack-official.mjs'), key, fingerprint], {
        stdio: 'pipe',
      })
    const manifests = await Promise.all(
      [
        ...native.map((name) => path.join(root, `packages/${name}/plugin.json`)),
        ...templates.map((name) => path.join(root, `packages/overlay-plugins/plugins/${name}.json`)),
      ].map(async (file) => JSON.parse(await readFile(file, 'utf8'))),
    )
    const expectedPackages = manifests.map((m) => `${m.id}-${m.version}.mojito`).sort()
    const expectedArchives = templates.map((name) => `${name}-source.tar.gz`).sort()
    const expected = [...expectedPackages, ...expectedArchives].sort()
    for (const scenario of ['clean', 'stale']) {
      if (scenario === 'stale') {
        await mkdir(output, { recursive: true })
        await writeFile(path.join(output, 'ffcafe.overlay-mopimopi2-0.2.0.mojito'), 'old package')
        await writeFile(path.join(output, 'mopimopi2-source.tar.gz'), 'old archive')
        await writeFile(path.join(output, 'SHA256SUMS'), 'old checksums')
        await writeFile(staleSource, 'old cached source archive')
      }
      pack()
      assert.deepEqual((await readdir(output)).sort(), [...expected, 'SHA256SUMS'].sort(), scenario)
      const actualSums = (await readFile(path.join(output, 'SHA256SUMS'), 'utf8')).trim().split('\n').sort()
      const expectedSums = await Promise.all(
        expected.map(async (file) => {
          const digest = createHash('sha256')
            .update(await readFile(path.join(output, file)))
            .digest('hex')
          return `${digest}  ${file}`
        }),
      )
      assert.deepEqual(actualSums, expectedSums.sort(), scenario)
      for (const manifest of manifests) {
        const file = path.join(output, `${manifest.id}-${manifest.version}.mojito`)
        execFileSync(cli, ['verify', file, fingerprint])
        const packaged = JSON.parse(execFileSync(cli, ['read', file, 'plugin.json'], { encoding: 'utf8' }))
        packaged.networkOrigins?.sort()
        manifest.networkOrigins?.sort()
        assert.deepEqual(packaged, manifest)
      }
      for (const file of expectedArchives)
        assert.deepEqual(await readFile(path.join(output, file)), await readFile(path.join(sources, file)))
      const matcha = manifests.find((m) => m.id === 'ffcafe.matcha')
      const matchaFile = path.join(output, `${matcha.id}-${matcha.version}.mojito`)
      assert.deepEqual(
        JSON.parse(execFileSync(cli, ['read', matchaFile, 'SOURCE.json'], { encoding: 'utf8' })),
        sourceMetadata(root),
      )
      for (const font of ['geist', 'geist-mono']) {
        assert.deepEqual(
          execFileSync(cli, ['read', matchaFile, `third-party/${font}-LICENSE`]),
          await readFile(path.join(root, `vendor/matcha-overlay/node_modules/@fontsource-variable/${font}/LICENSE`)),
        )
      }
      for (const [name, fonts] of [
        ['amethyst', ['aldrich', 'material-icons']],
        ['ikegami', ['lato']],
        ['klondike', ['lato']],
      ]) {
        const manifest = manifests.find((m) => m.id === `ffcafe.overlay-${name}`)
        for (const font of fonts)
          assert.deepEqual(
            execFileSync(cli, [
              'read',
              path.join(output, `${manifest.id}-${manifest.version}.mojito`),
              `licenses/${font}-LICENSE`,
            ]),
            await readFile(path.join(root, `scripts/overlay-templates/font-licenses/${font}-LICENSE`)),
          )
      }
    }
    const archive = path.join(sources, expectedArchives[0])
    const saved = await readFile(archive)
    await rm(archive)
    try {
      assert.throws(pack, /Command failed/, 'missing approved source must fail packaging')
      await assert.rejects(access(path.join(output, 'SHA256SUMS')), { code: 'ENOENT' })
    } finally {
      await writeFile(archive, saved)
    }
    const sourceFile = path.join(root, 'packages/matcha/dist/SOURCE.json')
    const cleanSource = await readFile(sourceFile)
    try {
      for (const dirty of [
        { ...JSON.parse(cleanSource), dirty: true },
        { ...JSON.parse(cleanSource), ui: { ...JSON.parse(cleanSource).ui, dirty: true } },
        { ...JSON.parse(cleanSource), revision: '0'.repeat(40) },
      ]) {
        await writeFile(sourceFile, JSON.stringify(dirty))
        assert.throws(pack, /Command failed/, 'uncommitted or mismatched source must fail packaging')
      }
    } finally {
      await writeFile(sourceFile, cleanSource)
    }
  } finally {
    if (originalStaleSource === null) await rm(staleSource, { force: true })
    else await writeFile(staleSource, originalStaleSource)
    await rm(output, { recursive: true, force: true })
    await rm(temporary, { recursive: true, force: true })
  }
})
