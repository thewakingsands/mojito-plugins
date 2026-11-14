import { copyFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const root = fileURLToPath(new URL('.', import.meta.url))
const sdk = fileURLToPath(new URL('../../packages/plugin-sdk/src', import.meta.url))
export default defineConfig({
  root,
  base: './',
  resolve: {
    alias: [
      { find: '@ffcafe/mojito-plugin-sdk/view', replacement: path.join(sdk, 'view.ts') },
      { find: '@ffcafe/mojito-plugin-sdk', replacement: path.join(sdk, 'index.ts') },
    ],
  },
  build: {
    outDir: path.join(root, 'dist'),
    emptyOutDir: true,
    rolldownOptions: {
      preserveEntrySignatures: 'strict',
      input: { entry: path.join(root, 'entry.ts'), main: path.join(root, 'main.html') },
      output: { entryFileNames: (chunk) => (chunk.name === 'entry' ? 'entry.mjs' : 'assets/[name]-[hash].js') },
    },
  },
  plugins: [
    {
      name: 'plugin-manifest',
      apply: 'build',
      async closeBundle() {
        await copyFile(path.join(root, 'plugin.json'), path.join(root, 'dist/plugin.json'))
      },
    },
  ],
})
