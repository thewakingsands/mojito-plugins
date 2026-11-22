import { expect, it } from 'vitest'
import catalog from '../fixtures/catalog.js'
import { dungeonAt, floorNote, note } from './data.js'
import { language, settings } from './state.js'

it('preserves raw notes, uses English for missing Chinese, and omits absent notes', () => {
  expect(note({ zhCN: ' 原文\n', en: 'English' }, 'zhCN')).toBe(' 原文\n')
  expect(note({ zhCN: ' ', en: '<em>English</em>\n' }, 'zhCN')).toBe('<em>English</em>\n')
  expect(note({}, 'zhCN')).toBeNull()
  expect(note({ zhCN: '中文' }, 'en')).toBeNull()
  expect([...catalog.monsters[0].notes.zhCN!]).toHaveLength(897)
})
it('resolves manual floor redirects within the dungeon and terminates cycles', () => {
  expect(floorNote(catalog, catalog.floors[1], 'zhCN')).toBe(catalog.floors[0].notes.zhCN)
  const loop = { dungeon: 'PotD' as const, key: 'loop', redirect: 'loop', notes: {} }
  expect(floorNote({ ...catalog, floors: [loop] }, loop, 'en')).toBeNull()
  expect(dungeonAt(catalog, 900002)).toBe('PotD')
  expect(dungeonAt(catalog, 10)).toBeNull()
})
it('only persists supported guide languages', () => {
  expect(settings({ language: 'auto', extra: 1 })).toEqual({ language: 'auto' })
  expect(settings({ language: 'chs' })).toBeNull()
  expect(language({ language: 'auto' }, 'zh-CN')).toBe('zhCN')
  expect(language({ language: 'auto' }, 'en')).toBe('en')
  expect(language({ language: 'en' }, 'zh-CN')).toBe('en')
})
