import { spawnSync } from 'node:child_process'
import { cp, mkdir } from 'node:fs/promises'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' })
  if (result.error || result.status) throw result.error ?? new Error(`${command} failed (${result.status})`)
}
run('pnpm', ['--filter', '@ffcafe/mojito-package', 'build'])
const output = path.join(root, 'dist/package-web')
await mkdir(output, { recursive: true })
for (const directory of ['dist', 'wasm']) {
  await cp(path.join(root, 'packages/package', directory), path.join(output, 'tool', directory), { recursive: true })
}
await cp(path.join(root, 'crates/package/web'), output, { recursive: true })
