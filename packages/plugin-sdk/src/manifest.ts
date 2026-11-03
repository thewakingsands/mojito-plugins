export interface Manifest {
  schemaVersion: 1
  id: string
  name: string
  version: string
  apiVersion: string
  entry: { kind: 'worker'; path: string } | { kind: 'native'; path: string; os: 'win32'; arch: 'x64'; abiVersion: 1 }
  capabilities: { required: string[]; optional: string[] }
  networkOrigins: string[]
  storage?: { totalBytes?: number; fileBytes?: number }
  services?: {
    provides?: { name: string; version: string; dataPermissions: string[] }[]
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
