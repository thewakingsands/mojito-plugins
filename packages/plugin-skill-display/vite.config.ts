import { copyFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const root = fileURLToPath(new URL('.', import.meta.url))
export default defineConfig({
  root,
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rolldownOptions: {
      preserveEntrySignatures: 'strict',
      input: {
        entry: path.join(root, 'src/entry.ts'),
        settings: path.join(root, 'settings.html'),
        overlay: path.join(root, 'overlay.html'),
      },
      output: { entryFileNames: (chunk) => (chunk.name === 'entry' ? 'entry.mjs' : 'assets/[name]-[hash].js') },
    },
  },
  plugins: [
    {
      name: 'plugin-manifest',
      async closeBundle() {
        await copyFile(path.join(root, 'plugin.json'), path.join(root, 'dist/plugin.json'))
      },
    },
  ],
})
