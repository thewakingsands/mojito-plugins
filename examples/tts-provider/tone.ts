/** A 16-bit mono WAV of one short beep per character, up to twelve; the voice sets the pitch */
export function toneWav(text: string, frequency: number): Uint8Array {
  const rate = 22050
  const beep = Math.round(rate * 0.09)
  const gap = Math.round(rate * 0.06)
  const count = Math.min(12, Math.max(1, [...text].length))
  const samples = count * (beep + gap)
  const bytes = new Uint8Array(44 + samples * 2)
  const view = new DataView(bytes.buffer)
  const ascii = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) bytes[offset + i] = value.charCodeAt(i)
  }
  ascii(0, 'RIFF')
  view.setUint32(4, 36 + samples * 2, true)
  ascii(8, 'WAVEfmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, rate, true)
  view.setUint32(28, rate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  ascii(36, 'data')
  view.setUint32(40, samples * 2, true)
  for (let i = 0; i < samples; i++) {
    const t = i % (beep + gap)
    const value = t < beep ? Math.sin((2 * Math.PI * frequency * t) / rate) * Math.min(1, (beep - t) / 200) * 0.4 : 0
    view.setInt16(44 + i * 2, Math.round(value * 32767), true)
  }
  return bytes
}
