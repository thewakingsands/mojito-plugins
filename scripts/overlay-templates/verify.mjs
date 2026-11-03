import assert from 'node:assert/strict'
import { lstat, readdir, readFile, realpath } from 'node:fs/promises'
import path from 'node:path'

async function filesIn(root, { allowLinks = false } = {}) {
  const files = []
  const boundary = await realpath(root)
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name)
      if (entry.isSymbolicLink()) {
        const target = await realpath(file)
        const relative = path.relative(boundary, target)
        assert(
          !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative),
          `External link: ${file}`,
        )
        assert(allowLinks, `Unexpected symlink: ${file}`)
      } else if (entry.isDirectory()) await visit(file)
      else if (entry.isFile()) files.push(file)
      else throw new Error(`Unsupported package entry: ${file}`)
    }
  }
  await visit(root)
  return files.sort()
}
async function requireFile(file) {
  assert((await lstat(file)).isFile(), `Missing runtime file: ${file}`)
  assert((await readFile(file)).length > 0, `Empty runtime file: ${file}`)
}
function developmentFile(file) {
  return /\.(?:test|spec)\.[cm]?js$|\.d\.[cm]?ts$|\.map$/.test(file)
}

export async function verifyTemplate(directory, name) {
  for (const file of ['SOURCE.json', 'SOURCE.txt', name === 'kagerou' ? 'overlay/index.html' : 'index.html'])
    await requireFile(path.join(directory, file))
  for (const file of await filesIn(directory)) {
    assert(!developmentFile(file), `Development file in plugin: ${file}`)
    const bytes = await readFile(file)
    assert(
      !bytes.toString('utf8', 0, 100).startsWith('version https://git-lfs.github.com/spec/v1'),
      `Unresolved Git LFS pointer: ${file}`,
    )
    if (name === 'skyline') {
      const relative = path.relative(directory, file)
      assert(
        !/^(?:devbg|fonts)[\\/]|^(?:sw\.js|workbox-.*\.js|registerSW\.js|manifest\.webmanifest)$/.test(relative),
        `Unneeded Skyline resource: ${file}`,
      )
    }
  }
  if (name === 'skyline') {
    const scripts = (await filesIn(path.join(directory, 'assets'))).filter((file) => file.endsWith('.js'))
    assert.equal(scripts.length, 1, 'Expected one Skyline frontend bundle')
  }
}
