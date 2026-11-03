import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { verifyTemplate } from './verify.mjs'

test('plugin template verification preserves resource pruning and rejects unresolved files', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'overlay-verify-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  await mkdir(path.join(directory, 'assets'))
  for (const name of ['SOURCE.json', 'SOURCE.txt', 'index.html', 'assets/index.js'])
    await writeFile(path.join(directory, name), 'synthetic')
  await verifyTemplate(directory, 'skyline')
  for (const name of [
    'app.d.ts',
    'app.js.map',
    'sw.js',
    'workbox-test.js',
    'registerSW.js',
    'manifest.webmanifest',
    'devbg/raid.jpg',
    'fonts/font.woff2',
  ]) {
    const file = path.join(directory, name)
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, 'unexpected')
    await assert.rejects(verifyTemplate(directory, 'skyline'), /Development file|Unneeded Skyline resource/)
    await rm(file)
  }
  await writeFile(
    path.join(directory, 'assets/font.woff2'),
    'version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 1234\n',
  )
  await assert.rejects(verifyTemplate(directory, 'skyline'), /Unresolved Git LFS pointer/)
})
