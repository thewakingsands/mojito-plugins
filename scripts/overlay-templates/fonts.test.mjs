import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { copyFont, pruneFonts } from './fonts.mjs'

test('font pruning keeps WOFF2, local preferences and standalone fonts, with no dangling fallback URLs', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'overlay-fonts-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(path.join(root, 'css'))
  for (const file of [
    'icons.eot',
    'icons.ttf',
    'icons.woff',
    'icons.svg',
    'icons.woff2',
    'material.ttf',
    'shared.woff',
  ])
    await writeFile(path.join(root, file), 'font bytes')
  await writeFile(
    path.join(root, 'css/main.css'),
    `@font-face{font-family:icons;src:url('../icons.eot?#fix');src:local('Icons'),url('../icons.woff2') format('woff2'),url('../icons.woff') format('woff'),url('../icons.ttf') format('truetype'),url('../icons.svg#icons') format('svg')}
@font-face{font-family:material;src:url('../material.ttf') format('truetype')}
@font-face{font-family:shared;src:url('../icons.woff2') format('woff2'),url('../shared.woff') format('woff')}
@font-face{font-family:another;src:url('../shared.woff') format('woff')}
@font-face{font-family:embedded;src:url('data:application/font-woff;base64,YWJj') format('woff'),url('../icons.woff2') format('woff2')}`,
  )
  await pruneFonts(root)
  assert.deepEqual((await readdir(root)).sort(), ['css', 'icons.woff2', 'material.ttf', 'shared.woff'])
  const css = await readFile(path.join(root, 'css/main.css'), 'utf8')
  assert(css.includes("local('Icons')"))
  assert(!css.includes('data:'))
  assert(!/icons\.(?:woff\b|ttf|eot|svg)/.test(css))
  assert(css.includes('../material.ttf'))
  assert(css.includes('../shared.woff'))
})

test('font copying includes only requested normal weights, their resources and license', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'overlay-font-copy-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const source = path.join(root, 'source'),
    destination = path.join(root, 'destination')
  await mkdir(path.join(source, 'files'), { recursive: true })
  await writeFile(path.join(source, 'LICENSE'), 'font license')
  for (const weight of [400, 500, 700]) {
    await writeFile(path.join(source, `${weight}.css`), `@font-face{src:url(./files/${weight}.woff2) format('woff2')}`)
    await writeFile(path.join(source, 'files', `${weight}.woff2`), `weight ${weight}`)
  }
  await copyFont(source, destination, [400, 700])
  assert.deepEqual((await readdir(destination)).sort(), ['400.css', '700.css', 'LICENSE', 'files'])
  assert.deepEqual((await readdir(path.join(destination, 'files'))).sort(), ['400.woff2', '700.woff2'])
  assert.equal(await readFile(path.join(destination, 'files/700.woff2'), 'utf8'), 'weight 700')
})
