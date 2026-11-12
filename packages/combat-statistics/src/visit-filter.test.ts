import { describe, expect, it } from 'vitest'
import type { Member } from './log/types.js'
import { DEFAULT_QUERY, filtering, jobsOf, matchVisit, parseQuery, type VisitQuery } from './visit-filter.js'

const member = (actorId: number, job: number | null, name: string | null = `角色${actorId}`): Member => ({
  actorId,
  name,
  worldId: 1,
  job,
  jobName: null,
})
const visit = (
  members: Member[],
  zoneName: string | null = '某地',
  self: number | null = null,
  enteredAt = new Date(2026, 9, 21, 20).getTime(),
) => ({ zoneName, members, self, enteredAt })
const query = (patch: Partial<VisitQuery>): VisitQuery => ({ ...DEFAULT_QUERY, ...patch })

describe('jobsOf', () => {
  it('maps base classes to their jobs', () => {
    expect(jobsOf(19)).toEqual([19])
    expect(jobsOf(1)).toEqual([19])
    expect(jobsOf(6)).toEqual([24])
    expect(jobsOf(26)).toEqual([27, 28])
    expect(jobsOf(29)).toEqual([30])
  })
  it('gives nothing for null and unknown IDs', () => {
    expect(jobsOf(null)).toEqual([])
    expect(jobsOf(8)).toEqual([])
  })
})

describe('matchVisit', () => {
  const party = visit([member(1, 19), member(2, 24), member(3, 26)])

  it('with self only, matches when the own job is one of the chosen', () => {
    expect(matchVisit(party, null, query({ jobs: [19, 33] }), 1)).toBe(true)
    expect(matchVisit(party, null, query({ jobs: [28] }), 3)).toBe(true)
    expect(matchVisit(party, null, query({ jobs: [24] }), 1)).toBe(false)
  })
  it('with self only, does not match without the own character', () => {
    expect(matchVisit(party, null, query({ jobs: [19] }), null)).toBe(false)
    expect(matchVisit(party, null, query({ jobs: [19] }), 9)).toBe(false)
  })
  it('with self only, takes the user from the log before the logged-in character', () => {
    const recorded = visit(party.members, '某地', 1)
    expect(matchVisit(recorded, null, query({ jobs: [19] }), 3)).toBe(true)
    expect(matchVisit(recorded, null, query({ jobs: [27] }), 3)).toBe(false)
    expect(matchVisit(recorded, null, query({ jobs: [19] }), null)).toBe(true)
    expect(matchVisit(party, null, query({ jobs: [27] }), 3)).toBe(true)
  })
  it('with self only, does not fall back to the logged-in character when the recorded one is not a member', () => {
    expect(matchVisit(visit(party.members, '某地', 9), null, query({ jobs: [19] }), 1)).toBe(false)
  })
  it('without self only, needs every chosen job in the party, the user included', () => {
    const all = query({ jobs: [19, 24, 27], selfOnly: false })
    expect(matchVisit(party, null, all, 1)).toBe(true)
    expect(matchVisit(party, null, all, null)).toBe(true)
    expect(matchVisit(party, null, query({ jobs: [19, 33], selfOnly: false }), 1)).toBe(false)
  })
  it('ignores self only without chosen jobs', () => {
    expect(matchVisit(party, null, query({ selfOnly: true }), null)).toBe(true)
    expect(matchVisit(party, null, query({ selfOnly: false }), null)).toBe(true)
  })
  it('matches the duty against the shown name and the logged zone, ignoring case and spaces', () => {
    const logged = visit([member(1, 19)], 'The Aetherfont')
    expect(matchVisit(logged, '以太之源', query({ duty: ' 以太 ' }), null)).toBe(true)
    expect(matchVisit(logged, '以太之源', query({ duty: 'aetherFONT' }), null)).toBe(true)
    expect(matchVisit(logged, null, query({ duty: 'font' }), null)).toBe(true)
    expect(matchVisit(logged, '以太之源', query({ duty: '天穹' }), null)).toBe(false)
  })
  it('matches the character name of any member', () => {
    const named = visit([member(1, 19, 'Alice'), member(2, 24, 'Bob Stone')])
    expect(matchVisit(named, null, query({ character: ' stone' }), 1)).toBe(true)
    expect(matchVisit(named, null, query({ character: 'carol' }), 1)).toBe(false)
  })
  it('needs every condition', () => {
    const named = visit([member(1, 19, 'Alice'), member(2, 24, 'Bob')], '天穹街')
    expect(matchVisit(named, null, query({ jobs: [19], duty: '天穹', character: 'bob' }), 1)).toBe(true)
    expect(matchVisit(named, null, query({ jobs: [19], duty: '天穹', character: 'carol' }), 1)).toBe(false)
    expect(matchVisit(named, null, query({ jobs: [24], duty: '天穹', character: 'bob' }), 1)).toBe(false)
  })
  it('matches the date range with both ends included', () => {
    const party = visit([member(1, 19, 'Alice')])
    expect(matchVisit(party, null, query({ from: '2026-10-21' }), 1)).toBe(true)
    expect(matchVisit(party, null, query({ from: '2026-10-22' }), 1)).toBe(false)
    expect(matchVisit(party, null, query({ to: '2026-10-21' }), 1)).toBe(true)
    expect(matchVisit(party, null, query({ to: '2026-10-20' }), 1)).toBe(false)
    expect(matchVisit(party, null, query({ from: '2026-10-21', to: '2026-10-21' }), 1)).toBe(true)
  })
  it('dates a visit by the local day it was entered on', () => {
    const late = visit([member(1, 19)], '某地', null, new Date(2026, 9, 21, 23, 59).getTime())
    expect(matchVisit(late, null, query({ to: '2026-10-21' }), 1)).toBe(true)
    expect(matchVisit(late, null, query({ from: '2026-10-22' }), 1)).toBe(false)
  })
  it('needs the other conditions along with the date', () => {
    const named = visit([member(1, 19, 'Alice')])
    expect(matchVisit(named, null, query({ from: '2026-10-21', character: 'bob' }), 1)).toBe(false)
  })
})

