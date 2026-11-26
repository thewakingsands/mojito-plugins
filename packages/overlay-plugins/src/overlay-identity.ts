import type { OverlayState } from '@ffcafe/mojito-plugin-sdk/overlayplugin'

export function maskOverlayIdentity(state: OverlayState, selfId: number | null): OverlayState {
  const combatData = state.combatData
  const combatants = Object.entries(combatData?.Combatant ?? {}).map(([key, row], index) => {
    if (key === 'YOU' || key === 'Limit Break') return [key, { ...row, name: key }]
    const suffix = /@[^@]+ \[([\da-f]+)\]$/i.exec(key)
    const id = suffix ? Number.parseInt(suffix[1], 16) : null
    if (id !== null && (id < 0x10000000 || id > 0x1fffffff)) return [key, row]
    const name = `Player ${index + 1}`
    return [name, { ...row, name }]
  })
  return {
    ...state,
    primaryPlayer: state.primaryPlayer && { id: selfId ?? 0, name: 'Player' },
    combatData: combatData && { ...combatData, Combatant: Object.fromEntries(combatants) },
  }
}
