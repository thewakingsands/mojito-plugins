// Run with the built Mojito Electron executable; all game inputs and HTTP responses are synthetic.
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { createRequire } = require('node:module')
const { generateKeyPairSync } = require('node:crypto')
const root = process.env.MOJITO_HOST_ROOT
const output = process.env.MOJITO_TELEMETRY_OUTPUT
assert(root && path.isAbsolute(root) && output && path.isAbsolute(output))
const fromHost = createRequire(path.join(root, 'packages/@ffcafe/mojito-launcher/package.json'))
const { app, BrowserWindow } = fromHost('electron')
const { PluginHost } = fromHost('./dist/main/plugins/host.js')
const { PluginHttp } = fromHost('./dist/main/plugins/services/http.js')
const { registerPluginScheme } = fromHost('./dist/main/plugins/runtime.js')
const { packFiles } = fromHost('@ffcafe/mojito-rust')
app.disableHardwareAcceleration()
app.setPath('userData', path.join(output, 'profile'))
registerPluginScheme()
app.on('window-all-closed', () => {})
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function until(check, label) {
  for (let i = 0; i < 200; i++) {
    if (await check()) return
    await delay(25)
  }
  throw new Error(`Timed out: ${label}`)
}
const reports = []
const request = PluginHttp.prototype.request
PluginHttp.prototype.request = function (input, context) {
  // Replace only the socket transport, keeping host origin, capability and replay checks.
  this.fetch = async (url, options) => {
    assert.equal(url, 'https://mojo.ffcafe.cn/api/telemetry/v1/events')
    assert.equal(options.method, 'POST')
    assert(!options.headers.cookie)
    reports.push(JSON.parse(Buffer.from(options.body).toString()))
    return new Response(null, { status: 503 })
  }
  return request.call(this, input, context)
}
let host, window, page
let resumed = false
let sequence = 0
const result = { checks: {} }
async function main() {
  await fs.mkdir(output, { recursive: true })
  await app.whenReady()
  host = new PluginHost({
    root: path.join(output, 'installation'),
    data: { isOpen: () => false },
    audio: { enqueue: async () => {} },
    development: { confirmDevelopment: async () => true },
    parserAvailable: () => true,
    opcodeVersion: () => '7.57',
    log: (record) => {
      console.log(record.level, record.message, record.fields)
      if (record.message === '输入源已恢复，统计继续') resumed = true
    },
  })
  host.source.begin({ kind: 'live', pid: 1, gameVersion: 'synthetic' })
  host.source.recordCharacter(1n, 1)
  const input = (callback) => {
    const at = Date.now()
    host.source.packet(
      {
        seq: ++sequence,
        timestamp: at,
        direction: 'recv',
        channel: 'zone',
        opcode: 1,
        type: 'Effect',
        sourceActor: 1,
        targetActor: 1,
        serverId: 0,
        ipcTimestamp: 0,
        data: new Uint8Array(),
      },
      at,
    )
    callback(at)
    host.source.afterPacket()
  }
  const event = (value) => input((at) => host.source.event({ eventTime: at, eventReceiver: 1, ...value }))
  event({ eventType: 'ChangeZoneEvent', territoryType: 123 })
  host.source.recordCharacter(1n, 1)
  host.source.memory({ kind: 'party', timestamp: Date.now(), memberCount: 1, memberIds: [1] }, Date.now())
  input(() => {
    host.source.output({
      kind: 'combatantUpdate',
      actorId: 1,
      create: true,
      data: { nickname: 'Synthetic', objectKind: 1, classJob: 34, level: 100, worldId: 1, ownerId: 0, bNpcBase: 0 },
    })
    host.source.output({
      kind: 'combatantUpdate',
      actorId: 9,
      create: true,
      data: { nickname: 'Target', objectKind: 2, classJob: 0, level: 100, ownerId: 0, bNpcBase: 1 },
    })
  })
  const directory = path.resolve(__dirname, '../../packages/combat-statistics/dist')
  const entries = []
  for (const file of await fs.readdir(directory, { recursive: true, withFileTypes: true }))
    if (file.isFile()) {
      const absolute = path.join(file.parentPath, file.name)
      entries.push({
        path: path.relative(directory, absolute).replaceAll('\\', '/'),
        bytes: await fs.readFile(absolute),
      })
    }
  const manifest = JSON.parse(entries.find((file) => file.path === 'plugin.json').bytes.toString())
  const signer = generateKeyPairSync('ed25519').privateKey.export({ format: 'jwk' })
  await host.store().install({ archive: packFiles(entries, JSON.stringify(signer), 'copy'), source: 'telemetry-test' })
  window = new BrowserWindow({
    width: 1000,
    height: 720,
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  })
  async function open() {
    const activation = await host.enable('CombatStatistics')
    const definition = host
      .listUi()
      .find((item) => item.owner.activationId === activation.activationId && item.definition.id === 'settings')
    assert(definition)
    page = host.view(activation.activationId, definition.token)
    page.mount(window.contentView, window)
    page.surface.setBounds({ x: 0, y: 0, width: 1000, height: 720 })
    window.showInactive()
    await page.load()
    await until(() => page.contents.executeJavaScript('!!document.querySelector("#telemetry")'), 'settings page')
  }
  await host.setGrants(manifest.id, ['identity.read'])
  await open()
  assert(
    await page.contents.executeJavaScript(
      'document.querySelector("#telemetry").disabled && !document.querySelector("#telemetry").checked',
    ),
  )
  await page.contents.executeJavaScript(
    'const scope=document.querySelector("#scope"); scope.value="all"; scope.dispatchEvent(new Event("change",{bubbles:true})); true',
  )
  await until(() => resumed, 'all-player scope resumes without live process memory')
  result.checks.sensitivePermissionRequired = true
  await host.stop(manifest.id)
  resumed = false
  await host.setGrants(manifest.id, ['identity.read', 'http.request'])
  await open()
  await page.contents.executeJavaScript('document.querySelector("#telemetry").click(); true')
  await until(async () => {
    const config = JSON.parse(
      await fs.readFile(path.join(output, 'installation', 'plugin-data', manifest.id, '.data/config.json'), 'utf8'),
    )
    return config.settings?.telemetryEnabled === true
  }, 'consent saved')
  await fs.writeFile(path.join(output, 'settings.png'), (await page.contents.capturePage()).toPNG())
  function statuses(actor, id) {
    const buffs = id ? [{ id, actorId: 1, extra: 1, timestamp: Date.now(), duration: 0 }] : []
    event({ eventType: 'BuffReplaceEvent', combatant: actor, buffs })
    event({
      eventType: 'StatusSlotsEvent',
      combatant: actor,
      slots: [{ index: 0, buff: buffs[0] ?? null }],
      changes: [],
    })
  }
  function hit(amount) {
    event({
      eventType: 'AbilityEffectEvent',
      sequence: sequence + 1,
      causedBy: { combatant: 1, type: 1, action: 7477, isAOE: false },
      target: [
        {
          combatant: 9,
          entities: [{ type: 3, severity: 0, flags: 0, param: 0, bonusPercent: 0, value: amount }],
          rawEntities: [],
          targetIndex: 0,
        },
      ],
      animationTargetId: 9,
      actionAnimationId: 7477,
      animationLockTime: 0,
      rotation: 0,
      effectDisplayType: 0,
      targetCount: 1,
    })
  }
  const combat = (inCombat) => event({ eventType: 'PlayerCombatStateEvent', actorId: 1, inCombat })
  statuses(1, null)
  statuses(9, null)
  combat(true)
  for (let i = 0; i < 5; i++) hit(20000)
  statuses(1, 40001)
  for (let i = 0; i < 5; i++) hit(14000)
  combat(false)
  await until(() => reports.length === 1, 'one report from Worker')
  assert.match(reports[0].eventId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  assert.equal(reports[0].payload.observations[0].sampleCount, 5)
  assert.equal(reports[0].payload.observations[0].correctedDamagePerPotency, 70)
  combat(false)
  await delay(300)
  assert.equal(reports.length, 1)
  await host.stop(manifest.id)
  await host.enable(manifest.id)
  await delay(300)
  assert.equal(reports.length, 1)
  result.checks.workerWebCryptoAndSingleAttempt = true
  result.checks.failureAndRestartDoNotRetry = true
  result.checks.realHostPermissionsAndTransport = true
  await host.dispose()
  host = null
  window.destroy()
  window = null
}
main()
  .then(async () => {
    await fs.writeFile(path.join(output, 'result.json'), JSON.stringify(result, null, 2))
    app.exit(0)
  })
  .catch(async (error) => {
    console.error(error)
    result.error = String(error)
    await fs.mkdir(output, { recursive: true })
    await fs.writeFile(path.join(output, 'result.json'), JSON.stringify(result, null, 2))
    await host?.dispose()
    window?.destroy()
    app.exit(1)
  })
