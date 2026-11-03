import { readFileSync } from 'node:fs'
import { storageLimits } from '@ffcafe/mojito-plugin-sdk'
import { manifest } from '@ffcafe/mojito-plugin-sdk/schema'
import { expect, it } from 'vitest'

it('asks the host for 2 GiB of storage and 16 MiB per file', () => {
  const parsed = manifest(JSON.parse(readFileSync(new URL('../plugin.json', import.meta.url), 'utf8')))
  expect(storageLimits(parsed)).toEqual({ totalBytes: 2147483648, fileBytes: 16777216 })
})