it('filtering ignores self only', () => {
  expect(filtering(DEFAULT_QUERY)).toBe(false)
  expect(filtering(query({ selfOnly: false }))).toBe(false)
  expect(filtering(query({ jobs: [19] }))).toBe(true)
  expect(filtering(query({ duty: 'a' }))).toBe(true)
  expect(filtering(query({ character: 'a' }))).toBe(true)
  expect(filtering(query({ from: '2026-10-21' }))).toBe(true)
  expect(filtering(query({ to: '2026-10-21' }))).toBe(true)
})

describe('parseQuery', () => {
  it('keeps known jobs and trims the text', () => {
    expect(
      parseQuery({ jobs: [19, 1, 999, 19], selfOnly: false, duty: ' a ', character: 'b ', from: null, to: null }),
    ).toEqual({ jobs: [19], selfOnly: false, duty: 'a', character: 'b', from: null, to: null })
  })
  it('accepts real dates and swaps a reversed range', () => {
    expect(parseQuery({ ...DEFAULT_QUERY })).toEqual(DEFAULT_QUERY)
    expect(parseQuery({ ...DEFAULT_QUERY, from: '2026-10-07', to: '2026-10-01' })).toEqual(
      query({ from: '2026-10-01', to: '2026-10-07' }),
    )
  })
  it('refuses malformed and nonexistent dates', () => {
    expect(parseQuery({ ...DEFAULT_QUERY, from: '2026-2-1' })).toBeNull()
    expect(parseQuery({ ...DEFAULT_QUERY, from: '2026-02-30' })).toBeNull()
    expect(parseQuery({ ...DEFAULT_QUERY, from: 20261021 })).toBeNull()
    const { from: _, ...missing } = DEFAULT_QUERY
    expect(parseQuery(missing)).toBeNull()
  })
  it('refuses fields of the wrong type', () => {
    expect(parseQuery(null)).toBeNull()
    expect(parseQuery({ ...DEFAULT_QUERY, jobs: ['19'] })).toBeNull()
    expect(parseQuery({ ...DEFAULT_QUERY, selfOnly: 'yes' })).toBeNull()
    expect(parseQuery({ ...DEFAULT_QUERY, duty: 1 })).toBeNull()
    expect(parseQuery({ jobs: [], selfOnly: true, duty: '' })).toBeNull()
  })
})
