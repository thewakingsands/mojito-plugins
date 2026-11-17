import { spawnSync } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const output = path.join(root, 'packages/package/wasm')
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
  '--features',
  'codec',
])
await mkdir(output, { recursive: true })
run(process.env.WASM_BINDGEN ?? 'wasm-bindgen', [
  '--target',
  'web',
  '--out-dir',
  output,
  '--out-name',
  'package',
  path.resolve(root, process.env.CARGO_TARGET_DIR ?? 'target', 'wasm32-unknown-unknown/release/mojito_package.wasm'),
])
