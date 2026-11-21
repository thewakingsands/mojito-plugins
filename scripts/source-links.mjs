import { execFileSync } from 'node:child_process'

export const pluginRepository = 'https://github.com/thewakingsands/mojito-plugins'
export const matchaUiRepository = 'https://github.com/thewakingsands/matcha-overlay'

export function gitRevision(directory) {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: directory, encoding: 'utf8' }).trim()
}
