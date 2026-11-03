import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const output = path.join(root, 'packages/overlay-plugins/dist')
const cache = path.join(root, '.tmp/overlay-templates')
const sources = {
  kagerou: {
    repository: 'https://github.com/ffcafe-overlays/kagerou.git',
    revision: 'cc6bda1264c378f89de2847142392b44f584da69',
  },
  skyline: {
    repository: 'https://github.com/ffcafe-overlays/skyline-overlay.git',
    revision: '992145aa83996651316807941920460e5e33af0b',
  },
  mopimopi2: {
    repository: 'https://github.com/ffcafe-overlays/mopimopi2.git',
    revision: '72f50e4dd2075660e7d68be466ca074880e79889',
  },
}
/**
 * The upstream version recorded in plugin source metadata. The templates keep it in different places: package.json (skyline), the
 * nearest tag (kagerou) or a "ver.20241209" string in the source (mopimopi2).
 */
async function upstreamVersion(name, original) {
  try {
    const { version } = JSON.parse(await readFile(path.join(original, 'package.json'), 'utf8'))
    if (version) return version
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  const tag = spawnSync('git', ['-C', original, 'describe', '--tags', '--abbrev=0'], { encoding: 'utf8' })
  if (tag.status === 0 && tag.stdout.trim()) return tag.stdout.trim().replace(/^v/, '')
  const tracked = spawnSync('git', ['-C', original, 'ls-files', '*.js', '*.html'], { encoding: 'utf8' })
  for (const file of tracked.stdout.split('\n').filter(Boolean)) {
    const found = /\bver\.\s*(\d[\w.]*)/i.exec(await readFile(path.join(original, file), 'utf8'))
    if (found) return found[1]
  }
  throw new Error(`Cannot find the upstream version of ${name}`)
}
function run(command, args, cwd, env = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  if (result.status !== 0) throw new Error(`Template build failed: ${command}`)
}
await mkdir(cache, { recursive: true })
await mkdir(output, { recursive: true })
for (const [name, source] of Object.entries(sources)) {
  const { revision, repository } = source
  const original = path.join(cache, 'sources', name),
    work = path.join(cache, name)
  if (!existsSync(path.join(original, '.git'))) {
    await mkdir(path.dirname(original), { recursive: true })
    run('git', ['clone', repository, original], root)
  }
  if (spawnSync('git', ['-C', original, 'diff', '--quiet', 'HEAD']).status !== 0)
    throw new Error(`Template source has local edits: ${name}`)
  run('git', ['fetch', '--tags', 'origin', revision], original)
  run('git', ['checkout', '--detach', revision], original)
  const actual = spawnSync('git', ['-C', original, 'rev-parse', 'HEAD'], { encoding: 'utf8' })
  if (spawnSync('git', ['-C', original, 'diff', '--quiet', 'HEAD']).status !== 0)
    throw new Error(`Template source has local edits: ${name}`)
  if (actual.status !== 0 || actual.stdout.trim() !== revision) throw new Error(`Cannot read pinned source: ${name}`)
  await rm(work, { recursive: true, force: true })
  await mkdir(work, { recursive: true })
  // Copy only the pinned source tree. Keep dependencies and patches out of the pinned source checkout.
  const tracked = spawnSync('git', ['-C', original, 'ls-files', '-z'], { encoding: 'utf8' })
  if (tracked.status !== 0) throw new Error(`Cannot list source: ${name}`)
  for (const relative of tracked.stdout.split('\0').filter(Boolean)) {
    const destination = path.join(work, relative)
    await mkdir(path.dirname(destination), { recursive: true })
    await cp(path.join(original, relative), destination)
  }
  run(
    'git',
    [
      'apply',
      '--ignore-space-change',
      `--directory=.tmp/overlay-templates/${name}`,
      path.join(root, 'scripts/overlay-templates', `${name}.patch`),
    ],
    root,
  )
  if (name !== 'mopimopi2') {
    const lock = JSON.parse(await readFile(new URL(`./${name}-package-lock.json`, import.meta.url), 'utf8'))
    const manifest = JSON.parse(await readFile(path.join(work, 'package.json'), 'utf8'))
    manifest.devDependencies = lock.packages[''].devDependencies
    await writeFile(path.join(work, 'package.json'), JSON.stringify(manifest, null, 2))
    await writeFile(path.join(work, 'package-lock.json'), JSON.stringify(lock, null, 2))
    run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], work)
  }
  if (name === 'kagerou') {
    const styles = []
    for (const font of ['roboto', 'roboto-mono']) {
      const source = path.join(work, 'node_modules/@fontsource', font),
        destination = path.join(work, 'share/fonts', font)
      await cp(source, destination, { recursive: true })
      styles.push(`@import '../share/fonts/${font}/400.css';`, `@import '../share/fonts/${font}/700.css';`)
    }
    const css = path.join(work, 'config/index.css')
    await writeFile(
      css,
      (await readFile(css, 'utf8')).replace(
        /^@import url\("https:\/\/fonts.googleapis.com[^\n]+\n/,
        `${styles.join('\n')}\n`,
      ),
    )
    run('npx', ['--no-install', 'parcel', 'build', '--public-url', '/plugin/', '--no-source-maps'], work)
  } else if (name === 'skyline') {
    run('npx', ['--yes', 'bun@1.3.11', 'run', 'scripts/genIconIdx.ts'], work)
    run('npx', ['--yes', 'bun@1.3.11', 'run', 'scripts/genMeta.ts'], work)
    run('npx', ['--no-install', 'vite', 'build'], work, { VITE_BASE_URL: '/plugin/' })
    await rm(path.join(work, 'dist/devbg'), { recursive: true, force: true })
    await rm(path.join(work, 'dist/fonts'), { recursive: true, force: true })
  }
  const destination = path.join(output, name)
  await rm(destination, { recursive: true, force: true })
  await cp(name === 'mopimopi2' ? work : path.join(work, 'dist'), destination, { recursive: true })
  const url = repository.replace(/\.git$/, '')
  await writeFile(path.join(destination, 'SOURCE.txt'), `${url}/tree/${revision}\n`)
  for (const file of ['LICENSE', 'LICENSE.md', 'COPYING']) {
    try {
      await cp(path.join(original, file), path.join(destination, file))
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }
  if (name === 'kagerou') {
    for (const font of ['roboto', 'roboto-mono'])
      await cp(path.join(work, 'node_modules/@fontsource', font, 'LICENSE'), path.join(destination, `${font}-LICENSE`))
  }
  await writeFile(
    path.join(destination, 'SOURCE.json'),
    JSON.stringify(
      {
        name,
        revision,
        version: await upstreamVersion(name, original),
        source: `${url}/tree/${revision}`,
        patch: `scripts/overlay-templates/${name}.patch`,
      },
      null,
      2,
    ),
  )
}

const sourceOutput = path.join(output, 'sources')
await mkdir(sourceOutput, { recursive: true })
for (const name of Object.keys(sources)) {
  const work = path.join(cache, name)
  const recipe = path.join(work, '.mojito-build')
  await mkdir(recipe, { recursive: true })
  for (const file of [`${name}.patch`, ...(name === 'mopimopi2' ? [] : [`${name}-package-lock.json`])])
    await cp(path.join(root, 'scripts/overlay-templates', file), path.join(recipe, file))
  await cp(fileURLToPath(import.meta.url), path.join(recipe, 'build.mjs'))
  // GNU tar treats a colon before the first slash as a remote host, which rules out `D:\...` for -f.
  run(
    'tar',
    [
      '--exclude=node_modules',
      '--exclude=dist',
      '--exclude=.parcel-cache',
      '--exclude=.git',
      '-czf',
      path.relative(work, path.join(sourceOutput, `${name}-source.tar.gz`)),
      '.',
    ],
    work,
  )
}
