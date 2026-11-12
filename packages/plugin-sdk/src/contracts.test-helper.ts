// Compile-only public API examples, excluded from published files.
import type {
  EventsService,
  GameEvent,
  Json,
  Limits,
  Manifest,
  PacketsService,
  SessionSnapshot,
  Value,
} from './index.js'

export const worker = {
  schemaVersion: 1,
  id: 'CastNotice',
  name: 'Cast notice',
  version: '1.0.0',
  apiVersion: '^2.0.0',
  entry: { kind: 'worker', path: 'worker.js' },
  capabilities: ['events.read'],
  networkOrigins: [],
} satisfies Manifest

export const native = {
  ...worker,
  entry: { kind: 'native', path: 'plugin.dll', os: 'win32', arch: 'x64', abiVersion: 1 },
} satisfies Manifest

export function subscriptions(events: EventsService, packets: PacketsService) {
  events.subscribe('castStarted', ({ items }) => {
    const duration: number = items[0].value.data.durationMs
    void duration
    // @ts-expect-error duration has one public unit: milliseconds.
    void items[0].value.data.duration
  })
  packets.subscribe('ipc', () => {}, { directions: ['send', 'recv'], channels: ['zone'] })
  // @ts-expect-error Selector comes before the listener.
  packets.subscribe(() => {}, 'ipc')
  // @ts-expect-error Unknown public event names are not supported.
  events.subscribe('AbilityCastEvent', () => {})
}

export function narrow(event: GameEvent) {
  if (event.type === 'zoneChanged') {
    const territory: number = event.data.territoryTypeId
    return territory
  }
  if (event.type === 'statusChanged') return event.data.status?.durationMs
}

export function valuesAndLimits(session: SessionSnapshot, limits: Limits) {
  const contentId: bigint | null = session.character?.contentId ?? null
  const payload: Value = { contentId, bytes: Uint8Array.of(0, 255) }
  // @ts-expect-error JSON-only configuration must explicitly convert bigint.
  const config: Json = { contentId: 1n }
  // @ts-expect-error Limits are fixed for an activation.
  limits.values['batch.items'] = 100
  // @ts-expect-error The revision is read-only as well.
  limits.revision = 'changed'
  return { payload, config }
}

export async function activate(context: import('./index.js').PluginContext) {
  const cast = context.events.subscribe(
    'castStarted',
    ({ items }) => {
      for (const item of items) {
        context.log.info('cast', { actionId: item.value.data.actionId, durationMs: item.value.data.durationMs })
      }
    },
    { signal: context.signal },
  )
  await cast.ready
  const player = await context.game.getPlayer({ fields: ['contentId', 'classJob'] })
  if (player.value.contentId?.state === 'ok') {
    await context.config.set('saved-id', player.value.contentId.value.toString())
  }
  await context.http.request('https://example.invalid/report', {
    credentials: 'include',
    method: 'POST',
    body: 'synthetic',
  })
  const version: string | null = await context.data.version()
  void version
  await context.ui.setPreferenceItems([{ id: 'saved-id', title: 'Saved ID', description: '' }])
  await context.notifications.send({ title: 'synthetic' })
  const rows = await context.data.rows('Action', [1], 'none')
  for (const cell of rows[0].subrows[0].cells) {
    if (cell.type === 'bigint') {
      const v: bigint = cell.value
      void v
    }
  }
  // @ts-expect-error Unknown field names are rejected by the public SDK.
  await context.game.getPlayer({ fields: ['processHandle'] })
  // @ts-expect-error Raw file paths cannot be passed as a memory process selector.
  await context.memory.read({ pid: 100, ranges: [] })
  return () => cast.dispose()
}

export function settingsPage(view: import('./view.js').ViewBridge) {
  const stop = view.on('navigate-to-preference-item', ({ id, keyword }) => {
    const target: string = id
    void [target, keyword.length]
  })
  // @ts-expect-error Pages listen only to the events the host sends.
  view.on('preferenceItem', () => {})
  stop()
}
