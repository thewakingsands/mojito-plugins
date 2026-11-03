// @vitest-environment jsdom
import { expect, it, vi } from 'vitest'
import type { Catalog, State } from './state'

const listeners: Record<string, (batch: { items: unknown[] }) => void> = {}
const snapshots: Record<string, unknown> = {}
vi.mock('@ffcafe/mojito-plugin-sdk/view', () => ({
  connectView: async () => ({
    subscribe: (channel: string, fn: (batch: { items: unknown[] }) => void) => {
      listeners[channel] = fn
      return { ready: Promise.resolve() }
    },
    snapshot: async (channel: string) => snapshots[channel],
    command: async () => 1,
  }),
}))

const catalog = (revision: number, ids: string[]): Catalog => ({
  revision,
  definitions: ids.map((triggerId) => ({ setId: 'p1n', triggerId, path: 'p1n.ts', original: '{}' })),
  configurations: [],
})
const state = (catalogRevision: number, matches: number): State =>
  ({
    generation: 1,
    revision: catalogRevision * 100 + matches,
    configRevision: 0,
    upstreamCommit: 'fixture',
    settings: { language: 'cn', audio: 'none', rules: {} },
    zone: 1,
    diagnostics: [{ setId: 'p1n', triggerId: 'a', state: 'ready', reason: '', matches }],
    alerts: [],
    bars: [],
    catalogRevision,
    sharedDataWarning: false,
    sourceError: null,
    moduleFault: null,
    audioGranted: true,
    clock: { now: 0, generation: 1, base: 'packet-unix', source: 'replay', paused: false },
  }) as unknown as State

it('renders rules from the catalog channel and updates diagnostics in place', async () => {
  document.body.innerHTML = '<div id="app"></div>'
  snapshots['raidboss-catalog'] = catalog(1, ['a'])
  snapshots.raidboss = state(1, 2)
  await import('./manage')
  const rows = () => [...document.querySelectorAll('details summary')].map((row) => row.firstChild?.textContent)
  const status = () => document.querySelector('.rule-status')!
  expect(rows()).toEqual(['a'])
  expect(status().textContent).toBe('就绪 · 2 次')

  const row = document.querySelector('details')
  listeners.raidboss!({ items: [state(1, 3)] })
  expect(status().textContent).toBe('就绪 · 3 次')
  expect(document.querySelector('details')).toBe(row)

  // A state naming a newer catalog waits for that catalog before redrawing.
  listeners.raidboss!({ items: [state(2, 0)] })
  expect(rows()).toEqual(['a'])
  listeners['raidboss-catalog']!({ items: [catalog(2, ['a', 'b'])] })
  expect(rows()).toEqual(['a', 'b'])
})
