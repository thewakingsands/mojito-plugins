// Index zero is the game’s adventurer row, which has no job icon.
export const jobs = [
  '',
  'GLA',
  'PGL',
  'MRD',
  'LNC',
  'ARC',
  'CNJ',
  'THM',
  'CRP',
  'BSM',
  'ARM',
  'GSM',
  'LTW',
  'WVR',
  'ALC',
  'CUL',
  'MIN',
  'BTN',
  'FSH',
  'PLD',
  'MNK',
  'WAR',
  'DRG',
  'BRD',
  'WHM',
  'BLM',
  'ACN',
  'SMN',
  'SCH',
  'ROG',
  'NIN',
  'MCH',
  'DRK',
  'AST',
  'SAM',
  'RDM',
  'BLU',
  'GNB',
  'DNC',
  'RPR',
  'SGE',
  'VPR',
  'PCT',
  'BST',
]
const aliases = new Map([
  ['GLD', 'GLA'],
  ['PUG', 'PGL'],
  ['BOT', 'BTN'],
  ['LWR', 'LTW'],
])
const cache = new Map()

export function jobId(abbreviation) {
  const code = abbreviation.toUpperCase()
  return jobs.indexOf(aliases.get(code) ?? code)
}

export function loadJobIcon(id) {
  if (id < 1 || !window.OverlayPluginApi) return Promise.resolve(null)
  let pending = cache.get(id)
  if (!pending) {
    pending = new Promise((resolve) => {
      window.OverlayPluginApi.callHandler(JSON.stringify({ call: 'getGameIcon', type: 'job', id }), resolve)
    })
      .then(JSON.parse)
      .catch(() => null)
      .then((result) => {
        if (typeof result === 'string') return result
        cache.delete(id)
        return null
      })
    cache.set(id, pending)
  }
  return pending
}
