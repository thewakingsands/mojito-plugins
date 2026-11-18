import { packFiles as pack, validatePrivateKey as validate, verifyPackage as verify } from '../wasm/package.js'

export interface PackageFile {
  path: string
  bytes: Uint8Array
}

export interface PackageSigner {
  publicKey: string
  fingerprint: string
}

export interface Verification {
  metadata: {
    formatVersion: 1
    manifest: Record<string, unknown>
    archiveSha256: string
    archiveSize: number
  }
  signer: PackageSigner
  signatureValid: true
  files: Array<{ path: string; size: number }>
  size: number
  sha256: string
}

export function validatePrivateKey(privateJwk: string): PackageSigner {
  return JSON.parse(validate(privateJwk))
}

export function packFiles(
  files: PackageFile[],
  privateJwk: string,
  compression: 'copy' | 'lzma2' = 'lzma2',
): Uint8Array {
  return pack(files, privateJwk, compression)
}

export function verifyPackage(bytes: Uint8Array): Verification {
  return JSON.parse(verify(bytes))
}
