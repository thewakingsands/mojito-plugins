// Copyright (c) FFCafe. Ported from Cafe.Matcha Utils/Formatter.cs and Views/MainControl.xaml.cs.
// Licensed under AGPL-3.0-only.
import type { Json } from '@ffcafe/mojito-plugin-sdk'
import dynamicEvents from './data/dynamic-event.json'
import fates from './data/fate.json'
import instances from './data/instance.json'
import roulettes from './data/roulette.json'
import territories from './data/territory.json'
import types from './data/type.json'
import type { MatchaSettings } from './settings.js'

const row = (table: unknown, id: unknown): Record<string, unknown> | undefined =>
  (table as Record<string, Record<string, unknown>>)[String(id)]
export function localized(value: unknown, language: string): string {
  if (typeof value === 'string') return value
  if (!value || typeof value !== 'object') return ''
  const name = value as Record<string, unknown>
  return String(name[language] ?? name.chs ?? name.en ?? '')
}
export class Notices {
  private readonly fates = new Set<number>()
  private readonly dynamics = new Set<string>()
  private lastZone = -Infinity
  reset() {
    this.fates.clear()
    this.dynamics.clear()
    this.lastZone = -Infinity
  }
  message(type: string, content: Json, at: number, settings: MatchaSettings): string | null {
    const d = content as Record<string, Json>
    if (!d || typeof d !== 'object' || Array.isArray(d)) return null
    const f = settings.formatter
    const name = (value: unknown) => localized(value, settings.language)
    const instance = (id: Json | undefined) => {
      const item = row(instances, id)
      if (!item) return ''
      return [
        f.instance.type ? name(row(types, item.type)) : '',
        f.instance.level ? `${item.level}级` : '',
        f.instance.name ? name(item.name) : '',
      ]
        .filter(Boolean)
        .join(' ')
    }
    switch (type) {
      case 'InitZone': {
        this.fates.clear()
        this.dynamics.clear()
        this.lastZone = at
        return (
          [
            f.zone.name ? name(row(territories, d.zone)) || '未知地区' : '',
            f.zone.instance && d.instance ? `任务 ${name(row(instances, d.instance)?.name) || '未知副本'}` : '',
          ]
            .filter(Boolean)
            .join(' ') || null
        )
      }
      case 'MatchAlert':
        return (d.roulette ? name(row(roulettes, d.roulette)) || '未知随机任务' : instance(d.instance)) || null
      case 'Fate': {
        const id = Number(d.fate)
        if (d.type === 'end') {
          this.fates.delete(id)
          return null
        }
        if (!['start', 'progress'].includes(String(d.type)) || this.fates.has(id) || !settings.watch.fates.includes(id))
          return null
        this.fates.add(id)
        if (f.fate.muteWhileLoading && at - this.lastZone <= 5000) return null
        const item = row(fates, id)
        if (!item) return null
        const text = [f.fate.level ? `${item.level}级` : '', f.fate.name ? name(item.name) : '']
          .filter(Boolean)
          .join(' ')
        return text ? text + (d.type === 'progress' && d.progress ? ` 进度 ${d.progress}%` : '') : null
      }
      case 'FishBite':
        return (
          [f.fish.bite ? '咬钩' : '', f.fish.biteType ? ['', '轻杆', '普通杆', '强力杆'][Number(d.type)] : '']
            .filter(Boolean)
            .join(' ') || null
        )
      case 'DynamicEvent': {
        const key = `${d.zone}:${d.event}`
        if (d.stage !== 1 && d.stage !== 2) {
          this.dynamics.delete(key)
          return null
        }
        if (this.dynamics.has(key)) return null
        this.dynamics.add(key)
        return f.criticalEngagement.name
          ? name(row(dynamicEvents, Number(d.zone) * 1000 + Number(d.event))?.name) || null
          : null
      }
      case 'TreasureResult':
        return f.treasure.result
          ? ((
              {
                'wheel-low': '下级召唤',
                'wheel-medium': '中级召唤',
                'wheel-high': '上级召唤',
                'wheel-shift': '召唤式变动',
                'wheel-special': '特殊召唤',
                'wheel-end': '召唤失败',
                'gate-open': '开门',
                'gate-fail': '失败',
              } as Record<string, string>
            )[String(d.value)] ?? null)
          : null
      default:
        return null
    }
  }
}
