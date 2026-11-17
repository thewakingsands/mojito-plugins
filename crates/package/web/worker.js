import { generatePrivateKey, init, packFiles, validatePrivateKey, verifyPackage } from './tool/dist/web.js'

let ready
self.onmessage = async ({ data }) => {
  try {
    ready ??= init()
    await ready
    switch (data.action) {
      case 'generateKey':
        self.postMessage({ privateJwk: generatePrivateKey() })
        break
      case 'validateKey':
        self.postMessage({ signer: validatePrivateKey(data.privateJwk) })
        break
      case 'pack': {
        const files = data.files.map(({ path, bytes }) => ({ path, bytes: new Uint8Array(bytes) }))
        const bytes = packFiles(files, data.privateJwk, data.compression)
        const verification = verifyPackage(bytes)
        self.postMessage({ bytes: bytes.buffer, verification }, [bytes.buffer])
        break
      }
      case 'verify':
        self.postMessage({ verification: verifyPackage(new Uint8Array(data.bytes)) })
        break
      default:
        throw new Error('Unknown operation')
    }
  } catch (error) {
    self.postMessage({ error: String(error.message ?? error) })
  }
}
