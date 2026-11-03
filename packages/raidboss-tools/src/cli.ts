import { readFile, writeFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { buildCommunity } from './build.js'

const { values } = parseArgs({
  options: {
    key: { type: 'string' },
    id: { type: 'string' },
    name: { type: 'string' },
    version: { type: 'string' },
    out: { type: 'string' },
    entry: { type: 'string', multiple: true },
    timeline: { type: 'string', multiple: true },
  },
})
if (!values.key || !values.id || !values.name || !values.version || !values.out || !values.entry?.length) {
  throw new Error(
    'Usage: --key private-key.json --id StablePluginId --name Name --version 1.0.0 --entry rule.ts [--entry another.js] [--timeline file.txt] --out plugin.mojito',
  )
}
await writeFile(
  values.out,
  await buildCommunity({
    privateJwk: await readFile(values.key, 'utf8'),
    id: values.id,
    name: values.name,
    version: values.version,
    entries: values.entry,
    timelines: values.timeline,
  }),
)
process.stdout.write(`Wrote ${values.out}\n`)
