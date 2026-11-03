import { parse as parseVersion, satisfies, validRange } from 'semver'
import { defaultStorageLimits, type Manifest, storageLimits } from './manifest.js'

export function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}
export function object(value: unknown): Record<string, unknown> {
  check(value !== null && typeof value === 'object' && !Array.isArray(value), 'Expected object')
  return value as Record<string, unknown>
}
export function fields(value: Record<string, unknown>, allowed: string[], required = allowed) {
  check(
    Object.keys(value).every((key) => allowed.includes(key)),
    'Unknown field',
  )
  check(
    required.every((key) => Object.hasOwn(value, key)),
    'Missing field',
  )
}
export function text(value: unknown): string {
  check(typeof value === 'string' && value.length > 0, 'Expected nonempty string')
  return value
}
export function id(value: unknown): string {
  const s = text(value)
  check(
    /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(s) && !/[^A-Za-z0-9._-]/.test(s) && !s.endsWith('.'),
    'Invalid plugin ID',
  )
  check(!device(s), 'Windows reserved device name')
  return s
}
function device(s: string) {
  return /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])$/i.test(s.split('.')[0])
}
export function resourcePath(value: unknown): string {
  const s = text(value)
  // biome-ignore lint/suspicious/noControlCharactersInRegex: Archive paths must reject Windows control characters.
  check(s.length <= 240 && !/[\\:\x00-\x1f<>"|?*]/.test(s), 'Invalid package path')
  check(
    s.split('/').every((p) => p && p !== '.' && p !== '..' && !/[. ]$/.test(p) && !device(p)),
    'Invalid package segment',
  )
  return s
}
export function version(value: unknown): string {
  const s = text(value)
  const parsed = parseVersion(s)
  const canonical = parsed ? parsed.version + (parsed.build.length ? `+${parsed.build.join('.')}` : '') : null
  check(s.length <= 80 && canonical === s && !/[^A-Za-z0-9.+-]/.test(s), 'Invalid version')
  return s
}
export function range(value: unknown): string {
  const s = text(value)
  check(s.length <= 256 && validRange(s) !== null, 'Invalid API range')
  return s
}
/** The plugin API this host implements; manifests and catalog releases declare a range that must include it */
export const pluginApiVersion = '1.7.0'
export function supportsApiVersion(value: string): boolean {
  return satisfies(pluginApiVersion, range(value))
}
export function httpsUrl(value: unknown): string {
  const s = text(value)
  const url = new URL(s)
  check(
    url.protocol === 'https:' && !url.username && !url.password && !s.includes('#'),
    'Expected HTTPS URL without credentials or fragment',
  )
  return url.href
}
function strings(value: unknown): string[] {
  check(Array.isArray(value) && value.length <= 256, 'Expected bounded string array')
  return value.map(text)
}

export type { Manifest } from './manifest.js'
export function manifest(input: unknown): Manifest {
  const o = object(input)
  const required = ['schemaVersion', 'id', 'name', 'version', 'apiVersion', 'entry', 'capabilities', 'networkOrigins']
  fields(o, [...required, 'storage', 'services', 'author', 'description', 'homepage', 'license'], required)
  check(o.schemaVersion === 1, 'Unsupported manifest schema')
  id(o.id)
  text(o.name)
  version(o.version)
  range(o.apiVersion)
  for (const key of ['author', 'description', 'homepage', 'license']) if (o[key] !== undefined) text(o[key])
  const entry = object(o.entry)
  const path = resourcePath(entry.path)
  if (entry.kind === 'worker') {
    fields(entry, ['kind', 'path'])
    check(/\.(mjs|js)$/.test(path), 'Worker entry must be browser JavaScript')
  } else {
    fields(entry, ['kind', 'path', 'os', 'arch', 'abiVersion'])
    check(
      entry.kind === 'native' &&
        entry.os === 'win32' &&
        entry.arch === 'x64' &&
        entry.abiVersion === 1 &&
        /\.dll$/i.test(path),
      'Unsupported native entry',
    )
  }
  if (o.storage !== undefined) {
    const storage = object(o.storage)
    fields(storage, ['totalBytes', 'fileBytes'], [])
    for (const name of ['totalBytes', 'fileBytes'] as const) {
      const value = storage[name]
      if (value !== undefined)
        check(
          typeof value === 'number' && Number.isSafeInteger(value) && value >= defaultStorageLimits[name],
          'Invalid storage limit',
        )
    }
  }
  const storage = storageLimits(o as unknown as Manifest)
  check(storage.fileBytes <= storage.totalBytes, 'Storage file limit exceeds total limit')
  check(
    entry.kind !== 'native' || storage.fileBytes <= defaultStorageLimits.fileBytes,
    'Native storage file limit exceeded',
  )
  const capabilities = object(o.capabilities)
  fields(capabilities, ['required', 'optional'])
  strings(capabilities.required)
  strings(capabilities.optional)
  for (const origin of strings(o.networkOrigins)) {
    const url = new URL(httpsUrl(origin))
    check(url.origin === origin, 'Network origin must be canonical HTTPS origin')
  }
  if (o.services !== undefined) {
    const services = object(o.services)
    fields(services, ['provides', 'consumes'], [])
    for (const kind of ['provides', 'consumes']) {
      if (services[kind] === undefined) continue
      check(Array.isArray(services[kind]) && services[kind].length <= 256, 'Invalid service list')
      for (const item of services[kind]) {
        const service = object(item)
        check(
          /^[a-z0-9]+([._-][a-z0-9]+)*$/.test(text(service.name)) &&
            !/[^a-z0-9._-]/.test(text(service.name)) &&
            text(service.name).length <= 128,
          'Invalid service name',
        )
        if (kind === 'provides') {
          fields(service, ['name', 'version', 'dataPermissions'])
          version(service.version)
          strings(service.dataPermissions)
        } else {
          fields(service, ['name', 'versionRange', 'optional'])
          range(service.versionRange)
          check(typeof service.optional === 'boolean', 'Invalid optional flag')
        }
      }
    }
  }
  return o as unknown as Manifest
}
