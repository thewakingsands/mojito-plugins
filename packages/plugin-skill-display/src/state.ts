import type { ClockState } from '@ffcafe/mojito-plugin-sdk'

export type Settings = { seconds: 5 | 10 | 20; scale: 75 | 100 | 125 | 150; newest: 'left' | 'right' }
export type ActionInfo = { name: string; gcd: boolean; icon: number | null }
export type Action = ActionInfo & { key: string; id: number; at: number }
export type DisplayState = {
  settings: Settings
  clock: ClockState
  actions: Action[]
  reason: string | null
  resources: string
}
