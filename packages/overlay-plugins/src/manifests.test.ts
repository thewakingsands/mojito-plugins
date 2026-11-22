import { readdirSync, readFileSync } from 'node:fs'
import { manifest } from '@ffcafe/mojito-plugin-sdk/schema'
import { expect, it } from 'vitest'

const directory = new URL('../plugins/', import.meta.url)
const plugins = readdirSync(directory)
  .filter((name) => name.endsWith('.json'))
  .map((name) => ({
    name,
    source: JSON.parse(readFileSync(new URL(name, directory), 'utf8')),
  }))
it.each(plugins)('$name declares a valid consumer of the statistics service', ({ source }) => {
  const plugin = manifest(source)
  expect(plugin.apiVersion).toBe(plugin.id === 'ffcafe.overlay-ember' ? '^2.6.0' : '^2.0.0')
  expect(plugin.capabilities).toContain('identity.read')
  expect(plugin.capabilities.includes('tts.say')).toBe(plugin.id === 'ffcafe.overlay-ember')
  expect(plugin.services?.consumes).toEqual([
    { name: 'ffcafe.combat-statistics/overlay', versionRange: '^1.0.0', optional: false },
  ])
})
