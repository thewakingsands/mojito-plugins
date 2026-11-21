import { ActorControlType, PacketMap } from '@ffcafe/elpis-network'
import type { Packet } from '@ffcafe/mojito-plugin-sdk'
import { Buffer } from 'buffer'
import { type Actors, absentActor, coordinates, type Names, properties } from './actors.js'
import { hex, type LogField } from './format.js'

const types = [
  'Effect',
  'AoeEffect8',
  'AoeEffect16',
  'AoeEffect24',
  'AoeEffect32',
  'ActorCast',
  'ActorControl',
  'ActorControlSelf',
  'ActorGauge',
  'PlayerSpawn',
  'NpcSpawn',
  'NpcSpawn2',
  'ObjectSpawn',
  'ActorFreeSpawn',
  'ActorMove',
  'ActorSetPos',
  'UpdateClassInfo',
  'UpdateClassInfoEureka',
  'UpdateClassInfoBozja',
  'UpdateClassInfoOccult',
  'InitZone',
  'PlayerSetup',
  'PlayerStats',
  'UpdateHpMpTp',
  'PlaceFieldMarker',
  'PlaceFieldMarkerPreset',
  'SystemLogMessage',
  'SystemLogMessage32',
  'SystemLogMessage48',
  'SystemLogMessage80',
  'SystemLogMessage144',
  'EffectResult',
  'EffectResult4',
  'EffectResult8',
  'EffectResult16',
  'EffectResultBasic',
  'EffectResultBasic4',
  'EffectResultBasic8',
  'EffectResultBasic16',
  'EffectResultBasic32',
  'EffectResultBasic64',
  'StatusEffectList',
  'StatusEffectList2',
  'StatusEffectList3',
  'StatusEffectListForay3',
  'EurekaStatusEffectList',
  'BossStatusEffectList',
] as const satisfies readonly (keyof typeof PacketMap)[]
export const packetTypes = [...types]
type Type = (typeof types)[number]
type Decoded = { [K in Type]: { type: K; body: InstanceType<(typeof PacketMap)[K]> } }[Type]
export interface Row {
  type: number
  fields: LogField[]
}
export interface State {
  actors: Actors
  names: Names
  player: number | null
  contentId?: bigint
  marks: Set<number>
  zone(id: number): Promise<Row[]>
  primary(id: number, name: string): Row[]
  stats?: string
}
const rotation = (n: number) => Math.fround((n / 32768) * Math.PI - Math.PI)
const position = (n: number) => Math.fround((n - 32768) / 32.767)
const row = (type: number, ...fields: LogField[]): Row[] => [{ type, fields }]
function decode(packet: Packet): Decoded {
  const type = packet.type as Type
  if (!types.includes(type)) throw new Error(`Unexpected packet type: ${packet.type}`)
  const ctor = PacketMap[type]
  const bytes = Buffer.from(packet.data.buffer, packet.data.byteOffset, packet.data.byteLength)
  return { type, body: new ctor(bytes) } as Decoded
}

type Ability = Extract<Decoded, { type: 'Effect' | 'AoeEffect8' | 'AoeEffect16' | 'AoeEffect24' | 'AoeEffect32' }>
async function ability(s: State, id: number, v: Ability) {
  const { header, entities } = v.body
  const aoe = 'effectTargetIds' in v.body
  const ids =
    'effectTargetIds' in v.body ? v.body.effectTargetIds.map((bytes) => bytes.readUInt32LE()) : [v.body.effectTargetId]
  const count = header.effectCount
  if (count > ids.length || entities.length !== ids.length * 8) throw new Error('Incompatible action effect layout')
  const targets =
    count === 0
      ? [{ id: absentActor, slot: 0 }]
      : ids
          .slice(0, count)
          .map((id, slot) => ({ id, slot }))
          .filter((t) => t.id !== 0)
  const display = header.effectDisplayType
  const skill = display === 2 || display === 13 ? header.action + display * 0x1000000 : header.actionAnimationId
  const name = await s.names.action(skill)
  const source = s.actors.get(id),
    owner = source.ownerId
  return targets.map((target, index) => {
    const actor = s.actors.get(target.id)
    const slots = entities.slice(target.slot * 8, (target.slot + 1) * 8)
    return {
      type: aoe && count > 0 ? 22 : 21,
      fields: [
        hex(id, 2),
        source.name ?? '',
        hex(skill, 2),
        name,
        hex(target.id, 2),
        actor.name ?? '',
        ...slots.flatMap((e) => (count === 0 ? ['0', '0'] : [hex(e.data0), hex(e.data1)])),
        ...properties(actor),
        ...properties(source),
        hex(header.sequence, 8),
        index,
        count === 0 ? 0 : targets.length,
        hex(owner && owner !== absentActor ? owner : 0, 2),
        s.actors.get(owner ?? null).name ?? '',
        hex(display, 2),
        hex(header.action, 2),
        hex(header.actionAnimationId, 2),
        header.animationLockTime.toFixed(3),
        hex(header.rotation, 4),
      ],
    }
  })
}

