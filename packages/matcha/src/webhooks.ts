// Copyright (c) FFCafe. Licensed under AGPL-3.0-only.
import type { HttpOptions, HttpService, Json } from '@ffcafe/mojito-plugin-sdk'
import type { Webhook } from './settings.js'

/** The host still checks every target against manifest networkOrigins and public-address policy. */
export async function sendWebhook(
  http: HttpService,
  hook: Webhook,
  event: string,
  data: Json,
  signal: AbortSignal,
): Promise<void> {
  const options: HttpOptions = { signal, timeoutMs: 5000, credentials: 'omit', headers: { ...hook.headers } }
  let endpoint = hook.endpoint
  if (hook.type === 'GET') {
    const url = new URL(endpoint)
    url.searchParams.set('event', event)
    url.searchParams.set('data', JSON.stringify(data))
    endpoint = url.href
  } else {
    options.method = 'POST'
    if (hook.type === 'JSON') {
      options.headers!['Content-Type'] = 'application/json'
      options.body = JSON.stringify({ event, data })
    } else if (hook.type === 'FORM') {
      options.headers!['Content-Type'] = 'application/x-www-form-urlencoded'
      options.body = new URLSearchParams({ event, data: JSON.stringify(data) }).toString()
    } else {
      const boundary = `matcha-${crypto.randomUUID()}`
      options.headers!['Content-Type'] = `multipart/form-data; boundary=${boundary}`
      options.body = `${Object.entries({ event, data: JSON.stringify(data) })
        .map(([key, value]) => `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`)
        .join('')}--${boundary}--\r\n`
    }
  }
  const response = await http.request(endpoint, options)
  if (response.status < 200 || response.status >= 300) throw new Error(`Webhook HTTP ${response.status}`)
}
