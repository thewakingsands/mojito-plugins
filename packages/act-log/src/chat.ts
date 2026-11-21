import { parseSeString, Type } from '@ffcafe/elpis-sestring'
import { Buffer } from 'buffer'

export function chatText(bytes: Uint8Array): string {
  let result = ''
  for (const part of parseSeString(Buffer.from(bytes))) {
    if (typeof part === 'string') {
      result += part
      continue
    }
    switch (part.type) {
      case Type.Color:
      case Type.UIForeground:
      case Type.UIGlow:
      case Type.Emphasis:
        break
      default:
        throw new Error(`尚无法按 ACT 格式还原聊天标记 ${part.type}`)
    }
  }
  if (/[\r\n|]/u.test(result)) throw new Error('尚无法按 ACT 格式还原聊天分隔符')
  return result
}
