import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('.', import.meta.url))
const target = 'x86_64-pc-windows-msvc'
const result = spawnSync('cargo', ['build', '--release', '--target', target], { cwd: root, stdio: 'inherit' })
if (result.error || result.status !== 0) throw result.error ?? new Error('Native example build failed')
const build = process.env.CARGO_TARGET_DIR
  ? path.resolve(root, process.env.CARGO_TARGET_DIR)
  : path.join(root, 'target')
mkdirSync(path.join(root, 'dist'), { recursive: true })
copyFileSync(
  path.join(build, target, 'release/mojito_native_example.dll'),
  path.join(root, 'dist/mojito_native_example.dll'),
)
copyFileSync(path.join(root, 'plugin.json'), path.join(root, 'dist/plugin.json'))
