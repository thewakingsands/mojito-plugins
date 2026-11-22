import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core')
assert(process.env.MOJITO_SOURCE, 'Set MOJITO_SOURCE to a Mojito checkout for its actual theme and base stylesheet')
const root = fileURLToPath(new URL('../dist-fixture/', import.meta.url))
const output = path.resolve(process.env.UI_OUTPUT || 'deep-dungeon-ui')
const host = path.join(process.env.MOJITO_SOURCE, 'packages/@ffcafe/mojito-launcher/src')
const style = await readFile(path.join(host, 'main/plugins/style.ts'), 'utf8')
// Use the host's pure token generator without importing its Electron resource server.
const source = style.slice(style.indexOf('export const styleContract'), style.indexOf('/** Fontsource'))
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText
const { pluginTokens } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`)
const theme = await readFile(path.join(host, 'renderer/public/theme.css'), 'utf8')
const css = pluginTokens(theme) + (await readFile(path.join(host, 'renderer/public/mojito-base.css'), 'utf8'))
await mkdir(output, { recursive: true })
const server = createServer(async (request, response) => {
  try {
    const name = new URL(request.url, 'http://localhost').pathname
    if (name === '/favicon.ico') {
      response.writeHead(204).end()
      return
    }
    if (name === '/host/mojito-base.css') {
      response.setHeader('Content-Type', 'text/css')
      response.end(css)
      return
    }
    const file = path.resolve(root, `.${name}`)
    if (!file.startsWith(root)) {
      response.writeHead(403).end()
      return
    }
    response.setHeader(
      'Content-Type',
      { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[path.extname(file)] ??
        'application/octet-stream',
    )
    response.end(await readFile(file))
  } catch (error) {
    response.writeHead(500).end(String(error))
  }
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const url = `http://127.0.0.1:${server.address().port}`
const browser = await chromium.launch({
  executablePath: process.env.CHROME_BIN || '/usr/bin/google-chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
})
const shots = []
const errors = []
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 700 }, colorScheme: 'light' })
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  async function shot(name, id) {
    await page.screenshot({
      path: path.join(output, `${name}.png`),
      fullPage: true,
      omitBackground: name.startsWith('overlay'),
    })
    shots.push({
      name,
      id,
      viewport: page.viewportSize(),
      theme: await page.evaluate(() => (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')),
      data: 'synthetic',
    })
  }
  async function fits() {
    assert(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      'Unexpected horizontal scrolling',
    )
  }
  await page.goto(`${url}/reference.html`)
  await page.locator('article h2').waitFor()
  assert.equal((await page.locator('article .notes').textContent()).length, 897)
  await fits()
  await shot('reference-long-zh-light', 910001)
  await page.locator('button[data-id="910002"]').click()
  assert.equal(await page.locator('article .notes').count(), 0)
  await shot('reference-no-notes', 910002)
  await page.locator('button[data-id="910003"]').click()
  assert.match(await page.locator('article .notes').textContent(), /Synthetic English fallback/)
  assert.equal(await page.locator('article em').count(), 0)
  await page.getByRole('searchbox').fill('910002')
  assert.equal(await page.locator('.monster-list button').count(), 1)
  await page.locator('.monster-list button').focus()
  await page.keyboard.press('Enter')
  assert.equal(await page.locator('article h2').textContent(), '训练木偶')
  await page.getByRole('searchbox').fill('absent')
  assert.equal(await page.locator('.monster-list button').count(), 0)
  assert.equal(await page.locator('article').textContent(), '没有匹配的怪物')
  await page.getByRole('searchbox').fill('')
  await page.getByRole('button', { name: '楼层', exact: true }).click()
  assert.equal(await page.locator('.reference-layout').isHidden(), true)
  assert.equal(await page.getByRole('searchbox', { includeHidden: true }).isHidden(), true)
  await page.getByLabel('楼层提示组').selectOption('练习 11–20')
  assert.match(await page.locator('.floors h3').textContent(), /11–20/)
  assert.equal(await page.locator('.floors .notes').textContent(), '用于手动查阅的合成楼层提示。')
  const floorSelector = await page.getByLabel('楼层提示组').boundingBox()
  const floorHeading = await page.locator('.floors h3').boundingBox()
  assert(floorHeading.y - floorSelector.y - floorSelector.height >= 16, 'Floor heading needs separation')
  await shot('reference-floors-light', null)
  await page.getByRole('button', { name: '怪物', exact: true }).click()
  assert.equal(await page.locator('.floors').isHidden(), true)
  await page.emulateMedia({ colorScheme: 'dark' })
  await shot('reference-long-zh-dark', 910001)
  await page.setViewportSize({ width: 320, height: 700 })
  await fits()
  assert((await page.getByRole('searchbox').boundingBox()).height >= 30)
  await shot('reference-narrow-dark', 910001)
  await page.getByRole('button', { name: '楼层', exact: true }).focus()
  await page.keyboard.press('Enter')
  await fits()
  assert.equal(await page.locator('.reference-layout').isHidden(), true)
  await shot('reference-floors-narrow-dark', null)
  await page.getByRole('button', { name: '怪物', exact: true }).click()
  await page.getByLabel('迷宫', { exact: true }).selectOption('EO')
  assert.equal(await page.locator('.monster-list button').count(), 2)
  await page.getByLabel('迷宫', { exact: true }).selectOption('HoH')
  assert.equal(await page.locator('.monster-list button').count(), 0)
  await page.getByRole('button', { name: '楼层', exact: true }).click()
  assert.equal(await page.locator('.floors h3').textContent(), '暂无楼层资料')
  assert.equal(await page.getByLabel('楼层提示组').isHidden(), true)
  await page.getByLabel('迷宫', { exact: true }).selectOption('PotD')
  await page.getByRole('button', { name: '怪物', exact: true }).click()
  await page.evaluate(async () => {
    const { host } = window.deepDungeonFixture
    window.pendingNames = []
    host.commands.set('reference', () => new Promise((resolve) => window.pendingNames.push(resolve)))
    await host.commands.get('display')({ language: 'en' })
    await host.commands.get('display')({ language: 'zhCN' })
  })
  assert.equal(await page.evaluate(() => window.pendingNames.length), 2)
  await page.evaluate(() => window.pendingNames[1]({ language: 'chs', names: { 910001: '当前名称' } }))
  assert.equal(await page.locator('article h2').textContent(), '当前名称')
  await page.evaluate(async () => {
    window.pendingNames[0]({ language: 'en', names: { 910001: '迟到名称' } })
    await new Promise(requestAnimationFrame)
  })
  assert.equal(await page.locator('article h2').textContent(), '当前名称')
  await page.getByLabel('迷宫', { exact: true }).selectOption('EO')
  await page.getByLabel('迷宫', { exact: true }).selectOption('PotD')
  assert.equal(await page.evaluate(() => window.pendingNames.length), 4)
  await page.evaluate(() => window.pendingNames[3]({ language: 'chs', names: { 910001: '当前迷宫名称' } }))
  await page.evaluate(async () => {
    window.pendingNames[2]({ language: 'chs', names: { 910001: '旧迷宫名称' } })
    await new Promise(requestAnimationFrame)
  })
  assert.equal(await page.locator('article h2').textContent(), '当前迷宫名称')
  await page.setViewportSize({ width: 380, height: 280 })
  await page.goto(`${url}/overlay.html`)
  await page.locator('#app h2').waitFor()
  await fits()
  assert.deepEqual(
    await page.evaluate(() => [
      getComputedStyle(document.documentElement).backgroundColor,
      getComputedStyle(document.body).backgroundColor,
    ]),
    ['rgba(0, 0, 0, 0)', 'rgba(0, 0, 0, 0)'],
  )
  assert.match(await page.locator('.health').textContent(), /75.0%/)
  assert.deepEqual(await page.locator('.resistances div').allTextContents(), [
    '有效眩晕、止步',
    '无效加重、睡眠',
    '未知减速',
  ])
  assert.equal(await page.locator('.facts div').count(), 2)
  const resistanceRows = await page
    .locator('.resistances div')
    .evaluateAll((nodes) =>
      nodes.map((node) => ({ top: node.getBoundingClientRect().top, bottom: node.getBoundingClientRect().bottom })),
    )
  assert(
    resistanceRows.slice(1).every((row, index) => row.top >= resistanceRows[index].bottom),
    'Control groups must occupy separate lines',
  )
  await shot('overlay-long-zh-dark', 910001)
  await page.evaluate(() => window.deepDungeonFixture.select(919999))
  assert.equal(await page.locator('.empty').textContent(), '暂无资料')
  assert.equal(await page.locator('.facts').count(), 0)
  await shot('overlay-missing-guide', 919999)
  await page.evaluate(() => window.deepDungeonFixture.select(910002))
  assert.equal(await page.locator('#app .notes').count(), 0)
  assert(
    (await page.locator('#app').boundingBox()).height <= 280,
    'Grouped controls must fit the default height without notes',
  )
  await shot('overlay-no-notes', 910002)
  await page.setViewportSize({ width: 320, height: 280 })
  await page.evaluate(() => window.deepDungeonFixture.select(910001))
  await fits()
  await shot('overlay-long-zh-narrow-dark', 910001)
  await page.evaluate(() => window.deepDungeonFixture.select(910002))
  await page.emulateMedia({ colorScheme: 'light' })
  assert.equal(await page.locator('#app h2').evaluate((node) => getComputedStyle(node).color), 'rgb(255, 255, 255)')
  assert(
    (await page.locator('#app dd').evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).color))).every(
      (color) => color === 'rgb(255, 255, 255)',
    ),
  )
  await shot('overlay-no-notes-light', 910002)
  await page.evaluate(() => window.deepDungeonFixture.select(null))
  assert.equal(await page.locator('#app').isHidden(), true)
  await page.setViewportSize({ width: 320, height: 700 })
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto(`${url}/settings.html`)
  await page.getByLabel('攻略语言').waitFor()
  await page.getByLabel('攻略语言').selectOption('en')
  await page.waitForFunction(() => window.deepDungeonFixture.host.snapshots.get('display').language === 'en')
  await fits()
  await shot('settings-narrow-dark', null)
  assert.deepEqual(errors, [])
  await writeFile(
    path.join(output, 'results.json'),
    JSON.stringify(
      {
        data: 'synthetic',
        checks:
          'target clear, missing guide, no notes, long text, English fallback, plain text, search, keyboard, dungeon filter, floor redirect, independent sections, floor heading spacing, grouped controls, late language/dungeon name results, settings, light/dark, 320px layout',
        screenshots: shots,
        browserErrors: errors,
      },
      null,
      2,
    ),
  )
  console.log(`Passed browser checks; ${shots.length} synthetic screenshots in ${output}`)
} finally {
  await browser.close()
  server.close()
}
