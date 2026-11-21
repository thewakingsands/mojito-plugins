import type { CombatantField, CombatantState, Disposer, Field, PluginContext, Value } from '@ffcafe/mojito-plugin-sdk'
import { check, fields, object } from '@ffcafe/mojito-plugin-sdk/schema'

const numericFields = {
  Job: 'classJob',
  Level: 'level',
  CurrentHP: 'hpCur',
  MaxHP: 'hpMax',
  CurrentMP: 'mpCur',
  MaxMP: 'mpMax',
  Heading: 'rotation',
  BNpcID: 'bNpcBase',
  BNpcNameID: 'bNpcName',
  Type: 'objectKind',
} as const
const selection: CombatantField[] = [
  'name',
  ...Object.values(numericFields),
  'position',
  'ownerId',
  'targetId',
  'homeWorldId',
  'currentWorldId',
]
function known<T>(field: Field<T> | undefined): T | undefined {
  return field?.state === 'ok' ? field.value : undefined
}
function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}
function worldId(field: CombatantState['homeWorldId']) {
  const value = known(field)
  return finite(value) && value !== 0xfffe && value !== 0xffff ? value : undefined
}

export async function registerCombatants(ctx: PluginContext, channel: string): Promise<Disposer> {
  return ctx.views.onCommand(`${channel}/combatants`, async (input): Promise<Value> => {
    let ids: number[] = [],
      names: string[] = [],
      props: string[] = []
    try {
      const value = object(input)
      fields(value, ['ids', 'names', 'props'], [])
      for (const key of ['ids', 'names', 'props']) {
        if (value[key] === undefined) continue
        const items = value[key]
        check(Array.isArray(items), 'Expected array')
        check(
          items.every((item) =>
            key === 'ids'
              ? typeof item === 'number' && Number.isInteger(item) && item >= 0 && item <= 0xffffffff
              : typeof item === 'string',
          ),
          'Invalid query member',
        )
      }
      ids = (value.ids as number[] | undefined) ?? []
      names = ((value.names as string[] | undefined) ?? []).map((name) => name.toLowerCase())
      props = (value.props as string[] | undefined) ?? []
    } catch {
      return { error: 'invalid_argument' }
    }
    try {
      const sample = await ctx.game.getCombatants({
        fields: selection,
        ...(ids.length && !names.length ? { ids } : {}),
      })
      const seen = new Set<number>()
      const entities = sample.value.entities.filter((entity) => {
        const name = known(entity.name)
        if (
          seen.has(entity.id) ||
          (ids.length + names.length > 0 &&
            !ids.includes(entity.id) &&
            !(typeof name === 'string' && names.includes(name.toLowerCase())))
        )
          return false
        seen.add(entity.id)
        return true
      })
      const worlds = new Map<number, string>()
      if (
        (!props.length || props.includes('WorldName')) &&
        ctx.capabilities.get()['data.read']?.state === 'available'
      ) {
        const ids = [...new Set(entities.map((entity) => worldId(entity.homeWorldId)).filter((id) => id !== undefined))]
        if (ids.length) {
          try {
            // World is language-neutral. Its display name follows InternalName in the raw row.
            for (const row of await ctx.data.rows('World', ids, 'none')) {
              const name = row.subrows[0]?.cells[1]
              if (name?.type === 'string' && name.value.length) worlds.set(row.rowId, name.value)
            }
          } catch (error) {
            if (
              !error ||
              typeof error !== 'object' ||
              !('code' in error) ||
              !['unavailable', 'not_found'].includes(String(error.code))
            )
              throw error
          }
        }
      }
      const session = await ctx.session.get()
      if (
        session.state === 'idle' ||
        sample.meta.sessionId !== session.sessionId ||
        sample.meta.characterGeneration !== session.characterGeneration ||
        sample.meta.source !== session.state ||
        sample.meta.clockGeneration !== session.clock.generation
      )
        return { error: 'unavailable' }
      return {
        combatants: entities.map((entity) => {
          const result: Record<string, Value> = { ID: entity.id }
          const name = known(entity.name)
          if (typeof name === 'string') result.Name = name
          for (const [target, source] of Object.entries(numericFields)) {
            const value = known(entity[source])
            if (finite(value)) result[target] = value
          }
          const position = known(entity.position)
          if (position && [position.x, position.y, position.z].every(finite)) {
            result.PosX = position.x
            result.PosY = position.z
            result.PosZ = position.y
          }
          for (const [target, field] of [
            ['OwnerID', entity.ownerId],
            ['TargetID', entity.targetId],
          ] as const) {
            const value = known(field)
            if (value === null || finite(value)) result[target] = value ?? 0
          }
          const home = worldId(entity.homeWorldId),
            current = worldId(entity.currentWorldId)
          if (home !== undefined) {
            result.WorldID = home
            const name = worlds.get(home)
            if (name !== undefined) result.WorldName = name
          }
          if (current !== undefined) result.CurrentWorldID = current
          return props.length
            ? Object.fromEntries(Object.entries(result).filter(([key]) => props.includes(key)))
            : result
        }),
      }
    } catch {
      return { error: 'unavailable' }
    }
  })
}
