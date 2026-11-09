import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const dist = path.join(root, 'dist')
const manifest = JSON.parse(await readFile(path.join(root, 'plugin.json'), 'utf8'))
for (const arg of process.argv.slice(2)) {
  if (!arg.startsWith('--origin=')) throw new Error('Supported option: --origin=https://your-webhook.example')
  const url = new URL(arg.slice('--origin='.length))
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash)
    throw new Error('Expected a canonical HTTPS origin')
  manifest.networkOrigins.push(url.origin)
}
manifest.networkOrigins = [...new Set(manifest.networkOrigins)].sort()
await mkdir(dist, { recursive: true })
await rm(path.join(dist, 'ui'), { recursive: true, force: true })
await cp(path.join(root, '../../vendor/matcha-overlay/dist-mojito'), path.join(dist, 'ui'), { recursive: true })
await cp(path.join(root, 'LICENSE'), path.join(dist, 'LICENSE'))
await writeFile(path.join(dist, 'plugin.json'), `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`Staged plugin directory: ${dist}`)
console.log('Sign with: mojito-package pack DIRECTORY PRIVATE_JWK OUTPUT lzma2')
