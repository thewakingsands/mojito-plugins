import { createHash } from 'node:crypto'
import { readdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

// Preserve every upstream icon while storing identical images only once.
export async function prepareEmberIcons(work) {
  const root = path.join(work, 'public/img/icons')
  const unique = new Map()
  const paths = {}
  for (const type of ['effects', 'skills']) {
    for (const name of (await readdir(path.join(root, type))).sort()) {
      const relative = `${type}/${name}`
      const file = path.join(root, relative)
      const hash = createHash('sha256')
        .update(await readFile(file))
        .digest('hex')
      const existing = unique.get(hash)
      paths[relative] = `img/icons/${existing ?? relative}`
      if (existing) await rm(file)
      else unique.set(hash, relative)
    }
  }
  await writeFile(path.join(work, 'src/data/icon-paths.json'), JSON.stringify(paths))
}

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
