import { copyFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const hmr = process.env.MOJITO_DEV_HMR === '1'
const root = fileURLToPath(new URL('.', import.meta.url))
const sdk = fileURLToPath(new URL('../../packages/plugin-sdk/src', import.meta.url))
export default defineConfig(({ command }) => ({
  root,
  base: command === 'serve' ? '/dev/example-views/' : './',
  resolve: {
    alias: [
      { find: '@ffcafe/mojito-plugin-sdk/view', replacement: path.join(sdk, 'view.ts') },
      { find: '@ffcafe/mojito-plugin-sdk', replacement: path.join(sdk, 'index.ts') },
    ],
  },
  html: { cspNonce: '__MOJITO_DEV_NONCE__' },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    hmr,
    ws: hmr ? { host: '127.0.0.1', protocol: 'ws', clientPort: 5173 } : false,
  },
  build: {
    outDir: path.join(root, 'dist'),
    emptyOutDir: true,
    rolldownOptions: {
      preserveEntrySignatures: 'strict',
      input: {
        entry: path.join(root, 'entry.ts'),
        main: path.join(root, 'main.html'),
        home: path.join(root, 'home.html'),
        settings: path.join(root, 'settings.html'),
        details: path.join(root, 'details.html'),
        overlay: path.join(root, 'overlay.html'),
      },
      output: { entryFileNames: (chunk) => (chunk.name === 'entry' ? 'entry.mjs' : 'assets/[name]-[hash].js') },
    },
  },
  plugins: [
    {
      name: 'resource-only-pages',
      apply: 'serve',
      // Vite injects its client even with hmr/ws disabled. This sample needs only resources.
      transformIndexHtml: {
        order: 'post',
        handler(html) {
          if (hmr) return html
          return html.replace(/<script\b[^>]*src="[^" ]*\/@vite\/client"[^>]*><\/script>/g, '')
        },
      },
    },
    {
      name: 'plugin-manifest',
      apply: 'build',
      async closeBundle() {
        await copyFile(path.join(root, 'plugin.json'), path.join(root, 'dist/plugin.json'))
      },
    },
  ],
}))
