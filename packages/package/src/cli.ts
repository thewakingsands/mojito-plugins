#!/usr/bin/env node
import { access, appendFile, mkdir, readdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { parseArgs } from 'node:util'
import type { PackageFile } from './api.js'
import { generatePrivateKey, packFiles, verifyPackage } from './index.js'

const usage = `mojito-package keygen [PRIVATE_JWK] [--allow-git] [--gitignore]
mojito-package pack DIRECTORY [--key PRIVATE_JWK] [--output OUTPUT] [--compression copy|lzma2]
mojito-package verify PACKAGE`

function defaultKey(): string {
  return path.join(homedir(), '.mojito-keys', 'author.jwk')
}

async function workingTree(file: string): Promise<string | undefined> {
  for (let directory = path.dirname(file); ; directory = path.dirname(directory)) {
    try {
      await access(path.join(directory, '.git'))
      return directory
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    if (directory === path.dirname(directory)) return undefined
  }
}

function outside(directory: string, file: string): void {
  const relative = path.relative(directory, file)
  if (relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))) {
    throw new Error('Keep the signing key and output outside the input directory')
  }
}

async function collect(root: string, directory = root, files: PackageFile[] = []): Promise<PackageFile[]> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      await collect(root, file, files)
    } else if (entry.isFile()) {
      files.push({ path: path.relative(root, file).split(path.sep).join('/'), bytes: await readFile(file) })
    } else {
      throw new Error(`Package symlinks and special files are forbidden: ${file}`)
    }
  }
  return files
}

async function run(): Promise<void> {
  const [command, ...args] = process.argv.slice(2)
  if (!command || command === '--help' || command === '-h' || args.includes('--help')) {
    console.log(usage)
    return
  }
  if (command === 'keygen') {
    const { values, positionals } = parseArgs({
      args,
      allowPositionals: true,
      options: { 'allow-git': { type: 'boolean' }, gitignore: { type: 'boolean' } },
    })
    if (positionals.length > 1) throw new Error(usage)
    if (values.gitignore && !values['allow-git']) throw new Error('--gitignore requires --allow-git')
    const file = path.resolve(positionals[0] ?? defaultKey())
    const repository = await workingTree(file)
    if (repository && !values['allow-git']) {
      throw new Error(`Signing key is inside a git working tree: ${file}. Confirm with --allow-git.`)
    }
    if (values.gitignore && !repository) throw new Error('No git working tree for --gitignore')
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, generatePrivateKey(), { mode: 0o600, flag: 'wx' })
    if (repository && values.gitignore) {
      await appendFile(
        path.join(repository, '.gitignore'),
        `\n${path.relative(repository, file).split(path.sep).join('/')}\n`,
      )
    }
    console.error(`Private key saved to ${file}. Back up this file and use it for future releases.`)
    return
  }
  if (command === 'pack') {
    const { values, positionals } = parseArgs({
      args,
      allowPositionals: true,
      options: { key: { type: 'string' }, output: { type: 'string' }, compression: { type: 'string' } },
    })
    if (positionals.length !== 1) throw new Error(usage)
    const input = await realpath(positionals[0])
    const key = await realpath(values.key ?? defaultKey())
    const output = path.resolve(values.output ?? `${input}.mojito`)
    outside(input, key)
    outside(input, path.join(await realpath(path.dirname(output)), path.basename(output)))
    const bytes = packFiles(
      await collect(input),
      await readFile(key, 'utf8'),
      values.compression as 'copy' | 'lzma2' | undefined,
    )
    const result = verifyPackage(bytes)
    await writeFile(output, bytes)
    console.log(JSON.stringify(result))
    return
  }
  if (command === 'verify' && args.length === 1) {
    console.log(JSON.stringify(verifyPackage(await readFile(args[0]))))
    return
  }
  throw new Error(usage)
}

try {
  await run()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
