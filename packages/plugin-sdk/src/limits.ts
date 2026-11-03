/** Known policy keys, not fixed resource budgets. New minor versions may add keys. */
export const limitNames = Object.freeze([
  'transport.messageBytes',
  'transport.maxDepth',
  'transport.collectionItems',
  'queue.pluginItems',
  'queue.pluginBytes',
  'queue.hostItems',
  'queue.hostBytes',
  'queue.controlItems',
  'queue.controlBytes',
  'batch.items',
  'batch.bytes',
  'batch.waitMs',
  'requests.pluginConcurrent',
  'requests.hostConcurrent',
  'subscriptions.pluginCount',
  'subscriptions.hostCount',
  'game.entities',
  'game.filterItems',
  'game.watchMinMs',
  'game.watchMaxMs',
  'game.watchDefaultMs',
  'memory.readRanges',
  'memory.readRangeBytes',
  'memory.readTotalBytes',
  'memory.matches',
  'memory.watchMinMs',
  'memory.watchMaxMs',
  'memory.watchDefaultMs',
  'memory.pluginScans',
  'memory.pluginBytesPerSecond',
  'memory.pluginWatchRanges',
  'data.rowIds',
  'views.valueBytes',
  'views.snapshotPluginBytes',
  'views.snapshotHostBytes',
  'views.snapshotPluginChannels',
  'views.snapshotHostChannels',
  'views.commandPluginHandlers',
  'views.commandHostHandlers',
  'ui.pluginRegistrations',
  'ui.hostRegistrations',
  'ui.preferenceItems',
  'ui.preferenceTitleChars',
  'ui.preferenceDescriptionChars',
  'registrations.pluginBytes',
  'registrations.hostBytes',
  'audio.textChars',
  'audio.pendingItems',
  'http.requestBytes',
  'http.responseBytes',
  'http.timeoutDefaultMs',
  'http.timeoutMaxMs',
  'http.redirects',
  'http.pluginConcurrent',
  'http.hostConcurrent',
  'http.cookieBytes',
  'http.cookieOriginItems',
  'http.cookieOriginBytes',
  'http.cookiePluginBytes',
  'files.bytes',
  'files.tokenTtlMs',
  'files.pendingItems',
  'files.promptTimeoutMs',
  'config.valueBytes',
  'config.pluginBytes',
  'storage.fileBytes',
  'storage.pluginBytes',
  'storage.listItems',
  'log.messageChars',
  'log.fieldsBytes',
  'log.itemsPerSecond',
  'clock.timers',
  'clock.replayBackwardResetMs',
] as const)

export type LimitName = (typeof limitNames)[number]
export type Limits = Readonly<{
  schemaVersion: 1
  revision: string
  values: Readonly<Record<LimitName, number> & Record<string, number>>
}>

function record(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/** Copy and freeze one activation's host policy; never silently supply missing budgets. */
export function limitsSnapshot(input: unknown): Limits {
  if (!record(input) || input.schemaVersion !== 1 || typeof input.revision !== 'string') {
    throw new TypeError('Invalid limits snapshot')
  }
  const values = input.values
  if (!record(values)) throw new TypeError('Invalid limits values')
  for (const name of limitNames) {
    if (!Object.hasOwn(values, name)) throw new TypeError(`Missing limit: ${name}`)
  }
  // A null prototype also preserves future keys such as "__proto__" as ordinary data.
  const copy: Record<string, number> = Object.create(null)
  for (const [name, value] of Object.entries(values)) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw new TypeError(`Invalid limit: ${name}`)
    }
    copy[name] = value
  }
  return Object.freeze({ schemaVersion: 1, revision: input.revision, values: Object.freeze(copy) }) as Limits
}
