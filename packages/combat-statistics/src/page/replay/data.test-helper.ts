import { roleOf } from '../../jobs.js'
import { ENTRY_FIELDS, type EntryField, type ReplayActor, type ReplayData, type Track } from '../../view-model.js'

/** A track from [t, x, z, rotation, hp] samples */
export function track(samples: [number, number, number, number?, number?][] = []): Track {
  return {
    t: Uint32Array.from(samples, ([t]) => t),
    x: Float32Array.from(samples, ([, x]) => x),
    z: Float32Array.from(samples, ([, , z]) => z),
    rotation: Float32Array.from(samples, ([, , , rotation = 0]) => rotation),
    hp: Float32Array.from(samples, ([, , , , hp = 1]) => hp),
  }
}
export const member = (index: number, job: number, name = `成员${index}`, samples?: Track): ReplayActor => ({
  index,
  key: `actor:${index}`,
  name,
  kind: 'member',
  owner: null,
  main: false,
  job,
  role: roleOf(job),
  track: samples ?? track(),
})
export const pet = (index: number, owner: number): ReplayActor => ({
  index,
  key: `actor:${index}`,
  name: `宠物${index}`,
  kind: 'pet',
  owner,
  main: false,
  job: null,
  role: null,
  track: track(),
})
export const limitBreak = (index: number): ReplayActor => ({
  index,
  key: 'limit-break',
  name: null,
  kind: 'limitBreak',
  owner: null,
  main: false,
  job: null,
  role: null,
  track: track(),
})
export const enemy = (index: number, main = false, samples?: Track): ReplayActor => ({
  index,
  key: `actor:${index}`,
  name: `敌人${index}`,
  kind: 'enemy',
  owner: null,
  main,
  job: null,
  role: null,
  track: samples ?? track(),
})
export interface EntryInput {
  t: number
  actor: number
  other?: number
  skill: string
  field: EntryField
  amount: number
  hit?: number
}
/** Review data from plain lists; the entries refer to their skills by key */
export function replayData(
  input: Partial<Omit<ReplayData, 'entries' | 'skills'>> & { actors: ReplayActor[]; entries?: EntryInput[] },
): ReplayData {
  const list = input.entries ?? []
  const skills = [...new Set(list.map((entry) => entry.skill))]
  const { entries: _, ...rest } = input
  return {
    fight: { visitId: 'v', fightId: 'f', durationMs: 100_000 },
    casts: [],
    uses: { t: new Uint32Array(), actor: new Uint16Array(), action: new Uint16Array() },
    actions: [],
    statuses: [],
    statusInfo: [],
    events: [],
    potency: [],
    casters: {},
    ...rest,
    skills,
    entries: {
      t: Uint32Array.from(list, (entry) => entry.t),
      actor: Uint16Array.from(list, (entry) => entry.actor),
      other: Int32Array.from(list, (entry) => entry.other ?? -1),
      skill: Uint16Array.from(list, (entry) => skills.indexOf(entry.skill)),
      field: Uint8Array.from(list, (entry) => ENTRY_FIELDS.indexOf(entry.field)),
      hit: Uint8Array.from(list, (entry) => entry.hit ?? 0),
      amount: Float64Array.from(list, (entry) => entry.amount),
    },
  }
}
