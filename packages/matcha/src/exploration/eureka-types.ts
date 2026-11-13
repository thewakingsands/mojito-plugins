import type { ExplorationContext } from './types.js'

interface FateObservationBase {
  fateId: number
  packetSeq: number
  timestamp: number
}

export type FateObservation = FateObservationBase &
  (
    | { kind: 'start' }
    | { kind: 'progress'; progress: number }
    | { kind: 'end'; extra: number }
    | { kind: 'info'; startTimeSeconds: number; durationSeconds: number; serverToSourceOffsetMs?: number }
  )

export interface WeatherRate {
  weatherId: number
  rate: number
}

export interface EurekaCatalog {
  mapId: number | null
  fates: { id: number; name: string; position: { mapId: number; x: number; y: number } | null }[]
  weatherRates: WeatherRate[] | null
  weatherNames: ReadonlyMap<number, string>
}

export interface ConditionWindow {
  opensAt: number
  closesAt: number | null
}

export interface EurekaEntry {
  fateId: number
  name: string
  position: { mapId: number; x: number; y: number } | null
  activity: 'unknown' | 'active' | 'ended' | 'unconfirmed'
  progress: number | null
  activityEndsAt: number | null
  cooldown: {
    basis: 'fate-start' | 'first-observed' | null
    referenceAt: number | null
    durationMs: number | null
    readyAt: number | null
  }
  conditions: {
    weatherId: number | null
    weatherName: string | null
    nightOnly: boolean
    status: 'open' | 'waiting' | 'unknown'
    environmentWindow: ConditionWindow | null
    estimatedWindow: ConditionWindow | null
    otherConditionsUnknown: boolean
  }
}

export interface EurekaState {
  context: ExplorationContext
  status: 'ready' | 'outside' | 'waiting' | 'unavailable'
  reason: string | null
  mapId: number | null
  entries: EurekaEntry[]
}
