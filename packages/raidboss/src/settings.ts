import { languages } from '../vendor/cactbot/resources/languages'
import type { RuleConfig, Settings } from './engine'
import { compileMatcher } from './matcher'

export function parseSettings(value: unknown): Settings {
  const record = value as Partial<Settings> | null
  if (record === null || record === undefined) return { language: 'cn', audio: 'tts', rules: {} }
  if (
    typeof record !== 'object' ||
    Array.isArray(record) ||
    Object.keys(record).some((key) => !['language', 'audio', 'rules', 'sets'].includes(key))
  )
    throw new Error('Invalid settings')
  if (!languages.includes(record.language!) || !['tts', 'sound', 'none'].includes(record.audio!))
    throw new Error('Invalid language/audio setting')
  if (!record.rules || typeof record.rules !== 'object' || Array.isArray(record.rules)) throw new Error('Invalid rules')
  for (const rules of Object.values(record.rules)) {
    if (!rules || typeof rules !== 'object' || Array.isArray(rules)) throw new Error('Invalid rule group')
    for (const config of Object.values(rules)) validateRule(config)
  }
  if (record.sets !== undefined) {
    if (!record.sets || typeof record.sets !== 'object' || Array.isArray(record.sets))
      throw new Error('Invalid collection settings')
    for (const values of Object.values(record.sets))
      if (
        !values ||
        typeof values !== 'object' ||
        Array.isArray(values) ||
        Object.values(values).some(
          (value) =>
            !['string', 'number', 'boolean'].includes(typeof value) ||
            (typeof value === 'number' && !Number.isFinite(value)),
        )
      )
        throw new Error('Invalid collection setting')
  }
  return structuredClone(record) as Settings
}

function validateRule(config: RuleConfig): void {
  if (
    !config ||
    typeof config !== 'object' ||
    Array.isArray(config) ||
    Object.keys(config).some((key) => !['enabled', 'level', 'audio', 'matching'].includes(key))
  )
    throw new Error('Invalid rule setting')
  if (config.enabled !== undefined && typeof config.enabled !== 'boolean') throw new Error('Invalid enabled setting')
  if (config.level !== undefined && !['info', 'alert', 'alarm'].includes(config.level))
    throw new Error('Invalid alert level')
  if (config.audio !== undefined && !['tts', 'sound', 'none'].includes(config.audio))
    throw new Error('Invalid rule audio')
  if (config.matching) {
    if (Object.keys(config.matching).some((key) => !['type', 'netRegex'].includes(key)))
      throw new Error('Invalid matching override')
    compileMatcher(config.matching.type, config.matching.netRegex)
  }
}
