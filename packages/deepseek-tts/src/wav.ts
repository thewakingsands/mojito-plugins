export const SAMPLE_RATE = 24000

/** 把 24 kHz、16 位、单声道的 PCM 片段首尾相接，加上 44 字节的 WAV 头 */
export function wav(parts: Uint8Array[]): Uint8Array {
  const dataBytes = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(44 + dataBytes)
  const view = new DataView(out.buffer)
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) out[offset + i] = text.charCodeAt(i)
  }
  ascii(0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, SAMPLE_RATE, true)
  view.setUint32(28, SAMPLE_RATE * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  ascii(36, 'data')
  view.setUint32(40, dataBytes, true)
  let offset = 44
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}
