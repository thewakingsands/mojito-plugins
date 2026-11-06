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

const documents = {
  amethyst: ['popup.html'],
  glass: ['settings.html'],
  faceroll: ['faceroll_config.js', 'faceroll_parse.js'],
}
export async function verifyTemplate(directory, name) {
  const metadata = JSON.parse(await readFile(path.join(directory, 'SOURCE.json'), 'utf8'))
  assert.equal(metadata.name, name, 'Template source identity mismatch')
  assert.match(metadata.revision, /^[a-f0-9]{40}$/, 'Missing pinned source revision')
  assert(metadata.version && metadata.source.endsWith(`/tree/${metadata.revision}`), 'Invalid source metadata')
  const files = await filesIn(directory)
  const migrated = !['kagerou', 'skyline', 'mopimopi2'].includes(name)
  if (migrated)
    assert(
      files.some((file) => /^(LICENSE(?:\.md)?|COPYING)$/.test(path.basename(file))),
      'Missing upstream license',
    )
  assert(files.length + 2 <= 4096, 'Template exceeds package file limit')
  for (const relative of documents[name] ?? []) await requireFile(path.join(directory, relative))
  for (const html of migrated ? files.filter((file) => file.endsWith('.html')) : []) {
    const markup = await readFile(html, 'utf8')
    for (const match of markup.matchAll(/<(?:script|link)\b[^>]*?\b(?:src|href)=["']([^"']+)["']/gi)) {
      const reference = match[1].split(/[?#]/)[0]
      if (!reference || reference.startsWith('data:')) continue
      assert(!/^(?:https?:)?\/\//.test(reference), `Remote runtime resource: ${reference}`)
      const target = reference.startsWith('/plugin/')
        ? path.join(directory, reference.slice(8))
        : path.resolve(path.dirname(html), reference)
      const relative = path.relative(directory, target)
      assert(!relative.startsWith('..') && !path.isAbsolute(relative), `Resource outside template: ${reference}`)
      await requireFile(target)
    }
  }
  for (const file of ['SOURCE.json', 'SOURCE.txt', name === 'kagerou' ? 'overlay/index.html' : 'index.html'])
    await requireFile(path.join(directory, file))
  for (const file of files) {
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
