import assert from 'node:assert/strict'
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign } from 'node:crypto'
import { test } from 'node:test'
import { generatePrivateKey, packFiles, validatePrivateKey, verifyPackage } from '../dist/index.js'

const manifest = {
  schemaVersion: 1,
  id: 'Package.Test',
  name: 'Package test',
  version: '1.0.0',
  apiVersion: '^2.0.0',
  entry: { kind: 'worker', path: 'backend/main.mjs' },
  capabilities: [],
}
const source = 'export const activate = () => 42'
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
const files = () => [
  { path: 'plugin.json', bytes: Buffer.from(JSON.stringify(manifest)) },
  { path: 'backend/main.mjs', bytes: Buffer.from(source) },
  { path: '资源/empty', bytes: new Uint8Array() },
]

function resign(bytes, key, change) {
  const offset = 12 + Buffer.from(bytes).readUInt32LE(8)
  const [header, payload] = Buffer.from(bytes).subarray(12, offset).toString().split('.')
  const metadata = JSON.parse(Buffer.from(payload, 'base64url'))
  const archive = Buffer.from(bytes.subarray(offset))
  change(metadata, archive)
  metadata.archiveSha256 = hash(archive)
  const input = `${header}.${Buffer.from(JSON.stringify(metadata)).toString('base64url')}`
  const signature = sign(null, Buffer.from(input), createPrivateKey({ key: JSON.parse(key), format: 'jwk' }))
  const jws = Buffer.from(`${input}.${signature.toString('base64url')}`)
  const prefix = Buffer.alloc(12)
  prefix.write('MJPKG01\0')
  prefix.writeUInt32LE(jws.length, 8)
  return Buffer.concat([prefix, jws, archive])
}

test('generated JWK text is usable by Node and matches the package signer', () => {
  const key = generatePrivateKey()
  assert.equal(typeof key, 'string')
  const nodeKey = createPrivateKey({ key: JSON.parse(key), format: 'jwk' })
  const publicKey = createPublicKey(nodeKey).export({ format: 'jwk' }).x
  assert.deepEqual(validatePrivateKey(key), { publicKey, fingerprint: hash(Buffer.from(publicKey, 'base64url')) })
  assert.notEqual(generatePrivateKey(), key)
  const imported = JSON.stringify(generateKeyPairSync('ed25519').privateKey.export({ format: 'jwk' }))
  assert.deepEqual(verifyPackage(packFiles(files(), imported)).signer, validatePrivateKey(imported))
})

test('Copy and LZMA2 return complete-file catalog metadata', () => {
  const key = generatePrivateKey()
  for (const compression of ['copy', 'lzma2']) {
    const bytes = packFiles(files(), key, compression)
    const result = verifyPackage(bytes)
    assert.deepEqual(result.metadata.manifest, manifest)
    assert.equal(result.signatureValid, true)
    assert.equal(result.size, bytes.length)
    assert.equal(result.sha256, hash(bytes))
    assert.notEqual(result.sha256, result.metadata.archiveSha256)
    assert.deepEqual(
      result.files.map(({ path }) => path).sort(),
      files()
        .map(({ path }) => path)
        .sort(),
    )
  }
})

test('key import and signing use the same rejection rules without revealing private bytes', () => {
  const key = JSON.parse(generatePrivateKey())
  const invalid = [
    '{}',
    'null',
    '{broken',
    JSON.stringify({ ...key, kty: 'RSA' }),
    JSON.stringify({ ...key, crv: 'X25519' }),
    JSON.stringify({ ...key, d: undefined }),
    JSON.stringify({ ...key, d: 'AA==' }),
    JSON.stringify({ ...key, d: 'AA' }),
    JSON.stringify({ ...key, x: 'wrong' }),
    `{"kty":"OKP","d":"${key.d}","d":"${key.d}"}`,
  ]
  for (const text of invalid) {
    for (const operation of [() => validatePrivateKey(text), () => packFiles(files(), text)]) {
      assert.throws(operation, (error) => !String(error).includes(key.d))
    }
  }
})

test('full verification rejects corrupt members even with a valid signature and archive hash', () => {
  const key = generatePrivateKey()
  const bytes = packFiles(files(), key, 'copy')
  const corrupted = resign(bytes, key, (_metadata, archive) => {
    const offset = archive.indexOf(Buffer.from(source))
    assert.ok(offset >= 0)
    archive[offset] ^= 1
  })
  assert.throws(() => verifyPackage(corrupted), /CRC|crc|checksum/i)
  const mismatched = resign(bytes, key, (metadata) => {
    metadata.manifest.name = 'Changed'
  })
  assert.throws(() => verifyPackage(mismatched), /Manifest differs/)
  const brokenSignature = Buffer.from(bytes)
  brokenSignature[30] ^= 1
  assert.throws(() => verifyPackage(brokenSignature))
})

test('shared Rust rules reject invalid package inputs', () => {
  const key = generatePrivateKey()
  assert.throws(() => packFiles(files(), key, 'deflate'))
  assert.throws(() => packFiles(files().slice(1), key), /Missing plugin.json/)
  assert.throws(
    () =>
      packFiles(
        files().filter(({ path }) => path !== manifest.entry.path),
        key,
      ),
    /Entry missing/,
  )
  for (const path of ['../escape', 'backend/MAIN.mjs', 'backend/main.mjs/child', 'plugin.json']) {
    assert.throws(() => packFiles([...files(), { path, bytes: new Uint8Array() }], key))
  }
  assert.throws(
    () =>
      packFiles(
        Array.from({ length: 4097 }, () => files()[0]),
        key,
      ),
    /Too many/,
  )
})
