import { useEffect, useState } from 'react'
import { type Role, roleOf } from '../jobs.js'
import { useBridge } from './bridge.js'

// Icons stay for the life of the page; a fight shows a few dozen at most. `cache` shares one request per key;
// `loaded` holds the settled ones so a component that mounts or switches to them draws the icon in its first render
// instead of an empty frame, which a scrolling timeline would show as flicker. A failed request is kept in neither, so
// the next view asks again once the game data is open.
const cache = new Map<string, Promise<string | null>>()
const loaded = new Map<string, string | null>()

function useIcon(key: string | null): string | null {
  const { command } = useBridge()
  const [state, setState] = useState<{ key: string; url: string | null } | null>(null)
  useEffect(() => {
    if (key === null || loaded.has(key)) return
    let live = true
    let pending = cache.get(key)
    if (!pending) {
      pending = command({ kind: 'icon', key }).then(
        (value) => {
          const icon = value as { mime: string; data: Uint8Array } | null
          const result = icon ? URL.createObjectURL(new Blob([icon.data as BlobPart], { type: icon.mime })) : null
          loaded.set(key, result)
          return result
        },
        () => {
          cache.delete(key)
          return null
        },
      )
      cache.set(key, pending)
    }
    void pending.then((result) => {
      if (live) setState({ key, url: result })
    })
    return () => {
      live = false
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

/** The game's skill icon; without it the space stays empty so the names line up. */
export function SkillIcon({ skill }: { skill: string }) {
  const url = useIcon(skill)
  return url ? <img className="icon" src={url} alt="" /> : <span className="icon" />
}
