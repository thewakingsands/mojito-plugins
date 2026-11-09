export interface FishingAttributes {
  sampledAt: number
  gathering: number | null
  perception: number | null
  currentGp: number | null
  maxGp: number | null
  baitId: number | null
  unavailable?: string
}
export interface FishingCapture {
  serverCastTime: number | null
  hook: number | null
  size: number | null
  quantity: number | null
  large: boolean | null
  gatheringFailed: boolean
  unsupported: boolean
  terminal: boolean
  patiencePrecision: boolean | null
  patienceSuccess: boolean | null
  slap: number
  identical: number
  hidden: number
  hiddenStack: number
  lure: number
  lureTarget: boolean
  lureTimes: number[]
}
export interface FishingFrame {
  action: string
  time: number
  castId: string | null
  castTime: number | null
  biteTime: number | null
  hookTime: number | null
  baitId: number | null
  baseBaitId: number | null
  placeId: number | null
  tug: number | null
  fishId: number | null
  mooch: boolean | null
  chum: boolean | null
  snagging: boolean | null
  statuses: number[] | null
  /** Local protocol state. Must never be sent to the view bridge. */
  capture: FishingCapture | null
}
export type PublicFishingFrame = Omit<FishingFrame, 'capture'>
export function publicFrame(value: FishingFrame): PublicFishingFrame {
  const { capture: _capture, ...result } = structuredClone(value)
  return result
}
export interface FishingDistribution {
  bait_id: number
  fish_id: number
  is_chum: boolean
  tug_type: number
  count: number
  range: { min: number; max: number; effective_min: number; effective_max: number }
  percentiles: { p50: number }
}
export interface FishingStatistics {
  version: 1
  enabled: boolean
  session: string
  revision: number
  cast: PublicFishingFrame | null
  state: 'disabled' | 'waiting' | 'refreshing' | 'loading' | 'stale' | 'error' | 'empty' | 'ready' | 'unavailable'
  cachedAt: number | null
  uploadState: 'idle' | 'sending' | 'ok' | 'error' | 'incomplete' | 'unavailable'
  distributions: FishingDistribution[]
  unavailable: string | null
}
export interface FishingApi {
  query(place: number, signal: AbortSignal): Promise<FishingDistribution[]>
  upload(data: Uint8Array, timestamp: number, signal: AbortSignal): Promise<void>
}
