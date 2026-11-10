// Copyright (c) FFCafe. Licensed under AGPL-3.0-only.
import type { Json } from '@ffcafe/mojito-plugin-sdk'
import { asJson, record } from './protocol.js'

export interface Webhook {
  id: string
  name: string
  event: string
  type: 'GET' | 'JSON' | 'FORM' | 'MULTIPART'
  endpoint: string
  headers: Record<string, string>
}
export interface MatchaSettings {
  language: string
  output: { tts: boolean; toast: boolean }
  watch: { fates: number[] }
  formatter: {
    fate: { name: boolean; level: boolean; muteWhileLoading: boolean }
    fish: { bite: boolean; biteType: boolean }
    instance: { name: boolean; level: boolean; type: boolean }
    zone: { name: boolean; instance: boolean }
    criticalEngagement: { name: boolean }
    treasure: { result: boolean }
  }
  fishing: { enabled: boolean }
  /** The API key and uploader ID come with the build (see build-config.ts), not from the user */
  universalis: { enabled: boolean }
  webhooks: Webhook[]
  logging: boolean
}
export const defaultSettings: MatchaSettings = {
  language: 'chs',
  output: { tts: true, toast: true },
  watch: { fates: [] },
  formatter: {
    fate: { name: true, level: false, muteWhileLoading: false },
    fish: { bite: true, biteType: true },
    instance: { name: true, level: false, type: false },
    zone: { name: false, instance: true },
    criticalEngagement: { name: true },
    treasure: { result: true },
  },
  fishing: { enabled: false },
  universalis: { enabled: false },
  webhooks: [],
  logging: false,
}
/** The events a webhook can be sent for, with the names the settings page shows */
export const webhookEvents: readonly [event: string, label: string][] = [
  ['Fate', 'FATE'],
  ['FateWatchListChanged', 'FATE 关注列表变化'],
  ['DynamicEvent', '临界遭遇'],
  ['MatchAlert', '副本匹配'],
  ['Queue', '排队'],
  ['InitZone', '切换区域'],
  ['FishBite', '鱼咬钩'],
  ['Fishing', '钓鱼'],
  ['TreasureSpot', '宝藏位置'],
  ['TreasureResult', '寻宝结果'],
  ['MiniCactpot', '仙人微彩'],
  ['Gearset', '配装'],
  ['MarketBoardItemListing', '市场板价格'],
  ['MarketBoardItemListingCount', '市场板数量'],
  ['SubmarineStatus', '潜水艇状态'],
  ['SubmarineParts', '潜水艇部件'],
  ['CompanyVoyageStatus', '部队探索'],
]
export function httpsEndpoint(value: string): string {
  if (value.length > 4096) throw new Error('服务地址过长')
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('请填写不含账号密码的 HTTPS 地址')
  return url.href
}
export function settingsFrom(value: unknown): MatchaSettings {
  const result = structuredClone(defaultSettings)
  if (value === null || value === undefined) return result
  const input = record(value)
  const merge = (target: Record<string, unknown>, source: Record<string, unknown>) => {
    for (const key of Object.keys(target)) {
      const v = source[key]
      if (v === undefined) continue
      const prior = target[key]
      if (Array.isArray(prior)) continue
      if (typeof prior === 'object' && prior !== null) merge(prior as Record<string, unknown>, record(v))
      else if (typeof prior === typeof v && (typeof v !== 'string' || v.length <= 4096)) target[key] = v
      else throw new Error(`设置字段无效：${key}`)
    }
  }
  merge(result as unknown as Record<string, unknown>, input)
  if (!['chs', 'en', 'ja', 'de', 'fr'].includes(result.language)) throw new Error('不支持的语言')
  const watch = input.watch === undefined ? {} : record(input.watch)
  if (watch.fates !== undefined) {
    if (
      !Array.isArray(watch.fates) ||
      watch.fates.length > 5000 ||
      watch.fates.some((id) => !Number.isInteger(id) || id <= 0 || id > 65535)
    )
      throw new Error('FATE 列表无效')
    result.watch.fates = [...new Set(watch.fates as number[])]
  }
  if (input.webhooks !== undefined) {
    if (!Array.isArray(input.webhooks) || input.webhooks.length > 32) throw new Error('Webhook 数量超过限制')
    result.webhooks = input.webhooks.map((v, i) => {
      const row = record(v)
      if (typeof row.endpoint !== 'string' || typeof row.event !== 'string' || row.event.length > 64)
        throw new Error('Webhook 无效')
      const type = row.type as Webhook['type']
      if (!['GET', 'JSON', 'FORM', 'MULTIPART'].includes(type)) throw new Error('Webhook 类型无效')
      const headers: Record<string, string> = {}
      for (const [key, header] of Object.entries(record(row.headers ?? {}))) {
        if (
          Object.keys(headers).length >= 32 ||
          typeof header !== 'string' ||
          header.length > 4096 ||
          !/^[!#$%&'*+.^_`|~0-9a-z-]{1,128}$/i.test(key) ||
          /[\r\n]/.test(header)
        )
          throw new Error('Webhook 请求头无效')
        headers[key] = header
      }
      if (String(row.id ?? i).length > 128 || String(row.name ?? '').length > 256) throw new Error('Webhook 名称过长')
      return {
        id: String(row.id ?? i),
        name: String(row.name ?? ''),
        event: row.event,
        type,
        endpoint: httpsEndpoint(row.endpoint),
        headers,
      }
    })
  }
  return result
}
export const settingsJson = (settings: MatchaSettings): Json => asJson(settings)
