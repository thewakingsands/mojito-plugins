import type { CombatantState, DataService, Field } from '@ffcafe/mojito-plugin-sdk'
import { hex } from './format.js'

export function value<T>(field?: Field<T>): T | undefined {
  return field?.state === 'ok' ? field.value : undefined
}

export interface Actor {
  name?: string
  classJob?: number
  level?: number
  ownerId?: number | null
  homeWorldId?: number
  bNpcName?: number
  bNpcBase?: number
  hpCur?: number
  hpMax?: number
  mpCur?: number
  mpMax?: number
  position?: { x: number; y: number; z: number }
  rotation?: number
}

export const absentActor = 0xe0000000
export function coordinates(actor: Actor) {
  const p = actor.position
  return [p?.x, p?.z, p?.y, actor.rotation].map((n) => (n === undefined ? '' : n.toFixed(2)))
}
export function properties(actor: Actor) {
  return [actor.hpCur ?? '', actor.hpMax ?? '', actor.mpCur ?? '', actor.mpMax ?? '', '', '', ...coordinates(actor)]
}

export class Actors {
  private actors = new Map<number, Actor>()
  readonly present = new Set<number>()
  get(id: number | null): Actor {
    return id === null ? {} : (this.actors.get(id) ?? {})
  }
  update(id: number, change: Actor) {
    this.actors.set(id, { ...this.get(id), ...change })
  }
  forget(id: number) {
    this.actors.delete(id)
    this.present.delete(id)
  }
  reset() {
    this.actors.clear()
    this.present.clear()
  }

  observe(state: CombatantState) {
    const entry: Actor = {}
    for (const k of [
      'classJob',
      'level',
      'hpCur',
      'hpMax',
      'mpCur',
      'mpMax',
      'homeWorldId',
      'bNpcName',
      'bNpcBase',
      'rotation',
    ] as const)
      if (state[k]) entry[k] = value(state[k])
    if (state.name) entry.name = value(state.name)
    if (state.ownerId) entry.ownerId = value(state.ownerId)
    if (state.position) entry.position = value(state.position)
    this.update(state.id, entry)
  }
}

/** Names belong to the open data version and language of this recording. */
export class Names {
  private names = new Map<string, string>()
  private version?: string | null
  async beginBatch() {
    if (this.version !== undefined) await this.checkVersion()
  }
  private async checkVersion() {
    const next = await this.data.version()
    if (this.version !== undefined && this.version !== next) throw new Error('记录期间游戏数据版本发生变化')
    this.version = next
  }
  constructor(
    private data: DataService,
    readonly language: string,
  ) {}
  private async read(key: string, lookup: () => Promise<string>) {
    if (this.version === undefined) await this.checkVersion()
    let text = this.names.get(key)
    if (text === undefined) {
      text = await lookup()
      this.names.set(key, text)
    }
    return text
  }
  name(kind: Parameters<DataService['name']>[0], id: number) {
    if (!id) return Promise.resolve('')
    return this.read(`${kind}:${id}`, () => this.data.name(kind, id, this.language))
  }
  action(skill: number) {
    const type = Math.floor(skill / 0x1000000)
    if (type !== 2 && type !== 13) return this.name('action', skill)
    const sheet = type === 2 ? 'Item' : 'Mount',
      column = type === 2 ? 'Name' : 'Singular'
    return this.read(`${sheet}:${skill}`, async () => {
      const rows = await this.data.rows(sheet, [skill % 0x1000000], this.language, { columns: [column] })
      const cell = rows[0]?.subrows[0]?.cells[0]
      if (cell?.type !== 'string') throw new Error(`Missing ${sheet} name`)
      return cell.value
    })
  }
  world(id: number) {
    if (!id || id === 65535) return Promise.resolve('')
    return this.read(`World:${id}`, async () => {
      const rows = await this.data.rows('World', [id], this.language, { columns: ['Name'] })
      const name = rows[0]?.subrows[0]?.cells[0]
      if (name?.type !== 'string') throw new Error(`Missing World name for ${id}`)
      return name.value
    })
  }
  async map(id: number) {
    const rows = await this.data.rows('Map', [id], this.language, {
      columns: ['PlaceNameRegion', 'PlaceName', 'PlaceNameSub'],
    })
    const fields = rows[0]?.subrows[0]?.cells
    if (fields?.length !== 3) throw new Error(`Missing Map names for ${id}`)
    return Promise.all(
      fields.map((cell) => {
        if (cell.type !== 'number') throw new Error('Invalid Map place name')
        return this.name('placeName', cell.value)
      }),
    )
  }
  async combatant(id: number, a: Actor) {
    const world = a.homeWorldId ?? 0
    return [
      hex(id, 4),
      a.name ?? '',
      hex(a.classJob ?? 0, 2),
      hex(a.level ?? 0),
      hex(a.ownerId === absentActor ? 0 : (a.ownerId ?? 0), 4),
      hex(world, 2),
      await this.world(world),
      a.bNpcName ?? 0,
      a.bNpcBase ?? 0,
      a.hpCur ?? 0,
      a.hpMax ?? 0,
      a.mpCur ?? 0,
      a.mpMax ?? 0,
      '',
      '',
      ...coordinates(a),
    ]
  }
}
