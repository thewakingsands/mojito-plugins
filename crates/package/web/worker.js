import init, { inspectPackage } from './pkg/package.js'

const ready = init()
self.onmessage = async ({ data }) => {
  try {
    await ready
    const inspection = JSON.parse(inspectPackage(new Uint8Array(data.bytes)))
    if (data.fingerprint && data.fingerprint !== inspection.signer.fingerprint) throw new Error('签名者指纹不匹配')
    self.postMessage({ inspection })
  } catch (error) {
    self.postMessage({ error: String(error.message ?? error) })
  }
}
