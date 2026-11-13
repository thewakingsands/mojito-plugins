import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'
import { verifyTemplate } from '../../../scripts/overlay-templates/verify.mjs'

const directory = fileURLToPath(new URL('../', import.meta.url))
const result = spawnSync(
  process.execPath,
  [path.join(directory, '../../scripts/overlay-templates/build.mjs'), ...process.argv.slice(2)],
  {
    stdio: 'inherit',
  },
)
assert.equal(result.status, 0, 'Template build failed')
for (const name of [
  'kagerou',
  'skyline',
  'mopimopi2',
  'faceroll',
  'horizoverlay',
  'cmskin',
  'mopimopi1',
  'ikegami',
  'ember',
  'amethyst',
  'klondike',
  'glass',
]) {
  if (process.argv.length > 2 && !process.argv.slice(2).includes(name)) continue
  await build({
    configFile: false,
    root: directory,
    build: {
      outDir: `dist/${name}`,
      emptyOutDir: false,
      rolldownOptions: {
        input: path.join(directory, `src/${name}.ts`),
        preserveEntrySignatures: 'strict',
        output: { entryFileNames: 'entry.mjs', codeSplitting: false },
      },
    },
  })
  await verifyTemplate(path.join(directory, `dist/${name}`), name)
  await copyFile(path.join(directory, `plugins/${name}.json`), path.join(directory, `dist/${name}/plugin.json`))
}
