export function selectedDirectory(fileList) {
  const files = Array.from(fileList)
  const name = files[0]?.webkitRelativePath.split('/')[0] ?? ''
  return {
    name,
    files: files.map((file) => ({ path: file.webkitRelativePath.slice(name.length + 1), file })),
  }
}

export async function droppedDirectory(entry) {
  const files = []
  async function collect(directory, prefix) {
    const reader = directory.createReader()
    while (true) {
      const entries = await new Promise((resolve, reject) => reader.readEntries(resolve, reject))
      if (entries.length === 0) break
      for (const child of entries) {
        const path = `${prefix}${child.name}`
        if (child.isDirectory) await collect(child, `${path}/`)
        else files.push({ path, file: await new Promise((resolve, reject) => child.file(resolve, reject)) })
      }
    }
  }
  await collect(entry, '')
  return { name: entry.name, files }
}