function mark(s: State, id: number, marker: number, set: boolean, x: number, y: number, z: number): Row[] {
  if (!set && !s.marks.has(marker)) return []
  if (set) s.marks.add(marker)
  else s.marks.delete(marker)
  return row(
    28,
    set ? 'Add' : 'Delete',
    marker,
    hex(id, 4),
    s.actors.get(id).name ?? '',
    ...[x, z, y].map((n) => (n / 1000).toFixed(2)),
  )
}

export async function packetRows(s: State, packet: Packet): Promise<Row[]> {
  const v = decode(packet),
    id = packet.sourceActor,
    actor = s.actors.get(id)
  const name = (id: number) => s.actors.get(id).name ?? ''
  switch (v.type) {
    case 'Effect':
    case 'AoeEffect8':
    case 'AoeEffect16':
    case 'AoeEffect24':
    case 'AoeEffect32':
      return ability(s, id, v)
    case 'InitZone': {
      const receiver = packet.targetActor
      const playerName = name(receiver)
      const rows = await s.zone(v.body.zoneId)
      if (receiver && receiver !== absentActor) rows.push(...s.primary(receiver, playerName))
      return rows
    }
    case 'PlayerSetup': {
      const n = v.body.unlocks.nickname
      s.actors.update(id, { name: n, classJob: v.body.header.currentJob })
      return s.primary(id, n)
    }
    case 'PlayerSpawn':
    case 'NpcSpawn':
    case 'NpcSpawn2': {
      const p = v.body
      s.actors.update(id, {
        name: p.nickname,
        classJob: p.classJob,
        level: p.level,
        ownerId: p.ownerId,
        homeWorldId: p.homeWorldId,
        bNpcName: p.bNPCName,
        bNpcBase: p.bNPCBase,
        hpCur: p.hpCur,
        hpMax: p.hpMax,
        mpCur: 'resourcePoints' in p ? p.resourcePoints : p.mpCur,
        mpMax: 'resourcePointsMax' in p ? p.resourcePointsMax : p.mpMax,
        position: p.position,
        rotation: rotation(p.rotation),
      })
      return []
    }
    case 'ObjectSpawn': {
      const p = v.body
      s.actors.update(p.actorId, { position: p.position3, rotation: rotation(p.rotation) })
      return []
    }
    case 'ActorFreeSpawn':
      if (!s.actors.present.has(v.body.targetId)) s.actors.forget(v.body.targetId)
      return []
    case 'ActorMove': {
      const p = v.body
      s.actors.update(id, {
        position: { x: position(p.x), y: position(p.y), z: position(p.z) },
        rotation: rotation(new DataView(packet.data.buffer, packet.data.byteOffset).getUint16(0, true)),
      })
      return []
    }
    case 'ActorSetPos': {
      const { x, y, z, r16 } = v.body
      s.actors.update(id, { position: { x, y, z }, rotation: rotation(r16) })
      return []
    }
    case 'UpdateClassInfo':
    case 'UpdateClassInfoEureka':
    case 'UpdateClassInfoBozja':
    case 'UpdateClassInfoOccult': {
      const p = 'data' in v.body ? v.body.data : v.body
      s.actors.update(id, { classJob: p.classId, level: p.level })
      return []
    }
    case 'PlayerStats': {
      const p = v.body,
        job = s.actors.get(s.player ?? id).classJob
      // During login the first stats packet can arrive before PlayerSetup establishes the job.
      if (job === undefined || !s.contentId) return []
      const fields = [
        job,
        p.strength,
        p.dexterity,
        p.vitality,
        p.intelligence,
        p.mind,
        p.piety,
        p.attackPower,
        p.directHitRate,
        p.criticalHit,
        p.attackMagicPotency,
        p.healingMagicPotency,
        p.determination,
        p.skillSpeed,
        p.spellSpeed,
        p.tenacity,
        s.contentId.toString(16).toUpperCase().padStart(8, '0'),
      ]
      const key = fields.join('|')
      if (s.stats === key) return []
      s.stats = key
      return row(12, ...fields)
    }
    case 'ActorCast': {
      const p = v.body
      return row(
        20,
        hex(id, 4),
        name(id),
        hex(p.action, 2),
        await s.names.name('action', p.action),
        hex(p.targetId, 4),
        name(p.targetId),
        p.castTime.toFixed(3),
        ...coordinates(actor),
      )
    }
    case 'ActorControl': {
      const { type, category, data0, data1, data2, data3, data4 } = v.body
      switch (type) {
        case ActorControlType.CastInterrupt:
          return row(
            23,
            hex(id, 2),
            name(id),
            hex(data2, 2),
            await s.names.name('action', data2),
            data3 === 1 ? 'Interrupted' : data3 === 0 ? 'Cancelled' : '',
          )
        case ActorControlType.DefeatMsg:
          return row(25, hex(id, 2), name(id), hex(data0, 2), name(data0))
        case ActorControlType.CombatIndicationShow:
          return row(27, hex(id, 2), name(id), ...[0, category, data0, data1, data2, data3].map((n) => hex(n, 4)))
        case ActorControlType.ToggleNameHidden:
          return row(34, hex(id, 2), name(id), hex(id, 2), name(id), hex(data0 & 255, 2))
        case ActorControlType.Tether:
          return row(
            35,
            hex(id, 2),
            name(id),
            hex(data2, 2),
            name(data2),
            ...[category, data0, data1, data2, data3, data4].map((n) => hex(n, 4)),
          )
        case ActorControlType.DamageOverTime:
        case ActorControlType.HealOverTime:
        case ActorControlType.HPFloatingText: {
          const floating = type === ActorControlType.HPFloatingText
          if (floating && data1 !== 3 && data1 !== 4) return []
          const source = data0 === 0 ? null : floating ? data3 : data2
          const other = s.actors.get(source)
          return row(
            24,
            hex(id, 4),
            name(id),
            (floating ? data1 === 4 : type === ActorControlType.HealOverTime) ? 'HoT' : 'DoT',
            hex(data0),
            hex(floating ? data2 : data1),
            ...properties(actor),
            source === null ? '' : hex(source, 4),
            other.name ?? '',
            hex(floating ? 0 : data3),
            ...properties(other),
          )
        }
        default:
          return []
      }
    }
    case 'ActorControlSelf': {
      const p = v.body
      if (p.type === ActorControlType.DirectorUpdate && p.data1 >>> 24 && p.data1 & 0xffff)
        return row(33, ...[p.data0, p.data1, p.data2, p.data3, p.data4, p.data5].map((n) => hex(n, 2)))
      return p.type === ActorControlType.LimitBreakGauge ? row(36, hex(p.data1, 4), p.data0) : []
    }
    case 'ActorGauge': {
      if (packet.data.byteLength !== 16) throw new Error('Invalid job gauge length')
      const view = new DataView(packet.data.buffer, packet.data.byteOffset, 16)
      return row(31, hex(id, 2), ...[0, 4, 8, 12].map((offset) => hex(view.getUint32(offset, true), 2)))
    }
    case 'PlaceFieldMarker': {
      const { type, isSet, x, y, z } = v.body
      return mark(s, id, type, !!isSet, x, y, z)
    }
    case 'PlaceFieldMarkerPreset': {
      const { activeMask, x, y, z } = v.body
      return Array.from({ length: 8 }, (_, i) => mark(s, id, i, !!(activeMask & (1 << i)), x[i], y[i], z[i])).flat()
    }
    case 'SystemLogMessage':
    case 'SystemLogMessage32':
    case 'SystemLogMessage48':
    case 'SystemLogMessage80':
    case 'SystemLogMessage144': {
      const { eventId, logMessageId, entities } = v.body
      const header = new DataView(packet.data.buffer, packet.data.byteOffset, packet.data.byteLength)
      return row(41, ...[eventId, logMessageId, header.getUint32(8, true), ...entities].map((n) => hex(n, 2)))
    }
    case 'UpdateHpMpTp': {
      const p = v.body
      s.actors.update(id, { hpCur: p.hp, mpCur: p.mp })
      return row(39, hex(id, 2), name(id), ...properties(s.actors.get(id)))
    }
    default:
      return resultRows(s, id, v, packet.data)
  }
}

