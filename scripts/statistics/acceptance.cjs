// All identities and combat facts are synthetic. Run with the built host's Electron executable.
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { createRequire } = require('node:module')
const { generateKeyPairSync, createHash } = require('node:crypto')
const { execFileSync } = require('node:child_process')
const { getHeapCodeStatistics, writeHeapSnapshot } = require('node:v8')
const root = process.env.MOJITO_HOST_ROOT
const output = process.env.MOJITO_ACCEPTANCE_OUTPUT
assert(
  root && path.isAbsolute(root) && output && path.isAbsolute(output),
  'Set absolute host and disposable output paths',
)
const fromHost = createRequire(path.join(root, 'packages/@ffcafe/mojito-launcher/package.json'))
const { app, BrowserWindow } = fromHost('electron')
const { PluginHost } = fromHost('./dist/main/plugins/host.js')
const { PluginRuntime, registerPluginScheme } = fromHost('./dist/main/plugins/runtime.js')
const { PluginRouter } = fromHost('./dist/main/plugins/router.js')
const { packFiles } = fromHost('@ffcafe/mojito-rust')
const seconds = Number(process.env.MOJITO_ACCEPTANCE_SECONDS ?? 3600)
const settleMs = Number(process.env.MOJITO_ACCEPTANCE_SETTLE_MS ?? 60_000)
const measuredRounds = 5
const idleSampleCount = 9
const idleSampleIntervalMs = 1000
const snapshotHeap = process.env.MOJITO_ACCEPTANCE_HEAP_SNAPSHOTS === '1'
assert(Number.isSafeInteger(seconds) && seconds >= 1)
assert(Number.isSafeInteger(settleMs) && settleMs >= 0)
const id = 'ffcafe.combat-statistics'
const pluginRoot = path.resolve(__dirname, '../..')
const commit = (directory) => execFileSync('git', ['rev-parse', 'HEAD'], { cwd: directory, encoding: 'utf8' }).trim()
const result = {
  input: 'synthetic',
  hostCommit: commit(root),
  pluginsCommit: commit(pluginRoot),
  versions: process.versions,
  platform: process.platform,
  secondsPerRound: seconds,
  settleMs,
  idleSampleCount,
  idleSampleIntervalMs,
  snapshotHeap,
  rounds: [],
  checks: {},
}
app.disableHardwareAcceleration()
app.setPath('userData', path.join(output, 'profile'))
app.commandLine.appendSwitch('js-flags', '--expose-gc')
registerPluginScheme()
app.on('window-all-closed', () => {})
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function until(check, label) {
  for (let i = 0; i < 1200; i++) {
    if (await check()) return
    await delay(25)
  }
  throw new Error(`Timed out: ${label}`)
}
let host, window, page, activation
let handled = 0,
  sent = 0,
  seq = 0,
  resumed = false
