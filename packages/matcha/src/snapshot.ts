// Copyright (c) FFCafe. Licensed under AGPL-3.0-only.
import type { Json } from '@ffcafe/mojito-plugin-sdk'
import type { MatchaEvent } from './protocol.js'

/** Materialized display state: new views receive each gear slot/world/boat and the current fishing turn. */
export class MatchaSnapshot {
  private readonly state = new Map<string, MatchaEvent>()
  private bytes = 0
  clear() {
    this.state.clear()
    this.bytes = 0
  }
  events(): MatchaEvent[] {
    return structuredClone([...this.state.values()].sort((a, b) => a.sequence - b.sequence))
  }
  private remove(key: string) {
    const prior = this.state.get(key)
    if (prior) this.bytes -= JSON.stringify(prior).length * 2
    this.state.delete(key)
  }
  private removeType(type: string) {
    for (const key of this.state.keys()) if (key.startsWith(`${type}:`)) this.remove(key)
  }
  add(event: MatchaEvent) {
    const d = event.content && typeof event.content === 'object' && !Array.isArray(event.content) ? event.content : {}
    let key = `${event.type}:`
    if (event.type === 'MarketBoardItemListingCount' || event.type === 'MarketBoardItemListing') {
      key += `${d.item}:${d.world}`
      if (event.type === 'MarketBoardItemListingCount') this.remove(`MarketBoardItemListing:${d.item}:${d.world}`)
      else {
        const old = this.state.get(key)?.content as Record<string, Json> | undefined
        if (old && Array.isArray(old.data) && Array.isArray(d.data))
          event = { ...event, content: { ...d, data: [...old.data, ...d.data].slice(-1000) } }
      }
    } else if (event.type === 'Gearset') key += `${d.self}:${d.slot}`
    else if (event.type === 'SubmarineStatus' || event.type === 'SubmarineParts') {
      if (d.reset) {
        this.removeType(event.type)
        if (event.type === 'SubmarineParts') {
          this.removeType('SubmarineStatus')
          this.removeType('CompanyVoyageStatus')
        }
      }
      key += String(d.index)
    } else if (event.type === 'MiniCactpot') {
      if (d.isNewGame) this.removeType(event.type)
      key += `${d.x}:${d.y}`
    } else if (event.type === 'Fate') {
      key += String(d.fate)
      if (d.type === 'end') {
        this.remove(key)
        return
      }
    } else if (event.type === 'DynamicEvent') key += `${d.zone}:${d.event}`
    else if (event.type === 'Fishing') {
      if (['cast', 'reset', 'quit'].includes(String(d.action))) this.removeType(event.type)
      key += `${d.castId}:${d.action}`
    } else if (event.type === 'InitZone') {
      this.removeType('Fishing')
      this.removeType('FishingStatistics')
      this.removeType('Fate')
      this.removeType('DynamicEvent')
    }
    const size = JSON.stringify(event).length * 2
    if (size > 1024 * 1024) return
    this.remove(key)
    this.state.set(key, structuredClone(event))
    this.bytes += size
    while (this.state.size > 1024 || this.bytes > 2 * 1024 * 1024) this.remove(this.state.keys().next().value!)
  }
}
