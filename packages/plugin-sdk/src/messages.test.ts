import { expect, it } from 'vitest'
import { decodeEnvelope, encodeEnvelope, messageKinds, validateEnvelope } from './messages.js'
import { encodeValue } from './protocol.js'

it.each(messageKinds)('accepts the %s envelope without changing binary or bigint payloads', (kind) => {
  const value = { protocol: 1 as const, activationId: 'synthetic', kind, payload: { data: Uint8Array.of(7), id: 1n } }
  expect(decodeEnvelope(encodeEnvelope(value), 'synthetic')).toEqual(value)
})
it('rejects unknown versions, kinds, and activation changes', () => {
  for (const patch of [{ protocol: 2 }, { kind: 'invoke-any-ipc' }, { activationId: 'old' }]) {
    expect(() =>
      decodeEnvelope(encodeValue({ protocol: 1, activationId: 'synthetic', kind: 'ready', ...patch }), 'synthetic'),
    ).toThrow()
  }
  expect(() => decodeEnvelope(encodeValue(null), 'synthetic')).toThrow()
})
it('checks only the envelope fields of a structured-clone message', () => {
  const envelope = { protocol: 1, activationId: 'synthetic', kind: 'request', params: { at: new Date() } }
  expect(() => validateEnvelope(envelope, 'synthetic')).not.toThrow()
  for (const patch of [{ protocol: 2 }, { activationId: 'old' }, { kind: 'invoke-any-ipc' }]) {
    expect(() => validateEnvelope({ ...envelope, ...patch }, 'synthetic')).toThrow()
  }
})
