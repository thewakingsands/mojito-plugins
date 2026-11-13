import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

test('ngld subscriptions wait for readiness and deliver partial, zero and terminal frames unchanged', async () => {
  let tick
  const requests = []
  const window = {
    addEventListener() {},
    OverlayPluginApi: {
      ready: false,
      callHandler(raw, callback) {
        requests.push(JSON.parse(raw))
        callback('{"error":"unsupported_event","accepted":["CombatData"],"unsupported":["PartyChanged"]}')
      },
    },
  }
  vm.runInNewContext(await readFile(new URL('./ngld.js', import.meta.url), 'utf8'), {
    window,
    setInterval(fn) {
      tick = fn
      return 1
    },
    clearInterval() {},
  })
  const seen = []
  const receive = (frame) => seen.push(frame)
  window.addOverlayListener('CombatData', receive)
  window.addOverlayListener('PartyChanged', () => {})
  window.startOverlayEvents()
  tick()
  await Promise.resolve()
  assert.equal(requests.length, 0)
  window.OverlayPluginApi.ready = true
  tick()
  await Promise.resolve()
  assert.deepEqual(requests[0], { call: 'subscribe', events: ['CombatData', 'PartyChanged'] })
  for (const frame of [
    { type: 'CombatData', isActive: 'true', Encounter: { DURATION: '0' } },
    { type: 'CombatData', isActive: 'false', Encounter: { DURATION: '8.125', enchps: '0' } },
    { type: 'CombatData', isActive: 'false', Encounter: { DURATION: '8.125', encdps: '166.15384615384616' } },
  ]) {
    window.__OverlayCallback(frame)
    assert.equal(seen.at(-1), frame)
  }
  window.removeOverlayListener('CombatData', receive)
  await Promise.resolve()
  assert.deepEqual(requests.at(-1), { call: 'unsubscribe', events: ['CombatData'] })
  window.__OverlayCallback({ type: 'CombatData' })
  assert.equal(seen.length, 3)
})
