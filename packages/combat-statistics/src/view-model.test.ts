import { expect, it } from 'vitest'
import { skillCaster, skillId } from './view-model.js'

it('reads the action of a skill key of the limit break row, and who used it', () => {
  expect(skillId('action:200@s:0:16')).toEqual({ kind: 'action', id: 200 })
  expect(skillCaster('action:200@s:0:16')).toBe('s:0:16')
  expect(skillId('action:200')).toEqual({ kind: 'action', id: 200 })
  expect(skillCaster('action:200')).toBeNull()
})
