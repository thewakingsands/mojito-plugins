import { invalidTarget } from '../constants.js'
import type { CombatWorld } from '../world.js'

const isPlayer = (combatants: CombatWorld, id: number) => (combatants.get(id).classJob ?? 0) > 0

/** The player a combatant stands for: the owner of a pet, or the combatant; null when that is not a player */
export function playerOf(combatants: CombatWorld, id: number): number | null {
  const owner = combatants.get(id).ownerId ?? 0
  if (owner !== 0 && owner !== invalidTarget && isPlayer(combatants, owner)) return owner
  return isPlayer(combatants, id) ? id : null
}
