import { type ReactNode, useEffect, useState } from 'react'
import { type Role, roleOf } from '../jobs.js'
import { useBridge } from './bridge.js'

// Icons stay for the life of the page. `cache` shares one request per key; `loaded` holds the settled ones so a
// component that mounts or switches to them draws the icon in its first render instead of an empty frame, which a
// scrolling timeline would show as flicker. A failed request is kept in neither map; a component still showing its key
// asks again every RETRY_MS.
const RETRY_MS = 5000
const cache = new Map<string, Promise<string | null | undefined>>()
const loaded = new Map<string, string | null>()

/** The icon of a key; undefined when the request failed, null when the game data has none */
function request(command: ReturnType<typeof useBridge>['command'], key: string) {
  let pending = cache.get(key)
  if (pending) return pending
  pending = command({ kind: 'icon', key }).then(
    (value) => {
      const icon = value as { mime: string; data: Uint8Array } | null
      const result = icon ? URL.createObjectURL(new Blob([icon.data as BlobPart], { type: icon.mime })) : null
      loaded.set(key, result)
      return result
    },
    () => {
      cache.delete(key)
      return undefined
    },
  )
  cache.set(key, pending)
  return pending
}

function useIcon(key: string | null): string | null {
  const { command } = useBridge()
  const [state, setState] = useState<{ key: string; url: string | null } | null>(null)
  useEffect(() => {
    if (key === null || loaded.has(key)) return
    let live = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const ask = () => {
      if (loaded.has(key)) {
        setState({ key, url: loaded.get(key)! })
        return
      }
      void request(command, key).then((result) => {
        if (!live) return
        if (result === undefined) timer = setTimeout(ask, RETRY_MS)
        else setState({ key, url: result })
      })
    }
    ask()
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [command, key])
  if (key === null) return null
  if (loaded.has(key)) return loaded.get(key) ?? null
  return state?.key === key ? state.url : null
}

const ROLE_CLASS: Record<Role, string> = { tank: 'role-tank', healer: 'role-healer', dps: 'role-dps' }

/** The game's job icon; without it, the job abbreviation in the colors of its role. */
export function JobIcon({ job, abbreviation }: { job: number | null; abbreviation: string | undefined }) {
  const url = useIcon(job === null ? null : `job:${job}`)
  if (url) return <img className="icon" src={url} alt={abbreviation ?? ''} />
  const role = roleOf(job)
  if (!role || !abbreviation) return <span className="icon" />
  return <span className={`icon job-tag ${ROLE_CLASS[role]}`}>{abbreviation}</span>
}

/** Stands for the limit break in the review, where a member has the icon of their job */
export const LimitBreakIcon = () => <span className="icon job-tag limit-break">LB</span>

/** The game's skill icon; without it the fallback, or an empty space so the names line up. */
export function SkillIcon({ skill, fallback }: { skill: string; fallback?: ReactNode }) {
  const url = useIcon(skill)
  if (url) return <img className="icon" src={url} alt="" />
  return fallback ?? <span className="icon" />
}