type Result = Extract<Decoded, { type: `EffectResult${string}` | `${string}StatusEffectList${string}` }>
function resultRows(s: State, id: number, v: Result, bytes: Uint8Array): Row[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const actor = s.actors.get(id)
  const words = (offset: number, count: number) =>
    Array.from({ length: count }, (_, i) => view.getUint32(offset + i * 4, true))
  const formatWords = (values: number[]) =>
    values.map((n) => {
      if (!n) return '0'
      const digits = hex(n)
      return digits.length % 2 ? `0${digits}` : digits
    })
  // A status occupies three words. Gaps before the last occupied slot retain their position.
  const trimStatuses = (data: number[]) => {
    let end = data.length
    while (end > 3 && !data[end - 1] && !data[end - 2] && !data[end - 3]) end -= 3
    return data.slice(0, end)
  }
  if ('entries' in v.body) {
    const { entries, entryCount } = v.body
    if (entryCount > entries.length) throw new Error('Invalid effect result count')
    return entries.slice(0, entryCount).map((entry, i) => {
      const full = 'maxHp' in entry
      const old = s.actors.get(id)
      const updated = {
        ...old,
        hpCur: entry.currentHp,
        ...(full ? { hpMax: entry.maxHp, mpCur: entry.currentMp } : {}),
      }
      s.actors.update(id, updated)
      const fields: LogField[] = [
        hex(id, 4),
        old.name ?? '',
        hex(entry.sequence, 8),
        entry.currentHp,
        full ? entry.maxHp : '',
        full ? entry.currentMp : '',
        full ? 10000 : '',
        full ? entry.shieldPercentage : '',
        '',
        ...coordinates(old),
      ]
      if (full) {
        if (entry.effectCount > entry.effects.length) throw new Error('Invalid effect result status count')
        const start = 4 + i * 88
        const trailer = [entry.targetIndex | (entry.classId << 8), 0, entry.unknown, entry.effectCount]
        for (const [j, effect] of entry.effects.slice(0, entry.effectCount).entries()) {
          trailer.push(
            (effect.index * 0x1000000 + effect.unknown1 * 0x10000 + effect.statusId) >>> 0,
            view.getUint32(start + 28 + j * 16, true),
            view.getUint32(start + 32 + j * 16, true),
            effect.sourceActorId,
          )
        }
        while (trailer.length && trailer.slice(-4).every((n) => n === 0)) trailer.length -= 4
        fields.push(...formatWords(trailer))
      }
      return { type: 37, fields }
    })
  }
  if (v.type === 'StatusEffectList3')
    return row(
      42,
      hex(id, 4),
      actor.name ?? '',
      ...formatWords(trimStatuses(words(0, v.body.statusEffects.length * 3))),
    )
  const base = 'data' in v.body ? v.body.data : v.body
  const offset = v.type === 'BossStatusEffectList' ? 360 : 'data' in v.body ? 4 : 0
  const levelWord = view.getUint32(offset, true)
  const properties = {
    classJob: base.classId,
    level: base.level,
    hpCur: base.hpCur,
    hpMax: base.hpMax,
    mpCur: base.mpCur,
    mpMax: base.mpMax,
  }
  s.actors.update(id, properties)
  const foray = v.type === 'StatusEffectListForay3'
  // The ordinary ACT status list starts with a three-word header. Foray3 starts directly at slot zero.
  const values = foray ? [] : [view.getUint16(offset + 17, true), view.getUint8(offset + 19), 0]
  values.push(...words(offset + 20, base.statusEffects.length * 3))
  if (v.type === 'BossStatusEffectList') values.push(...words(0, v.body.statusEffects2.length * 3))
  return row(
    foray ? 43 : 38,
    hex(id, 4),
    actor.name ?? '',
    hex(levelWord, 8),
    base.hpCur,
    base.hpMax,
    base.mpCur,
    base.mpMax,
    view.getUint8(offset + 16),
    '',
    ...coordinates(actor),
    ...formatWords(trimStatuses(values)),
  )
}
