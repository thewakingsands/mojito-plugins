import initialize, { privateKeyFromSeed } from '../wasm/package.js'

export type { PackageFile, PackageSigner, Verification } from './api.js'
export { packFiles, validatePrivateKey, verifyPackage } from './api.js'

export async function init(): Promise<void> {
  await initialize()
}

export function generatePrivateKey(): string {
  return privateKeyFromSeed(crypto.getRandomValues(new Uint8Array(32)))
}
