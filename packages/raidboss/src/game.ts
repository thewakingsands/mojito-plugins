import type { CombatantField, CombatantState, GameTopics, PlayerState, PluginContext } from '@ffcafe/mojito-plugin-sdk'
import type PartyTracker from '../vendor/cactbot/resources/party'
import Util from '../vendor/cactbot/resources/util'
import type { RaidbossData } from '../vendor/cactbot/types/data'
import type { Party } from '../vendor/cactbot/types/event'
import type { RaidbossOptions } from '../vendor/cactbot/ui/raidboss/raidboss_options'
import { type EntityCache, hex } from './events'

export class MissingData extends Error {}

/** Members keep the last job seen in range; a member never seen in range reports NONE. */
export function partyMembers(party: GameTopics['party'], entities: EntityCache, jobs: Map<number, number>): Party[] {
  return (entities.field(party.members) ?? []).map((member) => {
    const actor = entities.get(member.id)
    const job = entities.field(actor?.classJob)
    if (job !== undefined) jobs.set(member.id, job)
    return {
      id: hex(member.id, 8)!,
      name: member.name,
      job: jobs.get(member.id) ?? 0,
      inParty: member.ownParty,
      worldId: entities.field(actor?.homeWorldId),
    }
  })
}

export const sameParty = (a: Party[], b: Party[]): boolean =>
  a.length === b.length &&
  a.every(
    (member, i) =>
      member.id === b[i]!.id &&
      member.name === b[i]!.name &&
      member.job === b[i]!.job &&
      member.inParty === b[i]!.inParty &&
      member.worldId === b[i]!.worldId,
  )

export function raidbossData(
  name: string,
  classJob: number,
  party: PartyTracker,
  options: RaidbossOptions,
  stop: () => void,
  player: () => PlayerState | undefined = () => undefined,
): RaidbossData {
  const job = Util.jobEnumToJob(classJob)
  return {
    me: name,
    job,
    role: Util.jobToRole(job),
    party,
    lang: options.ParserLanguage,
    parserLang: options.ParserLanguage,
    displayLang: options.DisplayLanguage,
    options,
    triggerSetConfig: {},
    ShortName: (value) => Util.shortName(value, options.PlayerNicks),
    StopCombat: stop,
    ParseLocaleFloat: parseFloat,
    CanStun: () => Util.canStun(job),
    CanSilence: () => Util.canSilence(job),
    CanSleep: () => Util.canSleep(job),
    CanCleanse: () => Util.canCleanse(job),
    CanFeint: () => Util.canFeint(job),
    CanAddle: () => Util.canAddle(job),
    get currentHP(): number {
      const hp = player()?.hpCur
      if (hp?.state !== 'ok') throw new MissingData('player.hpCur')
      return hp.value
    },
    get inCombat(): boolean {
      const combat = player()?.inCombat
      if (combat?.state !== 'ok') throw new MissingData('player.inCombat')
      return combat.value
    },
  }
}

const properties: Record<string, CombatantField> = {
  Name: 'name',
  Job: 'classJob',
  Level: 'level',
  CurrentHP: 'hpCur',
  MaxHP: 'hpMax',
  CurrentMP: 'mpCur',
  MaxMP: 'mpMax',
  PosX: 'position',
  PosY: 'position',
  PosZ: 'position',
  Heading: 'rotation',
  BNpcID: 'bNpcBase',
  BNpcNameID: 'bNpcName',
  OwnerID: 'ownerId',
  TargetID: 'targetId',
  WeaponId: 'weaponId',
  ModelStatus: 'modelStatus',
  IsCasting1: 'cast',
  CastBuffID: 'cast',
}
export function combatantProperties(actor: CombatantState, requested: string[]): Record<string, unknown> {
  const output: Record<string, unknown> = { ID: actor.id }
  for (const prop of requested) {
    if (prop === 'ID') continue
    const field = properties[prop]
    if (!field) throw new Error(`Unsupported combatant property: ${prop}`)
    const value = actor[field]
    if (value?.state !== 'ok') throw new MissingData(`${hex(actor.id, 8)}.${field}`)
    if (prop === 'IsCasting1') output[prop] = value.value === null ? 0 : 1
    else if (prop === 'CastBuffID') {
      const cast = value.value as { actionId: number } | null
      if (cast === null) throw new MissingData(`${hex(actor.id, 8)}.cast.actionId`)
      output[prop] = cast.actionId
    } else if (field === 'position') {
      const position = value.value as { x: number; y: number; z: number }
      output[prop] = position[prop === 'PosX' ? 'x' : prop === 'PosY' ? 'z' : 'y']
    } else output[prop] = value.value
  }
  return output
}

/** Upstream getCombatants: actors the host no longer has are simply absent from the result. */
export function queryBridge(ctx: PluginContext, signal: AbortSignal) {
  return async (request: Record<string, unknown>): Promise<unknown> => {
    if (request.call !== 'getCombatants') throw new Error(`Unsupported raidboss query: ${String(request.call)}`)
    const props = (request.props as string[] | undefined) ?? Object.keys(properties)
    const unsupported = props.find((prop) => prop !== 'ID' && !properties[prop])
    if (unsupported) throw new Error(`Unsupported combatant property: ${unsupported}`)
    const names = request.names as string[] | undefined
    const fields = new Set(props.flatMap((prop) => properties[prop] ?? []))
    if (names) fields.add('name')
    const result = await ctx.game.getCombatants(
      { ids: request.ids as number[] | undefined, fields: [...fields] },
      { signal },
    )
    if (signal.aborted) throw new Error('Stale raidboss query')
    return {
      combatants: result.value.entities
        .filter((actor) => !names || (actor.name?.state === 'ok' && names.includes(actor.name.value)))
        .map((actor) => combatantProperties(actor, props)),
    }
  }
}
