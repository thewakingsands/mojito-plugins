import type { ClockState } from '@ffcafe/mojito-plugin-sdk'
import type { Alert, Diagnostic, Settings } from '@ffcafe/mojito-raidboss'
export interface State {
  generation: number
  revision: number
  configRevision: number
  upstreamCommit: string
  settings: Settings
  zone: number | null
  diagnostics: Diagnostic[]
  alerts: Alert[]
  bars: { setId: string; id: string; text: string; endsAt: number; duration: boolean }[]
  catalogRevision: number
  sharedDataWarning: boolean
  sourceError: string | null
  moduleFault: string | null
  audioGranted: boolean
  clock: ClockState
}
export interface Catalog {
  revision: number
  definitions: { setId: string; triggerId: string; path: string; original: string }[]
  configurations: {
    setId: string
    id: string
    name: string
    type: string
    default: string | number | boolean
    options: Record<string, string>
  }[]
}
export function element<K extends keyof HTMLElementTagNameMap>(tag: K, text = ''): HTMLElementTagNameMap[K] {
  const value = document.createElement(tag)
  value.textContent = text
  return value
}
