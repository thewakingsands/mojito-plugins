import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { extractEmberFonts } from './ember-icons.mjs'

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
