import { execFileSync } from 'node:child_process'
import path from 'node:path'

export function sourceMetadata(root) {
  const git = (directory, ...args) => execFileSync('git', ['-C', directory, ...args], { encoding: 'utf8' }).trim()
  const ui = path.join(root, 'vendor/matcha-overlay')
  return {
    repository: 'https://github.com/thewakingsands/mojito-plugins',
    revision: git(root, 'rev-parse', 'HEAD'),
    dirty: git(root, 'status', '--porcelain', '--untracked-files=normal') !== '',
    ui: {
      repository: 'https://github.com/thewakingsands/matcha-overlay',
      path: 'vendor/matcha-overlay',
      revision: git(ui, 'rev-parse', 'HEAD'),
      dirty: git(ui, 'status', '--porcelain', '--untracked-files=normal') !== '',
    },
    build: [
      'Use Node.js 24 and the packageManager version from package.json.',
      'Check out the repository revision above.',
      'git submodule update --init --recursive',
      'pnpm install --frozen-lockfile',
      'pnpm --filter @ffcafe/mojito-matcha... build',
      'Output: packages/matcha/dist',
    ],
  }
}
