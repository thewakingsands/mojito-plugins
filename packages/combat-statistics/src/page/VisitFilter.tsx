import { type KeyboardEvent, useId, useState } from 'react'
import { DEFAULT_QUERY, JOB_GROUPS, type VisitQuery } from '../visit-filter.js'
import { useBridge } from './bridge.js'
import { JobIcon } from './icons.js'

const JOB_NAMES = new Map(JOB_GROUPS.flatMap((group) => group.jobs.map((job) => [job.id, job.name] as const)))

/**
 * The conditions in effect, shown beside the title while the panel is closed. Dates drop the year when all of them are
 * in `year`, so that a full range fits the side bar.
 */
export function querySummary(query: VisitQuery, year = new Date().getFullYear()) {
  const parts: string[] = []
  if (query.duty) parts.push(`副本：${query.duty}`)
  if (query.character) parts.push(`角色：${query.character}`)
  const dates = [query.from, query.to].filter((date) => date !== null)
  if (dates.length) {
    const prefix = `${year}-`
    const short = dates.every((date) => date.startsWith(prefix))
    const show = (date: string) => (short ? date.slice(prefix.length) : date)
    const { from, to } = query
    if (from !== null && to !== null)
      parts.push(from === to ? `日期：${show(from)}` : `日期：${show(from)} 至 ${show(to)}`)
    else if (from !== null) parts.push(`日期：${show(from)} 起`)
    else if (to !== null) parts.push(`日期：至 ${show(to)}`)
  }
  if (query.jobs.length) {
    const names = query.jobs.map((job) => JOB_NAMES.get(job) ?? String(job))
    parts.push(query.selfOnly ? `自己：${names.join('/')}` : `队伍：${names.join('+')}`)
  }
  return parts.join(' · ') || '未筛选'
}

/** Without the game's icon, the first character of the name stands in for it. */
const Job = ({ id }: { id: number }) => <JobIcon job={id} abbreviation={JOB_NAMES.get(id)?.slice(0, 1)} />

/**
 * The filter and search panel, a <details> that opens like the host's collapsible sections; changes take effect on
 * 搜索 or Enter only. The job picker is a popover: the browser places it under its button and closes it on Esc or a
 * click outside.
 */
export function VisitFilter({ query }: { query: VisitQuery }) {
  const { command } = useBridge()
  const [draft, setDraft] = useState(query)
  const [applied, setApplied] = useState(query)
  const picker = useId()
  // Every publication carries a new object, so only a different query replaces what is being typed.
  if (JSON.stringify(applied) !== JSON.stringify(query)) {
    setApplied(query)
    setDraft(query)
  }
  const apply = (next: VisitQuery) => {
    setDraft(next)
    void command({ kind: 'visits', query: next, page: 0 })
  }
  const onEnter = (event: KeyboardEvent) => {
    if (event.key === 'Enter') apply(draft)
  }
  const toggleJob = (id: number) =>
    setDraft((current) => ({
      ...current,
      jobs: current.jobs.includes(id) ? current.jobs.filter((job) => job !== id) : [...current.jobs, id],
    }))
  const summary = querySummary(query)
  return (
    <details className="visit-filter">
      <summary>
        <span>筛选和搜索</span>
        <span className="visit-filter-summary ellipsis" title={summary}>
          {summary}
        </span>
      </summary>
      <div className="visit-filter-body">
        <label className="visit-filter-field">
          <span>副本名</span>
          <input
            type="text"
            value={draft.duty}
            onChange={(event) => setDraft({ ...draft, duty: event.target.value })}
            onKeyDown={onEnter}
          />
        </label>
        <label className="visit-filter-field">
          <span>角色名</span>
          <input
            type="text"
            value={draft.character}
            onChange={(event) => setDraft({ ...draft, character: event.target.value })}
            onKeyDown={onEnter}
          />
        </label>
        <div className="visit-filter-row visit-filter-dates">
          <span>从</span>
          <input
            type="date"
            aria-label="开始日期"
            value={draft.from ?? ''}
            onChange={(event) => setDraft({ ...draft, from: event.target.value || null })}
            onKeyDown={onEnter}
          />
        </div>
        <div className="visit-filter-row visit-filter-dates">
          <span>到</span>
          <input
            type="date"
            aria-label="结束日期"
            value={draft.to ?? ''}
            onChange={(event) => setDraft({ ...draft, to: event.target.value || null })}
            onKeyDown={onEnter}
          />
        </div>
        <div className="visit-filter-row">
          <button type="button" className="job-picker-button" aria-haspopup="dialog" popoverTarget={picker}>
            {draft.jobs.length ? (
              <>
                <span>职业：</span>
                <span className="job-picker-icons">
                  {draft.jobs.map((job) => (
                    <Job key={job} id={job} />
                  ))}
                </span>
              </>
            ) : (
              '职业：全部'
            )}
          </button>
          <div id={picker} className="job-picker" popover="auto" role="dialog" aria-label="选择职业">
            {JOB_GROUPS.map((group) => (
              <div key={group.label}>
                <h3>{group.label}</h3>
                <div className="job-picker-grid">
                  {group.jobs.map((job) => (
                    <button
                      key={job.id}
                      type="button"
                      aria-pressed={draft.jobs.includes(job.id)}
                      onClick={() => toggleJob(job.id)}
                    >
                      <span aria-hidden="true">
                        <Job id={job.id} />
                      </span>
                      {job.name}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <div className="job-picker-foot">
              <button type="button" onClick={() => setDraft({ ...draft, jobs: [] })}>
                清空
              </button>
            </div>
          </div>
          {/* The same words as the summary's 自己：… and 队伍：…, so the choice needs no explanation */}
          <fieldset className="mojito-segmented" aria-label="职业条件">
            <button type="button" aria-pressed={draft.selfOnly} onClick={() => setDraft({ ...draft, selfOnly: true })}>
              自己
            </button>
            <button
              type="button"
              aria-pressed={!draft.selfOnly}
              onClick={() => setDraft({ ...draft, selfOnly: false })}
            >
              队伍
            </button>
          </fieldset>
        </div>
        <div className="visit-filter-actions">
          <button type="button" onClick={() => apply(DEFAULT_QUERY)}>
            重置
          </button>
          <button type="button" data-variant="primary" onClick={() => apply(draft)}>
            搜索
          </button>
        </div>
      </div>
    </details>
  )
}
