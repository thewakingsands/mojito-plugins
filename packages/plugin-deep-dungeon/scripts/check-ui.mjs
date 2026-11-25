import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { limitNames } from '../../plugin-sdk/dist/limits.js'

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core')
assert(process.env.MOJITO_SOURCE, 'Set MOJITO_SOURCE to a Mojito checkout for its actual theme and base stylesheet')
const root = fileURLToPath(new URL('../dist/', import.meta.url))
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
      { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css' }[
        path.extname(file)
      ] ?? 'application/octet-stream',
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
const { monsters } = JSON.parse(await readFile(path.join(root, 'catalog.json'), 'utf8'))
const { commit } = JSON.parse(await readFile(path.join(root, 'monsterdex-source.json'), 'utf8'))
const longest = monsters.reduce((first, next) =>
  [...(next.notes.zhCN ?? '')].length > [...(first.notes.zhCN ?? '')].length ? next : first,
)
const noNotes = monsters.find((monster) => !monster.notes.en?.trim() && !monster.notes.zhCN?.trim())
const shots = []
const errors = []
try {
  const page = await browser.newPage({ viewport: { width: 320, height: 720 }, colorScheme: 'dark' })
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  // Exercise the built worker and SDK view connection with local host inputs.
  await page.addInitScript(
    (limits) => {
      const original = window.postMessage.bind(window)
      window.postMessage = (message, ...args) => {
        if (message?.type !== 'mojito:view-connect') return original(message, ...args)
        void (async () => {
          const { activate } = await import('/entry.mjs')
          const scope = document.body.dataset.page
          const view = {
            viewId: 'browser-check',
            kind: scope === 'overlay' ? 'overlay' : 'feature',
            definitionId: scope === 'overlay' ? 'target' : scope,
            instanceId: null,
            placement: scope === 'settings' ? 'settings' : 'sidebar',
          }
          const activationId = 'browser-check'
          const { port1, port2 } = new MessageChannel()
          const send = (kind, fields) => port1.postMessage({ protocol: 1, activationId, kind, ...fields })
          const views = new Map()
          const state = new Map()
          const commands = new Map()
          const game = new Map()
          let next = 0
          let config = null
          const publish = (channel, value) => {
            state.set(channel, value)
            const listener = views.get(channel)
            if (listener) {
              const { id, seq } = listener
              listener.seq++
              send('batch', {
                subscriptionId: id,
                batchId: seq,
                firstSeq: seq,
                lastSeq: seq,
                initial: seq === 0,
                complete: true,
                items: [value],
              })
            }
          }
          const dispose = await activate({
            config: {
              get: async () => config,
              set: async (_key, value) => {
                config = value
              },
            },
            session: { get: async () => ({ uiLanguage: 'zh-CN', dataLanguage: 'chs' }) },
            views: {
              set: publish,
              flush: async () => {},
              onCommand: async (channel, handle) => {
                commands.set(channel, handle)
                return () => commands.delete(channel)
              },
            },
            ui: { registerOverlay: async () => () => {}, registerFeature: async () => () => {} },
            game: {
              subscribe: (topic, receive) => {
                game.set(topic, receive)
                return { ready: Promise.resolve(), closed: new Promise(() => {}), dispose: () => game.delete(topic) }
              },
            },
            data: { rows: async () => [] },
            log: { debug() {} },
          })
          const field = (value) => ({ state: 'ok', value })
          const emit = (topic, value) => game.get(topic)?.({ complete: true, items: [{ value }] })
          window.checkTarget = (territory, nameId) => {
            emit('zone', { territoryType: field(territory) })
            emit('target', field(nameId === null ? null : 101))
            if (nameId !== null)
              emit('entities', {
                entities: [
                  {
                    id: 101,
                    objectKind: field(2),
                    subKind: field(5),
                    bNpcName: field(nameId),
                    hpCur: field(7500),
                    hpMax: field(10000),
                  },
                ],
              })
          }
          if (scope === 'overlay') {
            const banner = document.createElement('aside')
            banner.textContent = '页面验收 · 真实图鉴资料／测试目标输入'
            document.body.prepend(banner)
          }
          port1.onmessage = async ({ data }) => {
            if (data.kind === 'subscribe') {
              const channel = data.params.channel
              const id = String(++next)
              views.set(channel, { id, seq: 0 })
              send('subscribed', { id: data.id, subscriptionId: id })
              publish(channel, state.get(channel))
            } else if (data.kind === 'request' && data.method === 'view.command') {
              const { channel, payload } = data.params
              const value = await commands.get(channel)(payload, view)
              send('response', { id: data.id, ok: true, value })
            }
          }
          window.addEventListener('pagehide', () => void dispose(), { once: true })
          window.dispatchEvent(
            new MessageEvent('message', {
              source: window,
              origin: 'mojito-plugin://runtime',
              data: { type: 'mojito:view-port' },
              ports: [port2],
            }),
          )
          send('hello', {
            apiVersion: '2.0.0',
            identity: {
              id: 'ffcafe.deep-dungeon',
              version: '0.1.0',
              activationId,
              mode: 'worker',
              environment: 'development',
            },
            capabilities: {},
            limits: { schemaVersion: 1, revision: 'browser-check', values: limits },
            clock: { now: null, base: null, source: null, generation: 0, paused: false },
            viewIdentity: view,
          })
        })().catch(console.error)
      }
    },
    Object.fromEntries(limitNames.map((name) => [name, 65536])),
  )
  async function shot(name, id) {
    assert(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      'Unexpected horizontal scrolling',
    )
    await page.screenshot({ path: path.join(output, `${name}.png`), fullPage: true })
    shots.push({
      name,
      id,
      viewport: page.viewportSize(),
      theme: 'dark',
      catalog: commit,
      target: name.startsWith('overlay') ? 'test input' : null,
    })
  }
  const search = page.getByRole('searchbox')
  const note = page.locator('article .notes')
  await page.goto(`${url}/reference.html`)
  await page.locator('article h2').waitFor()
  await page.getByLabel('迷宫', { exact: true }).selectOption(longest.dungeons[0])
  await search.fill(String(longest.nameId))
  assert.equal(await note.textContent(), longest.notes.zhCN)
  assert.equal(longest.nameId, 12247)
  assert.equal([...longest.notes.zhCN].length, 897)
  await shot('reference-real-long-note-320', longest.nameId)

  const floors = page.getByRole('tab', { name: '楼层' })
  await floors.click()
  await page.mouse.move(310, 710)
  await floors.evaluate(async (node) => {
    const buttons = [...node.parentElement.querySelectorAll('button')]
    await Promise.all(buttons.flatMap((button) => button.getAnimations()).map((animation) => animation.finished))
  })
  assert.equal(await floors.getAttribute('aria-selected'), 'true')
  await page.getByLabel('楼层提示组').selectOption('EO51')
  assert.match(await page.locator('.floors h3').textContent(), /EO51/)
  assert((await page.locator('.floors .notes').textContent()).trim())
  await shot('reference-real-floors-320', 'EO51')

  await page.setViewportSize({ width: 380, height: 280 })
  await page.goto(`${url}/overlay.html`)
  async function select(territory, id) {
    await page.waitForFunction(() => window.checkTarget)
    await page.evaluate(([zone, nameId]) => window.checkTarget(zone, nameId), [territory, id])
    await page.waitForFunction((nameId) => document.querySelector('.name-id')?.textContent === `#${nameId}`, id)
  }
  await select(1099, longest.nameId)
  assert.equal(await page.locator('.notes').textContent(), longest.notes.zhCN)
  assert.match(await page.locator('.health').textContent(), /75.0%/)
  await shot('overlay-real-long-note', longest.nameId)
  const { territories } = JSON.parse(await readFile(path.join(root, 'catalog.json'), 'utf8'))
  await select(territories.find((range) => range.dungeon === noNotes.dungeons[0]).first, noNotes.nameId)
  assert.equal(await page.locator('.notes').count(), 0)
  assert(await page.locator('.facts').isVisible())
  await shot('overlay-real-record-without-note', noNotes.nameId)
  await select(1099, 99999999)
  assert.equal(await page.locator('.empty').textContent(), '暂无资料')
  assert.equal(await page.locator('.facts').count(), 0)
  await shot('overlay-no-matching-record', 99999999)
  await page.evaluate(() => window.checkTarget(1099, null))
  await page.locator('#app').waitFor({ state: 'hidden' })

  await page.goto(`${url}/settings.html`)
  const guideLanguage = page.getByLabel('攻略语言')
  await guideLanguage.selectOption('en')
  await page.waitForFunction(() => !document.querySelector('#language').disabled)
  assert.equal(await guideLanguage.inputValue(), 'en')
  assert.deepEqual(errors, [])
  await writeFile(
    path.join(output, 'results.json'),
    JSON.stringify({ commit, screenshots: shots, browserErrors: errors }, null, 2),
  )
  console.log(`Validated ${shots.length} screenshots with the real MonsterDex catalog ${commit}`)
} finally {
  await browser.close()
  server.close()
}
