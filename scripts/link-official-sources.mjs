import { readFile, writeFile } from 'node:fs/promises'
import { officialNativePlugins } from './official-plugins.mjs'
import { gitRevision, pluginRepository } from './source-links.mjs'

const root = new URL('../', import.meta.url)
const revision = gitRevision(root)
for (const [, directory] of officialNativePlugins) {
  const file = new URL(`${directory}/dist/plugin.json`, root)
  const manifest = JSON.parse(await readFile(file, 'utf8'))
  manifest.homepage = `${pluginRepository}/tree/${revision}/${directory}`
  await writeFile(file, `${JSON.stringify(manifest, null, 2)}\n`)
}
