import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const apiKey = process.env.MATCHA_UNIVERSALIS_API_KEY?.trim()
const uploaderId = process.env.MATCHA_UNIVERSALIS_UPLOADER_ID?.trim()

export default defineConfig({
  base: './',
  define: {
    // Universalis is off in builds without both values; see src/build-config.ts
    __MATCHA_UNIVERSALIS__: JSON.stringify(apiKey && uploaderId ? { apiKey, uploaderId } : null),
  },
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
