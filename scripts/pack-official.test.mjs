import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash, generateKeyPairSync } from 'node:crypto'
import { access, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { verifyPackage } from '../packages/package/dist/index.js'
import { gitRevision } from './source-links.mjs'

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
const native = ['act-log', 'matcha', 'plugin-skill-display', 'combat-statistics', 'plugin-raidboss', 'deepseek-tts']

test('official packages and checksums contain only the approved plugins', async () => {
  const root = fileURLToPath(new URL('../', import.meta.url))
  const output = path.join(root, 'dist/official')
  const sources = path.join(root, 'packages/overlay-plugins/dist/sources')
  const cli = path.join(root, 'target/release', `mojito-package${process.platform === 'win32' ? '.exe' : ''}`)
  await assert.rejects(access(output), { code: 'ENOENT' })
  assert.deepEqual((await readdir(path.dirname(sources))).sort(), [...templates].sort())
  const revision = gitRevision(root)
  const repository = 'https://github.com/thewakingsands/mojito-plugins'
  const uiRevision = gitRevision(path.join(root, 'vendor/matcha-overlay'))
  const temporary = await mkdtemp(path.join(tmpdir(), 'official-signing-'))
  try {
    const privateJwk = generateKeyPairSync('ed25519').privateKey.export({ format: 'jwk' })
    const fingerprint = createHash('sha256').update(Buffer.from(privateJwk.x, 'base64url')).digest('hex')
    const key = path.join(temporary, 'test.jwk')
    await writeFile(key, JSON.stringify(privateJwk), { mode: 0o600 })
    const pack = () =>
      execFileSync(process.execPath, [path.join(root, 'scripts/pack-official.mjs'), key, fingerprint], {
        stdio: 'pipe',
      })
    const manifests = await Promise.all([
      ...native.map(async (name) => {
        const m = JSON.parse(await readFile(path.join(root, `packages/${name}/plugin.json`), 'utf8'))
        assert.equal(m.license, 'AGPL-3.0-only')
        return { ...m, homepage: `${repository}/tree/${revision}/packages/${name}` }
      }),
      ...templates.map(async (name) => {
        const m = JSON.parse(await readFile(path.join(root, `packages/overlay-plugins/plugins/${name}.json`), 'utf8'))
        const record = JSON.parse(await readFile(path.join(sources, `../${name}/SOURCE.json`), 'utf8'))
        assert.match(record.source, /^https:\/\/github\.com\/ffcafe-overlays\/[^/]+\/tree\/[0-9a-f]{40}$/)
        assert.ok(m.license)
        return { ...m, homepage: record.source }
      }),
    ])
    const expected = manifests.map((m) => `${m.id}-${m.version}.mojito`).sort()
    for (const scenario of ['clean', 'stale']) {
      if (scenario === 'stale') {
        await mkdir(output, { recursive: true })
        await writeFile(path.join(output, 'ffcafe.overlay-mopimopi2-0.2.0.mojito'), 'old package')
        await writeFile(path.join(output, 'mopimopi2-source.tar.gz'), 'old archive')
        await writeFile(path.join(output, 'kagerou-source.tar.gz'), 'old approved-template archive')
        await writeFile(path.join(output, 'SHA256SUMS'), 'old checksums')
        await mkdir(sources)
        await writeFile(path.join(sources, 'mopimopi2-source.tar.gz'), 'old cached source archive')
        await writeFile(path.join(sources, 'kagerou-source.tar.gz'), 'old approved-template cached archive')
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
        const { metadata, signer, files } = verifyPackage(await readFile(file))
        assert.equal(signer.fingerprint, fingerprint)
        const packaged = metadata.manifest
        packaged.networkOrigins?.sort()
        manifest.networkOrigins?.sort()
        assert.deepEqual(packaged, manifest)
        assert(!files.some(({ path }) => /\.(?:tar(?:\.(?:gz|xz|bz2|zst))?|tgz|zip|7z)$/i.test(path)), manifest.id)
        if (manifest.id.startsWith('ffcafe.overlay-')) {
          const name = manifest.id.slice('ffcafe.overlay-'.length)
          assert.equal(
            execFileSync(cli, ['read', file, 'SOURCE.txt'], { encoding: 'utf8' }),
            `${manifest.homepage}\n${repository}/blob/${revision}/scripts/overlay-templates/${name}.patch\n`,
          )
        }
        if (manifest.id === 'ffcafe.matcha') assert(!files.some(({ path }) => path === 'SOURCE.json'))
      }
      const matcha = manifests.find((m) => m.id === 'ffcafe.matcha')
      const matchaFile = path.join(output, `${matcha.id}-${matcha.version}.mojito`)
      assert.equal(
        execFileSync(cli, ['read', matchaFile, 'SOURCE.txt'], { encoding: 'utf8' }),
        `https://github.com/thewakingsands/matcha-overlay/tree/${uiRevision}\n`,
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
  } finally {
    await rm(sources, { recursive: true, force: true })
    await rm(output, { recursive: true, force: true })
    await rm(temporary, { recursive: true, force: true })
  }
})
