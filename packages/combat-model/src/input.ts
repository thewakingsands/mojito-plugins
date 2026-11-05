/**
 * The inputs of CombatEngine, independent of where the log came from. An actor id of null is an id the packet did not
 * give a valid value. time is the timestamp of the packet in milliseconds; inputs come in the order they happened.
 */
export type CombatInput =
  | { type: 'actor'; time: number; actorId: number; classJob: number; level: number; ownerId: number | null }
  | { type: 'effect'; time: number; caster: number | null; action: number; sequence: number; targets: EffectTarget[] }
  | { type: 'statuses'; time: number; holder: number | null; slots: SlotContent[]; changes: StatusChange[] }
  | { type: 'statusList'; time: number; holder: number | null; statuses: { id: number; source: number | null }[] }
  | {
      type: 'tick'
      time: number
      target: number | null
      isHeal: boolean
      /** 0 for a tick that sums every effect on the target */
      status: number
      amount: number
      /** Who applied the status; when status is 0, not the one who applied any of them */
      source: number | null
    }
  | { type: 'gauge'; time: number; actor: number; gauge: JobGaugeState | null }
  | { type: 'playerStats'; time: number; actor: number; criticalHit: number; directHit: number }
  | { type: 'death'; time: number; actor: number | null }
  /** A cast that started or was cancelled; it keeps the window of damage open as an effect does */
  | { type: 'cast'; time: number; caster: number | null; action: number }
  | {
      type: 'zone'
      time: number
      territory: number
      /** The receiver of the packet of the change: the player, who keeps the statuses */
      receiver: number
    }

/** The gauge of the player; only that of the black mage is read */
export interface JobGaugeState {
  job: string
  elementStance: number
  enochianActive: boolean
}

export type HitResult = 'damage' | 'blocked' | 'parried' | 'heal'

export interface EffectTarget {
  id: number | null
  /** The position of the target among the targets of the effect */
  index: number
  /** Only the damage and heal entries; the caller leaves out the others */
  hits: {
    result: HitResult
    amount: number
    critical: boolean
    direct: boolean
    bonusPercent: number
    /** The effect works on the caster; the attribution leaves it out */
    onSource: boolean
  }[]
  /** The statuses the effect applies, from parseStatusEntries */
  applied: AppliedStatus[]
}

/** A status an effect applied, with byte 1 and byte 2 of its entry */
export interface AppliedStatus {
  status: number
  /** The status goes on the caster rather than on the target */
  onSource: boolean
  byte1: number
  byte2: number
}

export interface SlotContent {
  slot: number
  /** null for a slot that was cleared */
  status: { id: number; source: number | null; stacks: number } | null
}

/** A status that came or left. A status that was refreshed leaves first, then comes again. */
export interface StatusChange {
  kind: 'gained' | 'lost'
  slot: number
  status: number
  source: number | null
}
