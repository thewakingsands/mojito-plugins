import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { jobId } from '../../packages/overlay-plugins/src/job-icons.js'
import { gitRevision, pluginRepository } from '../source-links.mjs'
import { extractEmberFonts } from './ember-icons.mjs'
import { copyFont, pruneFonts } from './fonts.mjs'
import { writeDependencyNotices } from './licenses.mjs'
import { officialTemplates } from './templates.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const output = path.join(root, 'packages/overlay-plugins/dist')
const cache = path.join(root, '.tmp/overlay-templates')
const sources = {
  kagerou: {
    jobIconAtlas: 'share/img/classes.png',
    jobIconPages: ['overlay/index.html', 'config/index.html'],
    repository: 'https://github.com/ffcafe-overlays/kagerou.git',
    revision: 'cc6bda1264c378f89de2847142392b44f584da69',
    lock: 'kagerou-package-lock.json',
    output: 'dist',
    async build(work) {
      const styles = []
      for (const font of ['roboto', 'roboto-mono']) {
        await copyFont(
          path.join(work, 'node_modules/@fontsource', font),
          path.join(work, 'share/fonts', font),
          [400, 700],
        )
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
      for (const font of ['roboto', 'roboto-mono'])
        await cp(
          path.join(work, 'node_modules/@fontsource', font, 'LICENSE'),
          path.join(work, 'dist', `${font}-LICENSE`),
        )
    },
  },
  skyline: {
    repository: 'https://github.com/ffcafe-overlays/skyline-overlay.git',
    revision: '992145aa83996651316807941920460e5e33af0b',
    lock: 'skyline-package-lock.json',
    output: 'dist',
    async build(work) {
      run('npx', ['--yes', 'bun@1.3.11', 'run', 'scripts/genIconIdx.ts'], work)
      const timestamp = execFileSync('git', ['show', '-s', '--format=%ct', this.revision], {
        cwd: path.join(cache, 'sources/skyline'),
        encoding: 'utf8',
      }).trim()
      run('npx', ['--yes', 'bun@1.3.11', 'run', 'scripts/genMeta.ts'], work, { SOURCE_DATE_EPOCH: timestamp })
      run('npx', ['--no-install', 'vite', 'build'], work, { VITE_BASE_URL: '/plugin/' })
      await rm(path.join(work, 'dist/devbg'), { recursive: true, force: true })
      await rm(path.join(work, 'dist/fonts'), { recursive: true, force: true })
    },
  },
  mopimopi2: {
    repository: 'https://github.com/ffcafe-overlays/mopimopi2.git',
    revision: '72f50e4dd2075660e7d68be466ca074880e79889',
    output: '.',
  },
  faceroll: {
    jobIconDirectory: 'jobicon',
    jobIconAliases: ['cpt', 'botanist'],
    jobIconPages: ['index.html'],
    client: true,
    repository: 'https://github.com/ffcafe-overlays/facerolloverlay.git',
    revision: '7487b1837dfc5313ef2fedda4629bf5d8d272bee',
    output: '.',
  },
  horizoverlay: {
    jobIconDirectory: 'src/images',
    jobIconPages: ['index.html'],
    client: true,
    repository: 'https://github.com/ffcafe-overlays/horizoverlay.git',
    revision: '2fbde1895a08edc9c6204025eebc06f28727279a',
    output: 'build',
    lock: 'horizoverlay-package-lock.json',
    command: ['npm', 'run', 'build'],
    env: { PUBLIC_URL: '/plugin', GENERATE_SOURCEMAP: 'false' },
    async prepare(work) {
      await rm(path.join(work, 'src/css/fonts'), { recursive: true, force: true })
    },
  },
  cmskin: {
    jobIconDirectory: 'public/img/jobs',
    jobIconPages: ['index.html'],
    client: true,
    repository: 'https://github.com/ffcafe-overlays/ffxiv-cmskin.git',
    revision: 'c3c84948e9e57ef9cbd613be7f91a42715813b5d',
    output: 'dist',
    lock: 'cmskin-package-lock.json',
    async build(work) {
      run('node', ['node_modules/roadhog/bin/roadhog.js', 'build'], work, {
        NODE_OPTIONS: '--openssl-legacy-provider',
        ESLINT: 'none',
      })
      run('npx', ['--no-install', 'gulp', 'html'], work)
    },
  },
  mopimopi1: {
    jobIconDirectory: 'images/glow',
    jobIconPages: ['index.html'],
    client: true,
    repository: 'https://github.com/ffcafe-overlays/mopimopi.git',
    revision: '4ef3a6f10848aa9042f462258d25a16dc4f2c7ee',
    output: '.',
    lock: 'mopimopi1-package-lock.json',
    files: ['index.html', 'js', 'css', 'images', 'fonts'],
    async build(work) {
      for (const [font, weights] of [
        ['montserrat', [500]],
        ['roboto', [400, 700]],
        ['roboto-condensed', [400]],
      ])
        await copyFont(path.join(work, 'node_modules/@fontsource', font), path.join(work, 'fonts', font), weights)
    },
  },
  ikegami: {
    jobIconAtlas: 'assets/classes.png',
    jobIconPages: ['index.html'],
    client: true,
    repository: 'https://github.com/ffcafe-overlays/ikegami.git',
    revision: '4ac49d4f1d162829f05c762d9ab99d14dbb3f288',
    licenses: ['lato'],
    output: 'dist',
    lock: 'ikegami-package-lock.json',
    command: ['npx', '--no-install', 'vite', 'build'],
  },
  ember: {
    repository: 'https://github.com/ffcafe-overlays/ffxiv-ember-overlay.git',
    revision: '237a72b6d6108585be88b2c8474fca6fadf5bcd4',
    output: 'build',
    lock: 'ember-package-lock.json',
    async prepare(work) {
      await cp(path.join(root, 'packages/overlay-plugins/src/job-icons.js'), path.join(work, 'src/mojito-job-icons.js'))
      for (const relative of [
        'public/img/buttons',
        'public/img/icons/skills',
        'public/img/icons/effects',
        'public/img/icons/jobs',
      ])
        await rm(path.join(work, relative), { recursive: true, force: true })
    },
    async build(work) {
      run('npm', ['run', 'build'], work, this.env)
      await extractEmberFonts(work)
    },
    env: { GENERATE_SOURCEMAP: 'false', PUBLIC_URL: '/plugin' },
  },
  amethyst: {
    client: true,
    repository: 'https://github.com/ffcafe-overlays/FancyDetail.git',
    revision: 'a31e346ccdd2bea9909edf5578daf78777a54b10',
    licenses: ['aldrich', 'material-icons'],
    output: '.',
  },
  klondike: {
    client: true,
    repository: 'https://github.com/ffcafe-overlays/klondike.git',
    revision: 'eee2fa5b10ef56c88fe54c215c4c41f9df11a686',
    licenses: ['lato'],
    output: 'dist',
    lock: 'klondike-package-lock.json',
    command: ['npm', 'run', 'build'],
    env: { NODE_OPTIONS: '--openssl-legacy-provider' },
  },
  glass: {
    jobIconDirectory: 'public/images/icons/jobs',
    jobIconPages: ['index.html'],
    client: true,
    repository: 'https://github.com/ffcafe-overlays/ffxiv-glass-overlay.git',
    revision: 'ae2114f94a0c7a9385fcc494d425a577a9d99bdb',
    output: 'build',
    async build(work) {
      await cp(path.join(work, 'node_modules/@fontsource/inter/LICENSE'), path.join(work, 'build/Inter-LICENSE'))
    },
    lock: 'glass-package-lock.json',
    command: ['npm', 'run', 'build'],
  },
}
const selected = process.argv.slice(2)
for (const name of selected) if (!sources[name]) throw new Error(`Unknown template: ${name}`)
const entries = (selected.length ? selected : officialTemplates).map((name) => [name, sources[name]])
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
  return `commit-${sources[name].revision}`
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
await rm(selected.length ? path.join(output, 'sources') : output, { recursive: true, force: true })
await mkdir(output, { recursive: true })
const buildRevision = gitRevision(root)
for (const [name, source] of entries) {
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
  if (source.lock) {
    const lock = JSON.parse(await readFile(new URL(`./${source.lock}`, import.meta.url), 'utf8'))
    const manifest = JSON.parse(await readFile(path.join(work, 'package.json'), 'utf8'))
    for (const field of ['dependencies', 'devDependencies', 'optionalDependencies']) {
      if (lock.packages?.['']?.[field]) manifest[field] = lock.packages[''][field]
    }
    await writeFile(path.join(work, 'package.json'), JSON.stringify(manifest, null, 2))
    await writeFile(path.join(work, 'package-lock.json'), JSON.stringify(lock, null, 2))
    run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund', '--legacy-peer-deps'], work)
  }
  if (source.jobIconAtlas) await rm(path.join(work, source.jobIconAtlas))
  if (source.jobIconDirectory) {
    const directory = path.join(work, source.jobIconDirectory)
    for (const file of await readdir(directory)) {
      const code = path.basename(file, '.png').toLowerCase()
      if (file.endsWith('.png') && (jobId(code) > 0 || source.jobIconAliases?.includes(code)))
        await rm(path.join(directory, file))
    }
  }
  await source.prepare?.(work)
  if (source.command) run(source.command[0], source.command.slice(1), work, source.env)
  await source.build?.(work)
  const destination = path.join(output, name)
  await rm(destination, { recursive: true, force: true })
  if (source.files) {
    await mkdir(destination, { recursive: true })
    for (const file of source.files)
      await cp(path.join(work, source.output, file), path.join(destination, file), { recursive: true })
  } else await cp(path.join(work, source.output), destination, { recursive: true })
  for (const license of source.licenses ?? []) {
    await mkdir(path.join(destination, 'licenses'), { recursive: true })
    await cp(
      new URL(`./font-licenses/${license}-LICENSE`, import.meta.url),
      path.join(destination, 'licenses', `${license}-LICENSE`),
    )
  }
  if (source.licenses?.length)
    await cp(new URL('./font-licenses/README.md', import.meta.url), path.join(destination, 'licenses/FONT-SOURCES.md'))
  if (source.jobIconPages) {
    for (const file of ['job-icons.js', 'job-icon-element.js'])
      await cp(path.join(root, 'packages/overlay-plugins/src', file), path.join(destination, file))
    for (const document of source.jobIconPages) {
      const html = path.join(destination, document)
      const script = path.posix.relative(path.posix.dirname(document), 'job-icon-element.js')
      const markup = await readFile(html, 'utf8')
      const head = markup.match(/<head\b[^>]*>/i) ?? markup.match(/<!doctype html>/i)
      if (!head) throw new Error(`Cannot locate document head: ${name}/${document}`)
      await writeFile(html, markup.replace(head[0], `${head[0]}<script type="module" src="${script}"></script>`))
    }
  }
  await pruneFonts(destination)
  if (source.client) await cp(new URL('./ngld.js', import.meta.url), path.join(destination, 'ngld.js'))
  if (source.lock) await writeDependencyNotices(work, destination)
  const url = repository.replace(/\.git$/, '')
  const patch = `scripts/overlay-templates/${name}.patch`
  await writeFile(
    path.join(destination, 'SOURCE.txt'),
    `${url}/tree/${revision}\n${pluginRepository}/blob/${buildRevision}/${patch}\n`,
  )
  for (const file of ['LICENSE', 'LICENSE.md', 'COPYING']) {
    try {
      await cp(path.join(original, file), path.join(destination, file))
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }
  await writeFile(
    path.join(destination, 'SOURCE.json'),
    JSON.stringify(
      {
        name,
        revision,
        version: await upstreamVersion(name, original),
        source: `${url}/tree/${revision}`,
        patch,
      },
      null,
      2,
    ),
  )
}
