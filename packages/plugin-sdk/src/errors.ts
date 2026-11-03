import type { ApiError } from './types.js'

export class PluginError extends Error implements ApiError {
  readonly code: ApiError['code']
  readonly retryable: boolean
  constructor(error: ApiError) {
    super(error.message)
    this.name = 'PluginError'
    this.code = error.code
    this.retryable = error.retryable
  }
  toJSON(): ApiError {
    return { code: this.code, message: this.message, retryable: this.retryable }
  }
}

export function pluginError(code: ApiError['code'], message: string = code): PluginError {
  return new PluginError({ code, message, retryable: false })
}

const codes = new Set<ApiError['code']>([
  'invalid_argument',
  'permission_denied',
  'unavailable',
  'not_found',
  'stale_session',
  'cancelled',
  'timeout',
  'quota_exceeded',
  'overflow',
  'source_incomplete',
  'incompatible_version',
  'plugin_stopped',
  'clock_reset',
  'internal',
])

export function apiError(input: unknown): ApiError {
  if (!input || typeof input !== 'object') throw new TypeError('Invalid API error')
  const value = input as Partial<ApiError>
  if (!codes.has(value.code!) || typeof value.message !== 'string' || typeof value.retryable !== 'boolean') {
    throw new TypeError('Invalid API error')
  }
  return { code: value.code!, message: value.message, retryable: value.retryable }
}
