import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const { name, version, license, files } = JSON.parse(
  readFileSync(new URL('../packages/package/package.json', import.meta.url), 'utf8'),
)
assert.equal(name, '@ffcafe/mojito-package')
assert.equal(process.env.GITHUB_REF_NAME, `package-v${version}`)
assert.ok(typeof license === 'string' && license !== 'UNLICENSED', 'Confirm the package license before publishing')
assert.ok(files.includes('LICENSE') || files.includes('COPYING'), 'Include the confirmed license in the npm package')
