import type { StorageService } from '@ffcafe/mojito-plugin-sdk'
import { gunzipSync } from 'fflate'
import { parquetReadObjects } from 'hyparquet'

/** In-memory plugin storage; each queued failure decides the outcome of one write. */
export function memoryStorage() {
  const files = new Map<string, Uint8Array>()
  const failures: ((path: string) => unknown)[] = []
  const storage: StorageService = {
    read: async (path) => {
      const file = files.get(path)
      if (!file) throw { code: 'not_found' }
      return file
    },
    write: async (path, bytes) => {
      const failure = failures.shift()?.(path)
      if (failure) throw failure
      files.set(path, bytes.slice())
    },
    delete: async (path) => {
      files.delete(path)
    },
    list: async (path) => [...files.keys()].filter((name) => name.startsWith(`${path}/`)).sort(),
  }
  return { storage, files, failures }
}
export async function fileRows(bytes: Uint8Array) {
  return parquetReadObjects({ file: bytes.slice().buffer, compressors: { GZIP: (input) => gunzipSync(input) } })
}
