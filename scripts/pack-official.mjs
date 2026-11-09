import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { manifest } from '@ffcafe/mojito-plugin-sdk/schema'

const [key, fingerprint, ...extra] = process.argv.slice(2)
assert(key && fingerprint && !extra.length, 'Usage: pack:official <private.jwk> <expected-fingerprint>')
const root = fileURLToPath(new URL('../', import.meta.url))
const cli = path.join(root, 'target/release', `mojito-package${process.platform === 'win32' ? '.exe' : ''}`)
const output = path.join(root, 'dist/official')
const plugins = [
  ['Cafe.Matcha', 'packages/matcha/dist'],
  ['MojitoSkillDisplay', 'packages/plugin-skill-display/dist'],
  ['CombatStatistics', 'packages/combat-statistics/dist'],
  ['MojitoRaidbossOfficial', 'packages/plugin-raidboss/dist'],
  ['OverlayKagerou', 'packages/overlay-plugins/dist/kagerou'],
  ['OverlaySkyline', 'packages/overlay-plugins/dist/skyline'],
  ['OverlayMopiMopi2', 'packages/overlay-plugins/dist/mopimopi2'],
]
await mkdir(output, { recursive: true })
const sums = []
for (const [id, directory] of plugins) {
  const input = path.join(root, directory)
  const parsed = manifest(JSON.parse(await readFile(path.join(input, 'plugin.json'), 'utf8')))
  assert.equal(parsed.id, id)
  const filename = `${id}-${parsed.version}.mojito`
  const file = path.join(output, filename)
  execFileSync(cli, ['pack', input, path.resolve(key), file, 'lzma2'], { stdio: ['ignore', 'pipe', 'pipe'] })
  execFileSync(cli, ['verify', file, fingerprint], { stdio: ['ignore', 'pipe', 'pipe'] })
  assert.deepEqual(JSON.parse(execFileSync(cli, ['read', file, 'plugin.json'], { encoding: 'utf8' })), parsed)
  sums.push(
    `${createHash('sha256')
      .update(await readFile(file))
      .digest('hex')}  ${filename}`,
  )
  console.log(filename)
}
const sources = path.join(root, 'packages/overlay-plugins/dist/sources')
for (const name of (await readdir(sources)).filter((name) => name.endsWith('-source.tar.gz')).sort()) {
  const file = path.join(output, name)
  await copyFile(path.join(sources, name), file)
  sums.push(
    `${createHash('sha256')
      .update(await readFile(file))
      .digest('hex')}  ${name}`,
  )
}
await writeFile(path.join(output, 'SHA256SUMS'), `${sums.join('\n')}\n`)
