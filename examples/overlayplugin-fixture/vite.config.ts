import { copyFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const root = fileURLToPath(new URL('.', import.meta.url))
const output = path.join(root, '../../.tmp/overlayplugin-fixture')
export default defineConfig({
  root,
  base: './',
  resolve: { alias: { '@ffcafe/mojito-plugin-sdk': path.join(root, '../../packages/plugin-sdk/dist') } },
  build: {
    outDir: output,
    emptyOutDir: true,
    rolldownOptions: {
      preserveEntrySignatures: 'strict',
      input: { entry: path.join(root, 'entry.ts'), control: path.join(root, 'control.html') },
      output: { entryFileNames: (chunk) => (chunk.name === 'entry' ? 'entry.mjs' : 'assets/[name]-[hash].js') },
    },
  },
  plugins: [
    {
      name: 'fixture-manifest',
      async closeBundle() {
        await copyFile(path.join(root, 'plugin.json'), path.join(output, 'plugin.json'))
      },
    },
  ],
})
