import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { manifest } from '@ffcafe/mojito-plugin-sdk/schema'
import { sourceMetadata } from '../packages/matcha/scripts/source.mjs'
import { officialTemplates } from './overlay-templates/templates.mjs'

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
  ...officialTemplates.map((name) => [`ffcafe.overlay-${name}`, `packages/overlay-plugins/dist/${name}`]),
]
const matchaSource = JSON.parse(await readFile(path.join(root, 'packages/matcha/dist/SOURCE.json'), 'utf8'))
assert(!matchaSource.dirty && !matchaSource.ui.dirty, 'Build Matcha from committed sources before official packaging')
assert.deepEqual(matchaSource, sourceMetadata(root), 'Rebuild Matcha from the current committed sources')
await rm(output, { recursive: true, force: true })
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
for (const template of officialTemplates) {
  const name = `${template}-source.tar.gz`
  const file = path.join(output, name)
  await copyFile(path.join(sources, name), file)
  sums.push(
    `${createHash('sha256')
      .update(await readFile(file))
      .digest('hex')}  ${name}`,
  )
}
await writeFile(path.join(output, 'SHA256SUMS'), `${sums.join('\n')}\n`)
