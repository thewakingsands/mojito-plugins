import { createHash } from 'node:crypto'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

export async function extractEmberFonts(work) {
  const directory = path.join(work, 'build/static/css')
  for (const name of await readdir(directory)) {
    if (!name.endsWith('.css')) continue
    const file = path.join(directory, name)
    const fonts = new Map()
    const css = (await readFile(file, 'utf8')).replace(
      /data:application\/(x-font-ttf|font-woff|vnd\.ms-fontobject)(?:;charset=utf-8)?;base64,([A-Za-z0-9+/=]+)/g,
      (_, type, base64) => {
        const bytes = Buffer.from(base64, 'base64')
        const extension = { 'x-font-ttf': 'ttf', 'font-woff': 'woff', 'vnd.ms-fontobject': 'eot' }[type]
        const name = `font-${createHash('sha256').update(bytes).digest('hex').slice(0, 16)}.${extension}`
        fonts.set(name, bytes)
        return name
      },
    )
    for (const [name, bytes] of fonts) await writeFile(path.join(directory, name), bytes)
    await writeFile(file, css)
  }
}
