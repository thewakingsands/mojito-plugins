/**
 * The values the host tells a plugin: the message encoding range, the event flow control, the polling interval ranges
 * and the storage budget the plugin declares for itself. New minor versions may add keys.
 */
export const limitNames = Object.freeze([
  'transport.messageBytes',
  'transport.maxDepth',
  'transport.collectionItems',
  'queue.pluginItems',
  'queue.pluginBytes',
  'batch.items',
  'batch.bytes',
  'batch.waitMs',
  'game.watchMinMs',
  'game.watchMaxMs',
  'game.watchDefaultMs',
  'memory.watchMinMs',
  'memory.watchMaxMs',
  'memory.watchDefaultMs',
  'storage.fileBytes',
  'storage.pluginBytes',
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
