import type { Value } from '@ffcafe/mojito-plugin-sdk'
import type { VisitEntry } from './log/types.js'

/** The conditions the visit list is filtered by; an empty one does not filter. */
export interface VisitQuery {
  /** Jobs by ClassJob ID */
  jobs: number[]
  /** With jobs chosen: the user's own job is one of them; otherwise all of them are in the party */
  selfOnly: boolean
  duty: string
  character: string
}
export const DEFAULT_QUERY: VisitQuery = { jobs: [], selfOnly: true, duty: '', character: '' }

export const JOB_GROUPS: { label: string; jobs: { id: number; name: string }[] }[] = [
  {
    label: '防护',
    jobs: [
      { id: 19, name: '骑士' },
      { id: 21, name: '战士' },
      { id: 32, name: '暗黑骑士' },
      { id: 37, name: '绝枪战士' },
    ],
  },
  {
    label: '治疗',
    jobs: [
      { id: 24, name: '白魔法师' },
      { id: 28, name: '学者' },
      { id: 33, name: '占星术士' },
      { id: 40, name: '贤者' },
    ],
  },
  {
    label: '近战',
    jobs: [
      { id: 20, name: '武僧' },
      { id: 22, name: '龙骑士' },
      { id: 30, name: '忍者' },
      { id: 34, name: '武士' },
      { id: 39, name: '钐镰客' },
      { id: 41, name: '蝰蛇剑士' },
    ],
  },
  {
    label: '远程物理',
    jobs: [
      { id: 23, name: '吟游诗人' },
      { id: 31, name: '机工士' },
      { id: 38, name: '舞者' },
    ],
  },
  {
    label: '魔法',
    jobs: [
      { id: 25, name: '黑魔法师' },
      { id: 27, name: '召唤师' },
      { id: 35, name: '赤魔法师' },
      { id: 42, name: '绘灵法师' },
      { id: 36, name: '青魔法师' },
    ],
  },
]
const JOBS = new Set(JOB_GROUPS.flatMap((group) => group.jobs.map((job) => job.id)))
/** A base class counts as the jobs it becomes; Arcanist becomes both Summoner and Scholar. */
export const BASE_CLASSES: Record<number, number[]> = {
  1: [19],
  2: [20],
  3: [21],
  4: [22],
  5: [23],
  6: [24],
  7: [25],
  26: [27, 28],
  29: [30],
}

export function jobsOf(job: number | null): number[] {
  if (job === null) return []
  if (JOBS.has(job)) return [job]
  return BASE_CLASSES[job] ?? []
}

const contains = (text: string | null, part: string) => !!text?.toLowerCase().includes(part)

/** `displayName` is the name the list shows the visit by. */
export function matchVisit(
  entry: Pick<VisitEntry, 'zoneName' | 'members'>,
  displayName: string | null,
  query: VisitQuery,
  selfActorId: number | null,
): boolean {
  if (query.jobs.length) {
    if (query.selfOnly) {
      const self = selfActorId === null ? undefined : entry.members.find((member) => member.actorId === selfActorId)
      if (!self || !jobsOf(self.job).some((job) => query.jobs.includes(job))) return false
    } else {
      const present = new Set(entry.members.flatMap((member) => jobsOf(member.job)))
      if (!query.jobs.every((job) => present.has(job))) return false
    }
  }
  const duty = query.duty.trim().toLowerCase()
  if (duty && !contains(displayName, duty) && !contains(entry.zoneName, duty)) return false
  const character = query.character.trim().toLowerCase()
  if (character && !entry.members.some((member) => contains(member.name, character))) return false
  return true
}

/** Whether the list shows search results; "self only" alone filters nothing. */
export const filtering = (query: VisitQuery) =>
  query.jobs.length > 0 || query.duty.trim() !== '' || query.character.trim() !== ''

export function parseQuery(value: Value): VisitQuery | null {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value instanceof Uint8Array) return null
  const { jobs, selfOnly, duty, character } = value as Record<string, Value>
  if (
    !Array.isArray(jobs) ||
    jobs.some((job) => typeof job !== 'number') ||
    typeof selfOnly !== 'boolean' ||
    typeof duty !== 'string' ||
    typeof character !== 'string'
  )
    return null
  return {
    jobs: [...new Set(jobs as number[])].filter((job) => JOBS.has(job)),
    selfOnly,
    duty: duty.trim(),
    character: character.trim(),
  }
}
