import { copyFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const root = fileURLToPath(new URL('.', import.meta.url))
export default defineConfig({
  root,
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    license: { fileName: 'THIRD-PARTY-LICENSES.md' },
    rolldownOptions: {
      preserveEntrySignatures: 'strict',
      input: {
        entry: path.join(root, 'src/entry.ts'),
        index: path.join(root, 'index.html'),
      },
      output: { entryFileNames: (chunk) => (chunk.name === 'entry' ? 'entry.mjs' : 'assets/[name]-[hash].js') },
    },
  },
  plugins: [
    react(),
    {
      name: 'plugin-manifest',
      async closeBundle() {
        for (const file of ['plugin.json', 'SOURCES.md'])
          await copyFile(path.join(root, file), path.join(root, 'dist', file))
        const elpis = path.join(root, 'node_modules/@ffcafe/elpis-network')
        for (const file of ['LICENSE', 'FFXIVClientStructs.LICENSE'])
          await copyFile(path.join(elpis, file), path.join(root, 'dist', file))
      },
    },
  ],
})