let rpc = { count: 0, totalMs: 0, maxMs: 0 }
const requests = new Map()
const receive = PluginRouter.prototype.receive
PluginRouter.prototype.receive = function (message) {
  handled++
  const key = `${this.scope.identity.activationId}:${message.id}`
  if (message.kind === 'request' && message.method !== 'clock.sleep') requests.set(key, performance.now())
  if (message.kind === 'cancel') requests.delete(key)
  if (message.kind === 'stopped') {
    for (const pending of requests.keys())
      if (pending.startsWith(`${this.scope.identity.activationId}:`)) requests.delete(pending)
  }
  return receive.call(this, message)
}
const send = PluginRuntime.prototype.send
PluginRuntime.prototype.send = function (message) {
  sent++
  if (message.kind === 'response') {
    const key = `${this.scope.identity.activationId}:${message.id}`
    const start = requests.get(key)
    if (start !== undefined) {
      const elapsed = performance.now() - start
      rpc.count++
      rpc.totalMs += elapsed
      rpc.maxMs = Math.max(rpc.maxMs, elapsed)
      requests.delete(key)
    }
  }
  return send.call(this, message)
}
function resources() {
  return {
    activations: host.active.size,
    queueConsumers: host.queues.consumers.size,
    sourceStreams: host.source.streams.size,
    sessions: host.source.sessions.size,
    gameWatchListeners: host.game.changed.size,
    gameDrains: host.game.drains.size,
    sourceTimers: host.clock.timers.size,
    clockListeners: host.clock.listeners.size,
    windows: BrowserWindow.getAllWindows().length,
    probeRequests: requests.size,
  }
}
function memory() {
  const processes = app.getAppMetrics().map(({ pid, type, memory }) => ({ pid, type, rssKiB: memory.workingSetSize }))
  return {
    main: process.memoryUsage(),
    code: getHeapCodeStatistics(),
    processes,
    treeRssKiB: processes.reduce((sum, item) => sum + item.rssKiB, 0),
  }
}
function memoryTrend(rounds) {
  const metric = (read) => {
    const samples = rounds.map(({ idle }) => idle.map(read))
    const medians = samples.map((group) => [...group].sort((a, b) => a - b)[Math.floor(group.length / 2)])
    const spans = samples.map((group) => Math.max(...group) - Math.min(...group))
    // Compare changes between loads with the largest spread observed without a load.
    const fluctuation = Math.max(...spans)
    const increments = medians.slice(1).map((value, index) => value - medians[index])
    return {
      samples,
      medians,
      spans,
      fluctuation,
      increments,
    }
  }
  const mainHeapBytes = metric((sample) => sample.mainHeapBytes)
  const processTreeRssKiB = metric((sample) => sample.processTreeRssKiB)
  return { mainHeapBytes, processTreeRssKiB, forcedGc: typeof global.gc === 'function' }
}
function queued() {
  return [...host.queues.consumers.values()].reduce((total, consumer) => total + consumer.items, 0)
}
function input(at, callback) {
  host.source.replayTimeline.update(at, 0, false, false)
  host.source.packet(
    {
      seq: ++seq,
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
  callback()
  host.source.afterPacket()
}
function event(at, value) {
  input(at, () => host.source.event({ eventTime: at, eventReceiver: 1, ...value }))
}
function hit(at, actor, amount = 100) {
  event(at, {
    eventType: 'AbilityEffectEvent',
    sequence: seq + 1,
    causedBy: { combatant: actor, type: 1, action: 900_001, isAOE: false },
    target: [
      {
        combatant: 100,
        targetIndex: 0,
        rawEntities: [],
        entities: [{ type: 3, severity: 0, flags: 0, param: 0, bonusPercent: 0, value: amount }],
      },
    ],
    animationTargetId: 100,
    actionAnimationId: 900_001,
    animationLockTime: 0,
    rotation: 0,
    effectDisplayType: 0,
    targetCount: 1,
  })
}
function startSource(at) {
  host.source.begin({ kind: 'replay', gameVersion: 'synthetic' })
  host.source.replayTimeline.update(at, 0, false, false)
  host.source.recordCharacter(1n, 1)
  host.source.memory(
    { kind: 'party', timestamp: at, memberCount: 24, memberIds: Array.from({ length: 24 }, (_, i) => i + 1) },
    at,
  )
  event(at, { eventType: 'ChangeZoneEvent', territoryType: 1263 })
  input(at, () => {
    for (const actor of [...Array.from({ length: 24 }, (_, i) => i + 1), 100])
      host.source.output({
        kind: 'combatantUpdate',
        actorId: actor,
        create: true,
        data: {
          nickname: `Synthetic ${actor}`,
          objectKind: actor === 100 ? 2 : 1,
          classJob: 19,
          level: 100,
          worldId: actor,
          ownerId: 0,
          bNpcBase: actor === 100 ? 1 : 0,
        },
      })
  })
}
async function open(feature) {
  const definition = host
    .listUi()
    .find((item) => item.owner.activationId === activation.activationId && item.definition.id === feature)
  assert(definition)
  const surface = host.view(activation.activationId, definition.token)
  surface.mount(window.contentView, window)
  surface.surface.setBounds({ x: 0, y: 0, width: 1100, height: 760 })
  await surface.load()
  await until(
    () => surface.contents.executeJavaScript('Boolean(document.querySelector(".layout, .settings-page"))'),
    feature,
  )
  return surface
}
function state() {
  return [...host.active.values()].find((value) => value.id === id)?.views.snapshot('statistics')
}
async function hashes() {
  const directory = path.join(output, 'installation/plugins', id, 'data/storage/log')
  const files = []
  for (const name of (await fs.readdir(directory)).sort()) {
    const bytes = await fs.readFile(path.join(directory, name))
    files.push({ name, bytes: bytes.length, hash: createHash('sha256').update(bytes).digest('hex') })
  }
  return files
}
async function main() {
  await fs.mkdir(output, { recursive: true })
  await app.whenReady()
  host = new PluginHost({
    root: path.join(output, 'installation'),
    data: { isOpen: () => false },
    audio: { enqueue: async () => {} },
    parserAvailable: () => true,
    opcodeVersion: () => '7.57',
    log: (record) => {
      if (record.message === '输入源已恢复，统计继续') resumed = true
      if (record.level === 'error' || record.level === 'warn') console.log(record.level, record.message, record.fields)
    },
  })
  const entries = []
  const directory = path.join(pluginRoot, 'packages/combat-statistics/dist')
  for (const file of await fs.readdir(directory, { recursive: true, withFileTypes: true }))
    if (file.isFile()) {
      const absolute = path.join(file.parentPath, file.name)
      entries.push({
        path: path.relative(directory, absolute).replaceAll('\\', '/'),
        bytes: await fs.readFile(absolute),
      })
    }
  const signer = generateKeyPairSync('ed25519').privateKey.export({ format: 'jwk' })
  await host
    .store()
    .install({ archive: packFiles(entries, JSON.stringify(signer), 'copy'), source: 'synthetic-acceptance' })
  await host.setGrants(id, ['identity.read'])
  window = new BrowserWindow({
    width: 1100,
    height: 760,
    show: true,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  })
  assert.equal(typeof global.gc, 'function', 'Run Electron with --js-flags=--expose-gc')
  result.baseline = resources()
  for (let round = 0; round <= measuredRounds; round++) {
    const label = round === 0 ? 'warmup' : `round-${round}`
    resumed = false
    const at = Date.UTC(2026, 0, 2 + round)
    startSource(at)
    activation = await host.enable(id)
    await until(() => resumed, 'input resumes')
    page = await open('statistics')
    rpc = { count: 0, totalMs: 0, maxMs: 0 }
    const samples = [],
      drains = []
    let peak = memory()
    const started = performance.now()
    let sum = 0,
      max = 0,
      backlogMax = 0
    for (let second = 0; second < seconds; second++) {
      for (let actor = 1; actor <= 24; actor++) hit(at + second * 1000 + actor, actor)
      if ((second + 1) % 3 === 0)
        event(at + second * 1000 + 30, {
          eventType: 'DoTEvent',
          combatant: 100,
          isHeal: false,
          statusId: 0,
          value: 500,
          sourceId: 0xe0000000,
          param2: 0,
        })
      const before = performance.now()
      await host.source.drain(new AbortController().signal, 'bounded')
      const elapsed = performance.now() - before
      sum += elapsed
      max = Math.max(max, elapsed)
      backlogMax = Math.max(backlogMax, queued())
      if ((second + 1) % 60 === 0 || second + 1 === seconds) {
        const current = memory()
        if (current.treeRssKiB > peak.treeRssKiB) peak = current
        samples.push({ sourceSeconds: second + 1, queued: queued(), ...current })
        drains.push({ sourceSeconds: second + 1, totalMs: sum, maxMs: max, backlogMax })
        sum = max = backlogMax = 0
      }
    }
    const end = at + seconds * 1000 + 20_000
    host.source.replayTimeline.update(end, 0, false, false)
    await host.source.drain(new AbortController().signal, 'complete')
    await until(() => state()?.current?.ended, 'quiet end and final publication')
    const final = state().current
    assert.equal(final.encounterDamage.value, seconds * 24 * 100, 'integer total')
    assert.equal(final.rows.length, 24, 'every synthetic member is counted')
    assert.equal(final.diagnostics.unassignedObservedDamage, Math.floor(seconds / 3) * 500, 'unknown periodic total')
    assert.equal(
      final.diagnostics.observedTargetDamage,
      seconds * 24 * 100 + Math.floor(seconds / 3) * 500,
      'all observed damage conserved',
    )
    await until(() => queued() === 0, 'final view updates acknowledged')
    assert.equal(state().inputError, null)
    assert(!final.quality.some((text) => /不完整/.test(text)), 'complete input')
    await until(
      () => page.contents.executeJavaScript('document.querySelectorAll("table.damage tr.actor").length === 24'),
      'table rows',
    )
    await fs.writeFile(path.join(output, `statistics-${label}.png`), (await page.contents.capturePage()).toPNG())
    let runtime = [...host.active.values()].find((value) => value.id === id).runtime
    const run = {
      round,
      wallMs: performance.now() - started,
      finalDamage: final.encounterDamage.value,
      peak,
      samples,
      drains,
      rpc: { ...rpc, meanMs: rpc.count ? rpc.totalMs / rpc.count : null },
    }
    await host.stop(id)
    assert(runtime.window.isDestroyed(), 'Worker owner destroyed')
    assert(page.contents.isDestroyed(), 'feature view destroyed')
    runtime = null
    page = null
    await delay(500)
    const stoppedMessages = { handled, sent }
    const saved = await hashes()
    const stopped = []
    for (let elapsed = 0; elapsed < settleMs; elapsed += 1000) {
      await delay(Math.min(1000, settleMs - elapsed))
      global.gc?.()
      stopped.push({ elapsedMs: Math.min(elapsed + 1000, settleMs), ...memory() })
    }
    const idle = []
    for (let sample = 0; sample < idleSampleCount; sample++) {
      await delay(idleSampleIntervalMs)
      global.gc()
      const current = memory()
      idle.push({ mainHeapBytes: current.main.heapUsed, processTreeRssKiB: current.treeRssKiB })
      stopped.push({ elapsedMs: settleMs + (sample + 1) * idleSampleIntervalMs, ...current })
    }
    if (snapshotHeap && (round === 1 || round === measuredRounds)) {
      global.gc()
      try {
        writeHeapSnapshot(path.join(output, `${label}.heapsnapshot`))
      } catch (error) {
        result.heapSnapshotErrors ??= {}
        result.heapSnapshotErrors[label] = String(error)
      }
    }
    // Inputs after disposal must not be processed or change the saved log.
    hit(end + 1000, 1, 999)
    await delay(250)
    assert.deepEqual({ handled, sent }, stoppedMessages, 'no plugin traffic after stop')
    assert.deepEqual(await hashes(), saved, 'no late writes after stop')
    assert.deepEqual(resources(), result.baseline, 'subscriptions, source timers and windows return to baseline')
    // Persist the trace before the next activation; keeping prior samples would inflate the measured heap.
    const trace = `${label}.json`
    await fs.writeFile(path.join(output, trace), JSON.stringify({ ...run, stopped }, null, 2))
    const summary = {
      round: run.round,
      wallMs: run.wallMs,
      finalDamage: run.finalDamage,
      peak: run.peak,
      rpc: run.rpc,
      maxQueuedAfterDrain: Math.max(...drains.map((sample) => sample.backlogMax)),
      lastQueuedAfterDrain: samples.at(-1).queued,
      idle,
      released: resources(),
      files: saved,
      trace,
    }
    if (round === 0) result.warmup = summary
    else result.rounds.push(summary)
    await fs.writeFile(path.join(output, 'result.json'), JSON.stringify(result, null, 2))
  }
  // A new activation must read the logs and show the same final fight through the actual page.
  activation = await host.enable(id)
  page = await open('statistics')
  await until(() => state()?.selected?.encounterDamage?.value === seconds * 24 * 100, 'reloaded history total')
  assert.equal(state().selected.rows.length, 24)
  await fs.writeFile(path.join(output, 'history.png'), (await page.contents.capturePage()).toPNG())
  page.close()
  page = await open('settings')
  await page.contents.executeJavaScript(
    'document.querySelector(".settings-page .mojito-panel button[data-variant=\\"danger\\"]").click(); true',
  )
  await until(
    () => page.contents.executeJavaScript('Boolean(document.querySelector("dialog[open]"))'),
    'clear confirmation',
  )
  await page.contents.executeJavaScript(
    'document.querySelector("dialog[open] button[data-variant=\\"danger\\"]").click(); true',
  )
  await until(
    () => page.contents.executeJavaScript('document.querySelector(".settings-page").innerText.includes("已清空")'),
    'clear history',
  )
  page.close()
  page = await open('statistics')
  await until(
    () => page.contents.executeJavaScript('document.querySelectorAll(".fight").length === 0'),
    'cleared history list',
  )
  result.checks = {
    integerTotals: true,
    unknownPeriodicConserved: true,
    noBacklogAtEnd: true,
    cleanupAfterEachRound: true,
    noProcessingAfterStop: true,
    noWritesAfterStop: true,
    historyReload: true,
    clearThroughUI: true,
  }
  result.memoryTrend = memoryTrend(result.rounds)
  if (snapshotHeap && !result.heapSnapshotErrors) {
    try {
      const { compare } = require('./heap-retention.cjs')
      result.memoryTrend.heapComparison = compare(
        path.join(output, 'round-1.heapsnapshot'),
        path.join(output, 'round-5.heapsnapshot'),
      )
    } catch (error) {
      result.memoryTrend.heapComparisonError = String(error)
    }
  }
  await host.dispose()
  host = null
  window.destroy()
  window = null
}
main()
  .then(async () => {
    await fs.writeFile(path.join(output, 'result.json'), JSON.stringify(result, null, 2))
    app.exit(Object.values(result.checks).every(Boolean) ? 0 : 1)
  })
  .catch(async (error) => {
    console.error(error)
    result.error = error.stack ?? String(error)
    result.lastState = state()
    await fs.mkdir(output, { recursive: true })
    await fs.writeFile(path.join(output, 'result.json'), JSON.stringify(result, null, 2))
    await host?.dispose()
    window?.destroy()
    app.exit(1)
  })
