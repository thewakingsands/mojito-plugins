// 刊例价，不含限时折扣。来源：https://api-docs.deepseek.com/zh-cn/guides/tts/ 的计费表，2026-11-15 查询。
export const PRICE_PER_10K_CHARS = 3

const han = /\p{Script=Han}/u

/** DeepSeek 的计费字符数：汉字计 2，其余字符计 1 */
export function billedChars(text: string): number {
  let chars = 0
  for (const char of text) chars += han.test(char) ? 2 : 1
  return chars
}

export function estimateYuan(chars: number): string {
  return ((chars / 10000) * PRICE_PER_10K_CHARS).toFixed(2)
}
