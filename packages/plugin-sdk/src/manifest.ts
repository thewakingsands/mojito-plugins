export interface Manifest {
  schemaVersion: 1
  id: string
  name: string
  version: string
  apiVersion: string
  entry: { kind: 'worker'; path: string } | { kind: 'native'; path: string; os: 'win32'; arch: 'x64'; abiVersion: 1 }
  /** The ordinary and sensitive capabilities the plugin uses */
  capabilities: string[]
  /** http: or https: origins the worker may request and its pages may load from */
  networkOrigins: string[]
  storage?: { totalBytes?: number; fileBytes?: number }
  services?: {
    /** name describes the function only; the host adds the plugin ID, so the full name is `pluginId/name` */
    provides?: { name: string; version: string }[]
    /** The full name `pluginId/name` of each service used */
    consumes?: { name: string; versionRange: string; optional: boolean }[]
  }
  /** Speech channels for `tts.say`; `default` always exists, and naming it here only gives it a name */
  tts?: { channels: { id: string; name: string }[] }
  author?: string
  description?: string
  homepage?: string
  license?: string
}

export const defaultStorageLimits = Object.freeze({ totalBytes: 32 * 1024 * 1024, fileBytes: 3 * 1024 * 1024 })

export function storageLimits(manifest: Pick<Manifest, 'storage'>) {
  return {
    totalBytes: manifest.storage?.totalBytes ?? defaultStorageLimits.totalBytes,
    fileBytes: manifest.storage?.fileBytes ?? defaultStorageLimits.fileBytes,
  }
}

/** The speech channels of a plugin with `tts.say`: those declared, with `default` first unless it is named among them */
export function ttsChannels(manifest: Pick<Manifest, 'tts'>): { id: string; name: string }[] {
  const declared = manifest.tts?.channels ?? []
  return declared.some((channel) => channel.id === 'default')
    ? declared.map((channel) => ({ ...channel }))
    : [{ id: 'default', name: '默认' }, ...declared.map((channel) => ({ ...channel }))]
}
