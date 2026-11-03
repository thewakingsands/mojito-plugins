import { copyFile, mkdir, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
async function copy(directory) {
  for (const entry of await readdir(path.join(root, directory), { withFileTypes: true })) {
    const relative = path.join(directory, entry.name)
    if (entry.isDirectory()) await copy(relative)
    else if (entry.isFile() && entry.name.endsWith('.d.ts')) {
      const output = path.join(root, 'dist', relative)
      await mkdir(path.dirname(output), { recursive: true })
      await copyFile(path.join(root, relative), output)
    }
  }
}
await copy('vendor')
