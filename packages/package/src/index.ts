import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { initSync, privateKeyFromSeed } from '../wasm/package.js'

initSync({ module: readFileSync(new URL('../wasm/package_bg.wasm', import.meta.url)) })

export type { PackageFile, PackageSigner, Verification } from './api.js'
export { packFiles, validatePrivateKey, verifyPackage } from './api.js'

export function generatePrivateKey(): string {
  return privateKeyFromSeed(randomBytes(32))
}
