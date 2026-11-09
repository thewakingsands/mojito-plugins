import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

export default defineConfig({
  base: './',
  build: {
    target: 'es2023',
    emptyOutDir: true,
    rolldownOptions: {
      preserveEntrySignatures: 'strict',
      input: {
        entry: fileURLToPath(new URL('./src/entry.ts', import.meta.url)),
        settings: fileURLToPath(new URL('./settings.html', import.meta.url)),
      },
      output: { entryFileNames: (chunk) => (chunk.name === 'entry' ? 'entry.mjs' : 'assets/[name]-[hash].js') },
    },
  },
})
