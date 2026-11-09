// Copyright (c) FFCafe. All rights reserved.
// Licensed under AGPL-3.0. Packet layouts ported from Cafe.Matcha.

/** SDK packets contain the IPC payload, without Cafe.Matcha's 32-byte header. */
export class Payload {
  private readonly view: DataView

  constructor(readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  }

  require(length: number): void {
    if (this.bytes.byteLength < length) throw new RangeError(`truncated payload: ${this.bytes.byteLength} < ${length}`)
  }

  u8(offset: number): number {
    return this.view.getUint8(offset)
  }
  u16(offset: number): number {
    return this.view.getUint16(offset, true)
  }
  u32(offset: number): number {
    return this.view.getUint32(offset, true)
  }
  u64(offset: number): string {
    return this.view.getBigUint64(offset, true).toString()
  }
  f32(offset: number): number {
    return this.view.getFloat32(offset, true)
  }

  text(offset: number, length: number): string {
    this.require(offset + length)
    const field = this.bytes.subarray(offset, offset + length)
    const end = field.indexOf(0)
    return new TextDecoder().decode(end < 0 ? field : field.subarray(0, end))
  }
}
