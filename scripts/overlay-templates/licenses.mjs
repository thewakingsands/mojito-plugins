import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

export async function writeDependencyNotices(work, destination) {
  const directory = path.join(work, 'node_modules')
  const notices = new Map()
  for (const entry of await readdir(directory, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !/^(?:licen[cs]e|copying)(?:\.[\w-]+)?$/i.test(entry.name)) continue
    const file = path.join(entry.parentPath, entry.name)
    const text = await readFile(file, 'utf8')
    if (!text.trim()) continue
    const names = notices.get(text) ?? []
    names.push(path.relative(directory, file).replaceAll('\\', '/'))
    notices.set(text, names)
  }
  const text = [...notices]
    .map(([license, names]) => `${names.sort().join('\n')}\n\n${license}`)
    .sort()
    .join('\n\n--------------------\n\n')
  await writeFile(path.join(destination, 'THIRD-PARTY-LICENSES.txt'), text)
}
