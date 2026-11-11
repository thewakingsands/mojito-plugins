import { parse as parseVersion, satisfies, validRange } from 'semver'
import { defaultStorageLimits, type Manifest, storageLimits } from './manifest.js'
import { ordinaryCapabilities, sensitiveCapabilities } from './types.js'

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
  check(/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(s) && !s.endsWith('.'), 'Invalid plugin ID')
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
  check(canonical === s && !/[^A-Za-z0-9.+-]/.test(s), 'Invalid version')
  return s
}
export function range(value: unknown): string {
  const s = text(value)
  check(validRange(s) !== null, 'Invalid API range')
  return s
}
/** The plugin API this host implements; manifests and catalog releases declare a range that must include it */
export const pluginApiVersion = '2.0.0'
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
/** An http: or https: origin with nothing after it, as networkOrigins lists them */
export function networkOrigin(value: unknown): string {
  const s = text(value)
  const url = new URL(s)
  check(
    (url.protocol === 'https:' || url.protocol === 'http:') && url.origin === s,
    'Network origin must be a canonical http: or https: origin',
  )
  return s
}
const capabilityNames = new Set<string>([...ordinaryCapabilities, ...sensitiveCapabilities])
/** A capability the host knows; others mean the plugin was built for an older plugin API */
export function capability(value: unknown): string {
  const s = text(value)
  check(capabilityNames.has(s), `插件声明了不存在的权限 ${s}，请按 Plugin API ${pluginApiVersion} 重新构建`)
  return s
}
const serviceName = /^[a-z0-9]+([._-][a-z0-9]+)*$/
/** The name a provider gives its service: what it does, without the plugin ID */
export function localServiceName(value: unknown): string {
  const s = text(value)
  check(serviceName.test(s), 'Invalid service name')
  return s
}
/** A service as consumers name it: the provider's plugin ID, a slash and its local name */
export function serviceId(value: unknown): { pluginId: string; name: string } {
  const s = text(value)
  const slash = s.indexOf('/')
  check(slash > 0, 'Service names are written as pluginId/name')
  return { pluginId: id(s.slice(0, slash)), name: localServiceName(s.slice(slash + 1)) }
}
function strings(value: unknown): string[] {
  check(Array.isArray(value), 'Expected string array')
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
  check(Array.isArray(o.capabilities), 'Expected capability list')
  const capabilities = o.capabilities.map(capability)
  check(new Set(capabilities).size === capabilities.length, 'Duplicate capability')
  strings(o.networkOrigins).forEach(networkOrigin)
  if (o.services !== undefined) {
    const services = object(o.services)
    fields(services, ['provides', 'consumes'], [])
    for (const kind of ['provides', 'consumes']) {
      if (services[kind] === undefined) continue
      check(Array.isArray(services[kind]), 'Invalid service list')
      for (const item of services[kind]) {
        const service = object(item)
        if (kind === 'provides') {
          fields(service, ['name', 'version'])
          localServiceName(service.name)
          version(service.version)
        } else {
          serviceId(service.name)
          fields(service, ['name', 'versionRange', 'optional'])
          range(service.versionRange)
          check(typeof service.optional === 'boolean', 'Invalid optional flag')
        }
      }
    }
  }
  return o as unknown as Manifest
}
