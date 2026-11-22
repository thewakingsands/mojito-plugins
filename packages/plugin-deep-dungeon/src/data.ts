export const dungeons = ['PotD', 'HoH', 'EO', 'PT'] as const
export type Dungeon = (typeof dungeons)[number]
export type Language = 'en' | 'zhCN'
export type Notes = { en?: string; zhCN?: string }
export type Weakness = 'effective' | 'immune' | 'unknown'
export type Monster = {
  nameId: number
  upstreamName: string
  dungeons: Dungeon[]
  aggro: string
  threat: string
  weakness: Record<'stun' | 'heavy' | 'slow' | 'sleep' | 'bind', Weakness>
  undead: boolean
  notes: Notes
  sourcePath: string
}
export type Floor = { dungeon: Dungeon; key: string; redirect?: string; notes: Notes }
export type Catalog = {
  monsters: Monster[]
  territories: { dungeon: Dungeon; first: number; last: number }[]
  floors: Floor[]
  nameColumn: number | null
}
export function note(notes: Notes, language: Language): string | null {
  if (language === 'zhCN' && notes.zhCN?.trim()) return notes.zhCN
  return notes.en?.trim() ? notes.en : null
}
export function floorNote(catalog: Catalog, floor: Floor, language: Language): string | null {
  const seen = new Set<string>()
  let current: Floor | undefined = floor
  while (current) {
    if (seen.has(current.key)) return null
    seen.add(current.key)
    const text = note(current.notes, language)
    if (text !== null) return text
    const next: string | undefined = current.redirect
    current = next ? catalog.floors.find((item) => item.dungeon === floor.dungeon && item.key === next) : undefined
  }
  return null
}
export function dungeonAt(catalog: Catalog, territory: number): Dungeon | null {
  return catalog.territories.find((range) => territory >= range.first && territory <= range.last)?.dungeon ?? null
}
