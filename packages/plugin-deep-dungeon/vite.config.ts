import { access, copyFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const root = fileURLToPath(new URL('.', import.meta.url))
export default defineConfig(({ mode }) => {
  const fixture = mode === 'fixture'
  return {
    root,
    base: './',
    resolve: {
      alias: {
        'deep-dungeon:catalog': path.join(root, fixture ? 'fixtures/catalog.ts' : 'src/generated/catalog.json'),
        ...(fixture ? { '@ffcafe/mojito-plugin-sdk/view': path.join(root, 'fixtures/bridge.ts') } : {}),
      },
    },
    build: {
      outDir: fixture ? 'dist-fixture' : 'dist',
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
        async buildStart() {
          if (!fixture) {
            await access(path.join(root, 'src/generated/catalog.json')).catch(() => {
              throw new Error('Verified catalog is required. Use build:fixture only for synthetic development checks.')
            })
          }
        },
        async writeBundle() {
          // Synthetic output is a development source, never an official package input.
          await copyFile(
            path.join(root, fixture ? 'fixtures/plugin.json' : 'plugin.json'),
            path.join(root, fixture ? 'dist-fixture/plugin.json' : 'dist/plugin.json'),
          )
        },
      },
    ],
  }
})
