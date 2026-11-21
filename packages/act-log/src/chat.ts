import { parseSeString, Type } from '@ffcafe/elpis-sestring'
import { Buffer } from 'buffer'

// The visible label is stored as text between the link's opening and closing payloads.
const linkPayload = 0x27

export function chatText(bytes: Uint8Array): string {
  let result = ''
  for (const part of parseSeString(Buffer.from(bytes))) {
    if (typeof part === 'string') {
      result += part
      continue
    }
    switch (part.type as number) {
      case linkPayload:
      case Type.Gui:
      case Type.Color:
      case Type.UIForeground:
      case Type.UIGlow:
      case Type.Emphasis:
        break
      default:
        throw new Error(`尚无法按 ACT 格式还原聊天标记 ${part.type}`)
    }
  }
  // Keep chat on one pipe-delimited log row while preserving the original characters.
  return result.replaceAll('\\', '\\\\').replaceAll('|', '\\u007c').replaceAll('\r', '\\r').replaceAll('\n', '\\n')
}
