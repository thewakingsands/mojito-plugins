import { copyFile, cp, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const root = fileURLToPath(new URL('.', import.meta.url))
const generated = path.join(root, 'src/generated')
const output = path.join(root, 'dist')
export default defineConfig({
  root,
  base: './',
  resolve: { alias: { 'deep-dungeon:catalog': path.join(generated, 'catalog.json') } },
  build: {
    outDir: output,
    emptyOutDir: true,
    rolldownOptions: {
      preserveEntrySignatures: 'strict',
      input: Object.fromEntries([
        ['entry', path.join(root, 'src/entry.ts')],
        ...['overlay', 'reference', 'settings'].map((name) => [name, path.join(root, `${name}.html`)]),
      ]),
      output: { entryFileNames: (chunk) => (chunk.name === 'entry' ? 'entry.mjs' : 'assets/[name]-[hash].js') },
    },
  },
  plugins: [
    {
      name: 'deep-dungeon-data',
      async writeBundle() {
        await copyFile(path.join(root, 'plugin.json'), path.join(output, 'plugin.json'))
        await cp(path.join(root, 'licenses'), path.join(output, 'licenses'), { recursive: true })
        for (const name of await readdir(generated)) {
          if (name === 'monsterdex-source.json' || name === 'catalog.json' || name.startsWith('MonsterDex-data-'))
            await copyFile(path.join(generated, name), path.join(output, name))
        }
      },
    },
  ],
})
