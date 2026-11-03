import { spawnSync } from 'node:child_process'
import { cp, mkdir } from 'node:fs/promises'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' })
  if (result.error || result.status) throw result.error ?? new Error(`${command} failed (${result.status})`)
}
run('cargo', [
  'build',
  '--locked',
  '--release',
  '--package',
  'mojito-package',
  '--lib',
  '--target',
  'wasm32-unknown-unknown',
  '--no-default-features',
])
const output = path.join(root, 'dist/package-web')
await mkdir(output, { recursive: true })
run(process.env.WASM_BINDGEN ?? 'wasm-bindgen', [
  '--target',
  'web',
  '--out-dir',
  path.join(output, 'pkg'),
  '--out-name',
  'package',
  path.join(root, 'target/wasm32-unknown-unknown/release/mojito_package.wasm'),
])
await cp(path.join(root, 'crates/package/web'), output, { recursive: true })
