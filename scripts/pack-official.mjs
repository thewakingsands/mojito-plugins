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
  ['ffcafe.matcha', 'packages/matcha/dist'],
  ['ffcafe.skill-display', 'packages/plugin-skill-display/dist'],
  ['ffcafe.combat-statistics', 'packages/combat-statistics/dist'],
  ['ffcafe.raidboss', 'packages/plugin-raidboss/dist'],
  ['ffcafe.tts-deepseek', 'packages/deepseek-tts/dist'],
  ['ffcafe.overlay-kagerou', 'packages/overlay-plugins/dist/kagerou'],
  ['ffcafe.overlay-skyline', 'packages/overlay-plugins/dist/skyline'],
  ['ffcafe.overlay-mopimopi2', 'packages/overlay-plugins/dist/mopimopi2'],
  ['ffcafe.overlay-faceroll', 'packages/overlay-plugins/dist/faceroll'],
  ['ffcafe.overlay-horizoverlay', 'packages/overlay-plugins/dist/horizoverlay'],
  ['ffcafe.overlay-cmskin', 'packages/overlay-plugins/dist/cmskin'],
  ['ffcafe.overlay-mopimopi1', 'packages/overlay-plugins/dist/mopimopi1'],
  ['ffcafe.overlay-ikegami', 'packages/overlay-plugins/dist/ikegami'],
  ['ffcafe.overlay-ember', 'packages/overlay-plugins/dist/ember'],
  ['ffcafe.overlay-amethyst', 'packages/overlay-plugins/dist/amethyst'],
  ['ffcafe.overlay-klondike', 'packages/overlay-plugins/dist/klondike'],
  ['ffcafe.overlay-glass', 'packages/overlay-plugins/dist/glass'],
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
