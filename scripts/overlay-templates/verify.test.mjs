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
  for (const name of ['SOURCE.txt', 'LICENSE', 'index.html', 'assets/index.js'])
    await writeFile(path.join(directory, name), 'synthetic')
  await writeFile(
    path.join(directory, 'SOURCE.json'),
    JSON.stringify({
      name: 'skyline',
      revision: 'a'.repeat(40),
      version: '1.0',
      source: `https://example.invalid/tree/${'a'.repeat(40)}`,
    }),
  )
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

test('migration package requires declared settings, pinned metadata and local runtime resources', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'overlay-docs-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  for (const file of ['SOURCE.txt', 'LICENSE', 'index.html']) await writeFile(path.join(directory, file), 'synthetic')
  await writeFile(
    path.join(directory, 'SOURCE.json'),
    JSON.stringify({
      name: 'glass',
      revision: 'b'.repeat(40),
      version: '1',
      source: `https://example.invalid/tree/${'b'.repeat(40)}`,
    }),
  )
  await assert.rejects(verifyTemplate(directory, 'glass'), /ENOENT/)
  await writeFile(path.join(directory, 'settings.html'), '<script src="settings.js"></script>')
  await assert.rejects(verifyTemplate(directory, 'glass'), /ENOENT/)
  await writeFile(path.join(directory, 'settings.js'), 'void 0')
  await verifyTemplate(directory, 'glass')
  await writeFile(path.join(directory, 'settings.html'), '<script src="https://example.invalid/settings.js"></script>')
  await assert.rejects(verifyTemplate(directory, 'glass'), /Remote runtime resource/)
})
