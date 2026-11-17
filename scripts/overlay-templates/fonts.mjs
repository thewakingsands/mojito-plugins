import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

const urls = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)(?:\s*format\([^)]*\))?/g
const reference = (match) => match[1] ?? match[2] ?? match[3]

export async function copyFont(source, destination, weights) {
  await mkdir(destination, { recursive: true })
  await cp(path.join(source, 'LICENSE'), path.join(destination, 'LICENSE'))
  for (const weight of weights) {
    const name = `${weight}.css`
    const css = await readFile(path.join(source, name), 'utf8')
    await writeFile(path.join(destination, name), css)
    for (const match of css.matchAll(urls)) {
      const file = reference(match)
      await mkdir(path.dirname(path.join(destination, file)), { recursive: true })
      await cp(path.join(source, file), path.join(destination, file))
    }
  }
}

// Keep standalone fonts; only discard a format when the same face supplies WOFF2.
export async function pruneFonts(directory) {
  const styles = []
  async function visit(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const file = path.join(current, entry.name)
      if (entry.isDirectory()) await visit(file)
      else if (entry.isFile() && file.endsWith('.css')) styles.push(file)
    }
  }
  await visit(directory)
  const obsolete = new Set(),
    retained = new Set()
  function local(file, url) {
    if (/^(?:[a-z]+:|\/\/)/i.test(url)) return null
    const name = decodeURIComponent(url.split(/[?#]/)[0])
    const target = name.startsWith('/plugin/')
      ? path.join(directory, name.slice(8))
      : path.resolve(path.dirname(file), name)
    const relative = path.relative(directory, target)
    return relative.startsWith('..') || path.isAbsolute(relative) ? null : target
  }
  for (const file of styles) {
    const css = (await readFile(file, 'utf8')).replace(/@font-face\s*\{[^}]*\}/gi, (face) => {
      const matches = [...face.matchAll(urls)]
      const preferred = matches.find((match) => /\.woff2(?:[?#]|$)|format\(['"]?woff2['"]?\)/i.test(match[0]))
      if (!preferred) return face
      return face.replace(urls, (...args) => {
        const match = args.slice(0, 4)
        if (match[0] === preferred[0]) return match[0]
        const target = local(file, reference(match))
        if (target) obsolete.add(target)
        return preferred[0]
      })
    })
    for (const match of css.matchAll(urls)) {
      const target = local(file, reference(match))
      if (target) retained.add(target)
    }
    await writeFile(file, css)
  }
  for (const file of obsolete) if (!retained.has(file)) await rm(file, { force: true })
}
