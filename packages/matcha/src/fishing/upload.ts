// Cafe.Matcha's independently implemented CBOR contract (AGPL-3.0).
import type { FishingAttributes, FishingFrame } from './types.js'

export type CborValue = number | boolean | null | CborValue[]
export function createUpload(cast: FishingFrame, attributes: FishingAttributes | null): CborValue[] | null {
  const c = cast.capture
  if (
    !c?.terminal ||
    c.unsupported ||
    c.serverCastTime === null ||
    cast.biteTime === null ||
    cast.biteTime - c.serverCastTime < 1000 ||
    cast.biteTime - c.serverCastTime > 600000 ||
    !cast.placeId ||
    !cast.baitId ||
    cast.chum === null ||
    cast.mooch === null ||
    cast.statuses === null ||
    cast.tug === null ||
    cast.tug < 1 ||
    cast.tug > 3 ||
    !attributes ||
    attributes.gathering === null ||
    attributes.perception === null ||
    attributes.currentGp === null ||
    c.hook === null ||
    c.lureTimes.some((t) => t < c.serverCastTime! || t > cast.biteTime!)
  )
    return null
  const success = cast.fishId !== null
  if (success && (c.size === null || c.quantity === null || c.quantity <= 0 || c.large === null)) return null
  if ((cast.statuses.includes(1803) && !c.slap) || (cast.statuses.includes(1804) && !c.identical)) return null
  if (cast.statuses.includes(764) && c.patienceSuccess === null) return null
  let flags = 0
  for (const [i, status] of [763, 762, 568, 3907, 2780].entries()) if (cast.statuses.includes(status)) flags |= 1 << i
  if (cast.statuses.includes(764)) flags |= cast.statuses.includes(765) ? 1 << 6 : 1 << 5
  if (c.identical) flags |= 1 << 7
  if (c.slap) flags |= 1 << 8
  flags |= (cast.tug << 9) | (c.hook << 11)
  if (c.gatheringFailed) flags |= 2 << 14
  else if (success) flags |= 1 << 14
  flags |= c.lure << 16
  if (c.lureTarget) flags |= 1 << 19
  if (c.hidden) flags |= 1 << 20
  if (c.patienceSuccess !== null) {
    flags |= 1 << 21
    if (c.patiencePrecision) flags |= 1 << 22
    if (c.patienceSuccess) flags |= 1 << 23
  }
  flags |= c.hiddenStack << 24
  return [
    c.serverCastTime,
    cast.placeId,
    cast.baitId,
    cast.biteTime - c.serverCastTime,
    flags >>> 0,
    success ? [cast.fishId!, c.size!, c.large!, c.quantity!] : null,
    c.slap,
    c.identical,
    c.hidden,
    c.lureTimes.length ? c.lureTimes.at(-1)! - c.serverCastTime : 0,
    c.lureTimes.map((t) => t - c.serverCastTime!),
    [attributes.gathering, attributes.perception, attributes.currentGp],
  ]
}
/** Only arrays, unsigned safe integers, booleans and null occur in this wire contract. */
export function encodeUpload(records: CborValue[]): Uint8Array {
  const output: number[] = []
  const number = (major: number, value: number) => {
    if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('Invalid CBOR unsigned integer')
    if (value < 24) {
      output.push(major * 32 + value)
      return
    }
    const width = value <= 255 ? 1 : value <= 65535 ? 2 : value <= 0xffffffff ? 4 : 8
    output.push(major * 32 + ({ 1: 24, 2: 25, 4: 26, 8: 27 } as const)[width])
    const wide = BigInt(value)
    for (let i = width - 1; i >= 0; i--) output.push(Number((wide >> BigInt(i * 8)) & 255n))
  }
  const write = (value: CborValue): void => {
    if (value === null) output.push(0xf6)
    else if (typeof value === 'boolean') output.push(value ? 0xf5 : 0xf4)
    else if (Array.isArray(value)) {
      number(4, value.length)
      for (const item of value) write(item)
    } else number(0, value)
  }
  write(records)
  return Uint8Array.from(output)
}
