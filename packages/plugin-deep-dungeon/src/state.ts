import type { CombatantState, Field } from '@ffcafe/mojito-plugin-sdk'
import type { Catalog, Dungeon, Language, Monster } from './data.js'

export type Settings = { language: 'auto' | Language }
export type Display = { settings: Settings; language: Language }
export type Target = {
  id: number
  nameId: number | null
  name: string
  hp: { current: number; max: number } | null
  monster: Monster | null
}
export const defaults: Settings = { language: 'auto' }
export function settings(value: unknown): Settings | null {
  if (!value || typeof value !== 'object' || !('language' in value)) return null
  return value.language === 'auto' || value.language === 'en' || value.language === 'zhCN'
    ? { language: value.language }
    : null
}
export function language(config: Settings, uiLanguage: string): Language {
  return config.language === 'auto' ? (/^zh(?:-|$)/i.test(uiLanguage) ? 'zhCN' : 'en') : config.language
}
export function available<T>(field: Field<T> | undefined): T | null {
  return field?.state === 'ok' ? field.value : null
}
export function target(
  catalog: Catalog,
  dungeon: Dungeon | null,
  id: number | null,
  entity: CombatantState | null,
): Target | null {
  if (!dungeon || id === null || entity?.id !== id) return null
  // BattleNpc / Combatant excludes pets, companions and party NPCs.
  if (available(entity.objectKind) !== 2 || available(entity.subKind) !== 5) return null
  const nameId = available(entity.bNpcName)
  const monster = catalog.monsters.find((item) => item.nameId === nameId && item.dungeons.includes(dungeon)) ?? null
  const name = available(entity.name)?.trim() || monster?.upstreamName || String(id)
  const current = available(entity.hpCur),
    max = available(entity.hpMax)
  return { id, nameId, name, monster, hp: current !== null && max !== null && max > 0 ? { current, max } : null }
}
