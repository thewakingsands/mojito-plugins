import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { sourceMetadata } from '../scripts/source.mjs'

it('records actual repository and UI revisions, including uncommitted source changes', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'matcha-source-'))
  const ui = path.join(root, 'vendor/matcha-overlay')
  const git = (directory: string, ...args: string[]) =>
    execFileSync(
      'git',
      [
        '-C',
        directory,
        '-c',
        'user.name=Test',
        '-c',
        'user.email=test@example.invalid',
        '-c',
        'commit.gpgsign=false',
        ...args,
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    ).trim()
  try {
    mkdirSync(ui, { recursive: true })
    for (const directory of [ui, root]) {
      git(directory, 'init')
      writeFileSync(path.join(directory, 'source.txt'), 'original')
      git(directory, 'add', '.')
      git(directory, 'commit', '-m', 'fixture')
    }
    const clean = sourceMetadata(root)
    expect(clean.revision).toBe(git(root, 'rev-parse', 'HEAD'))
    expect(clean.ui.revision).toBe(git(ui, 'rev-parse', 'HEAD'))
    expect(clean.dirty).toBe(false)
    expect(clean.ui.dirty).toBe(false)
    writeFileSync(path.join(root, 'source.txt'), 'changed')
    expect(sourceMetadata(root).dirty).toBe(true)
    git(root, 'checkout', '--', 'source.txt')
    writeFileSync(path.join(ui, 'source.txt'), 'changed UI')
    expect(sourceMetadata(root).ui.dirty).toBe(true)
    git(ui, 'checkout', '--', 'source.txt')
    writeFileSync(path.join(ui, 'new-source.txt'), 'untracked UI')
    expect(sourceMetadata(root).ui.dirty).toBe(true)
    git(ui, 'add', '.')
    git(ui, 'commit', '-m', 'next UI revision')
    const advanced = sourceMetadata(root)
    expect(advanced.ui.revision).not.toBe(clean.ui.revision)
    expect(advanced.ui.dirty).toBe(false)
    expect(advanced.dirty).toBe(true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
