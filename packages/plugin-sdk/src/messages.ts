import { decodeValue, encodeValue, ProtocolError } from './protocol.js'
import type { Value } from './types.js'

export const messageKinds = Object.freeze([
  'hello',
  'ready',
  'request',
  'response',
  'cancel',
  'subscribe',
  'subscribed',
  'batch',
  'ack',
  'unsubscribe',
  'subscriptionClosed',
  'capabilitiesChanged',
  'clockSync',
  'clockReset',
  'stop',
  'stopped',
  // Host to page only; the host treats one from a plugin or page as an invalid message.
  'event',
] as const)
export type MessageKind = (typeof messageKinds)[number]
const kinds = new Set<string>(messageKinds)
export type Envelope = { protocol: 1; activationId: string; kind: MessageKind } & { [key: string]: Value }

/**
 * Envelope/activation checks only, without walking the payload; each router method
 * must validate its payload schema. MessagePack paths still check every value when
 * encoding and decoding.
 */
export function validateEnvelope(input: unknown, expectedActivation: string): asserts input is Envelope {
  if (!input || typeof input !== 'object' || Array.isArray(input) || input instanceof Uint8Array) {
    throw new ProtocolError('Expected message envelope')
  }
  const envelope = input as Record<string, unknown>
  if (envelope.protocol !== 1) throw new ProtocolError('Unsupported protocol version')
  if (!expectedActivation || envelope.activationId !== expectedActivation) throw new ProtocolError('Wrong activation')
  if (typeof envelope.kind !== 'string' || !kinds.has(envelope.kind)) throw new ProtocolError('Unknown message kind')
  // Identity and method validation, capability checks, queue state and exact ack
  // matching remain host responsibilities; receipt never grants authority.
}
export function encodeEnvelope(input: Envelope): Uint8Array {
  validateEnvelope(input, input.activationId)
  return encodeValue(input)
}
export function decodeEnvelope(bytes: Uint8Array, expectedActivation: string): Envelope {
  const input = decodeValue(bytes)
  validateEnvelope(input, expectedActivation)
  return input
}
