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
