import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { extractEmberFonts, prepareEmberIcons } from './ember-icons.mjs'

test('Ember icon deduplication preserves all logical paths and original bytes', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'ember-icons-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  for (const dir of ['public/img/icons/effects', 'public/img/icons/skills', 'src/data'])
    await mkdir(path.join(root, dir), { recursive: true })
  const source = { 'effects/1.jpg': 'same', 'effects/2.jpg': 'different', 'skills/3.jpg': 'same' }
  for (const [file, bytes] of Object.entries(source)) await writeFile(path.join(root, 'public/img/icons', file), bytes)
  await prepareEmberIcons(root)
  const mapping = JSON.parse(await readFile(path.join(root, 'src/data/icon-paths.json')))
  assert.equal(Object.keys(mapping).length, 3)
  assert.equal((await readdir(path.join(root, 'public/img/icons/skills'))).length, 0)
  for (const [file, bytes] of Object.entries(source))
    assert.equal(await readFile(path.join(root, 'public', mapping[file]), 'utf8'), bytes)
})

test('Ember embedded fonts become local files without changing bytes', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'ember-fonts-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const directory = path.join(root, 'build/static/css')
  await mkdir(directory, { recursive: true })
  const bytes = Buffer.from('synthetic font bytes')
  await writeFile(
    path.join(directory, 'app.css'),
    `@font-face{src:url("data:application/font-woff;charset=utf-8;base64,${bytes.toString('base64')}")}`,
  )
  await extractEmberFonts(root)
  const css = await readFile(path.join(directory, 'app.css'), 'utf8')
  assert(!css.includes('data:'))
  const file = /url\("([^"]+)"\)/.exec(css)[1]
  assert.deepEqual(await readFile(path.join(directory, file)), bytes)
})
