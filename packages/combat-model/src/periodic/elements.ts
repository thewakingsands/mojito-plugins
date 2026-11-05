import {
  type ElementChange,
  type ElementChangeTable,
  type ElementRules,
  type GaugeCondition,
  valueAt,
} from '../defs.js'
import type { JobGaugeState } from '../input.js'
import type { CombatWorld } from '../world.js'

export type ElementState = GaugeCondition<'BlackMage'>

/**
 * The elements of every black mage: inferred from the actions they use, and read from the gauge of the recording
 * player once a GaugeEvent of the zone came. Unknown until an action sets them.
 */
export class ElementTracker {
  /** The inferred elementStance of each caster; a caster without an entry is unknown */
  private inferred = new Map<number, number>()
  /** The last gauge of the recording player in this zone */
  private gauge: { combatant: number; state: ElementState } | null = null
  private changes: ReadonlyMap<number, ElementChangeTable>

  constructor(
    private rules: ElementRules,
    private combatants: CombatWorld,
  ) {
    this.changes = new Map(rules.actions.map((item) => [item.id, item.change]))
  }

  /** Whether the class of the combatant keeps elements */
  hasElements(combatant: number): boolean {
    const classJob = this.combatants.get(combatant).classJob ?? 0
    return this.rules.classJobs.includes(classJob)
  }

  /** The state the effects of the caster read now; null when it is unknown or the class keeps no elements */
  stateOf(caster: number): ElementState | null {
    if (!this.hasElements(caster)) return null
    if (this.gauge?.combatant === caster) return this.gauge.state
    return this.inferredOf(caster)
  }

  /** The state inferred from the actions, also for the recording player */
  inferredOf(caster: number): ElementState | null {
    if (!this.hasElements(caster)) return null
    const elementStance = this.inferred.get(caster)
    if (elementStance === undefined) return null
    const level = this.combatants.get(caster).level ?? 0
    return {
      job: 'BlackMage',
      elementStance,
      enochianActive: elementStance !== 0 && level >= this.rules.enochianLevel,
    }
  }

  /** Changes the elements of the caster after the effect of the action is computed */
  applyAction(caster: number, action: number): void {
    const table = this.changes.get(action)
    if (!table || !this.hasElements(caster)) return
    const level = this.combatants.get(caster).level ?? 0
    const max = valueAt(this.rules.maxStacks, level)
    const change = changeAt(table, level)
    const stance = this.inferred.get(caster)
    const next = nextStance(change, stance, max)
    if (next === undefined) this.inferred.delete(caster)
    else this.inferred.set(caster, next)
  }

  /** A caster who died has no elements */
  death(combatant: number): void {
    if (this.hasElements(combatant)) this.inferred.set(combatant, 0)
  }

  /** The gauge of the recording player */
  handleGauge(combatant: number, gauge: JobGaugeState | null): void {
    if (gauge?.job !== 'BlackMage') return
    const { elementStance, enochianActive } = gauge
    this.gauge = { combatant, state: { job: 'BlackMage', elementStance, enochianActive } }
  }

  /** Every state is unknown in a new zone, that of the recording player too */
  changeZone(): void {
    this.inferred.clear()
    this.gauge = null
  }
}

/** The change at the level, the last one at or below it; the last one at an unknown level */
function changeAt(table: ElementChangeTable, level: number): ElementChange {
  if (level < 1) return table[table.length - 1].change
  let found = table[0]
  for (const entry of table) if (entry.level <= level) found = entry
  return found.change
}

/** @returns The elementStance after the change; undefined while it stays unknown */
function nextStance(change: ElementChange, stance: number | undefined, max: number): number | undefined {
  if (change.kind === 'set') {
    const stacks = change.stacks === 'max' ? max : Math.min(change.stacks, max)
    return change.element === 'astralFire' ? stacks : -stacks
  }
  if (stance === undefined) return undefined
  switch (change.kind) {
    case 'fire':
      if (stance < 0) return 0
      return Math.min(stance + 1, max)
    case 'ice':
      if (stance > 0) return 0
      return Math.max(stance - 1, -max)
    case 'fireSwitch':
      return stance < 0 ? 1 : Math.min(stance + 1, max)
    case 'iceSwitch':
      return stance > 0 ? -1 : Math.max(stance - 1, -max)
    case 'umbralSoul':
      return stance < 0 ? Math.max(stance - 1, -max) : stance
    case 'transpose':
      if (stance === 0) return 0
      return stance > 0 ? -1 : 1
  }
}
