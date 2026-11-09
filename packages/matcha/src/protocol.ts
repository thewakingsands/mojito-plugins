// Copyright (c) FFCafe. Licensed under AGPL-3.0-only; see ../LICENSE.
import type { Json, Packet } from '@ffcafe/mojito-plugin-sdk'

export type MatchaPacket = Packet
export type MatchaEmitter = (type: string, content: Json, timestamp?: number) => void
export interface MatchaEvent {
  sequence: number
  type: string
  content: Json
  timestamp: number
}
export interface Diagnostic {
  at: number
  message: string
}
export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object')
  return value as Record<string, unknown>
}
export function asJson(value: unknown): Json {
  return JSON.parse(JSON.stringify(value, (_key, item) => (typeof item === 'bigint' ? item.toString() : item))) as Json
}
