import type { PluginContext } from '@ffcafe/mojito-plugin-sdk'
import { type OverlayCompatibility, type OverlayState, overlayProducer } from '@ffcafe/mojito-plugin-sdk/overlayplugin'
import { provideOverlayService } from '../../packages/combat-statistics/src/overlay-service.js'

// Entirely synthetic input: the same state can be sent to ACT and Mojito by the acceptance harness.
export const state = (encounterId = 'fixture-1', active = true): OverlayState => ({
  apiVersion: 1,
  encounterId,
  combatData: {
    isActive: active ? 'true' : 'false',
    Encounter: {
      title: 'Synthetic encounter',
      duration: '00:10',
      DURATION: '10',
      damage: '1250',
      encdps: '125.00',
      ENCDPS: '125',
      hits: '10',
      zone: 'Fixture territory',
      CurrentZoneName: 'Fixture territory',
    },
    Combatant: {
      YOU: {
        name: 'YOU',
        Job: 'WAR',
        damage: '1250',
        encdps: '125.00',
        ENCDPS: '125',
        dps: '125.00',
        duration: '00:10',
        DURATION: '10',
        hits: '10',
        'damage%': '100%',
      },
    },
  },
  primaryPlayer: { id: 16, name: 'Example Player' },
  zone: { id: 1, name: 'Fixture territory' },
  language: 'en',
  inCombat: null,
  availability: {
    combatData: { state: 'partial', reason: 'Synthetic damage-only fixture; healing and other metrics unavailable' },
    primaryPlayer: { state: 'available' },
    zone: { state: 'available' },
    language: { state: 'available' },
    inCombat: { state: 'unavailable', reason: 'No real game combat input' },
  },
})
export function scenario(name: string, encounterId = 'matrix', active = true): OverlayState {
  const output = state(encounterId, active)
  if (name === 'partial') return output
  if (name === 'unavailable') {
    output.combatData = null
    output.availability.combatData = { state: 'unavailable', reason: 'Synthetic missing combat source' }
    return output
  }
  const combat = output.combatData!,
    row = combat.Combatant.YOU
  Object.assign(row, {
    healed: '2000',
    enchps: '200.00',
    ENCHPS: '200',
    hps: '200.00',
    damagetaken: '500',
    healstaken: '1800',
    swings: '12',
    misses: '1',
    crithits: '3',
    'crithit%': '30%',
    DirectHitCount: '4',
    DirectHitPct: '40%',
    CritDirectHitCount: '2',
    CritDirectHitPct: '20%',
    deaths: '1',
    maxhit: 'SyntheticHit-250',
    MAXHIT: '250',
    maxheal: 'SyntheticHeal-500',
    MAXHEAL: '500',
    Last10DPS: '125',
    Last30DPS: '100',
    Last60DPS: '75',
    'healed%': '100%',
  })
  Object.assign(combat.Encounter, {
    healed: '2000',
    enchps: '200.00',
    ENCHPS: '200',
    maxhit: 'SyntheticHit-250',
    MAXHIT: '250',
    maxheal: 'SyntheticHeal-500',
    MAXHEAL: '500',
  })
  output.availability.combatData = {
    state: 'partial',
    reason: 'Synthetic observed fields; effective healing and contribution DPS remain unavailable',
  }
  if (name === 'same-name') {
    combat.Combatant = {
      'Same Name@World One': { ...row, name: 'Same Name@World One', 'damage%': '50%' },
      'Same Name@World Two': { ...row, name: 'Same Name@World Two', Job: 'WHM', 'damage%': '50%' },
    }
    combat.Encounter.damage = '2500'
    combat.Encounter.encdps = '250.00'
    combat.Encounter.ENCDPS = '250'
  } else if (name === 'pets-separate') {
    combat.Combatant = {
      YOU: { ...row, damage: '1000', encdps: '100.00', ENCDPS: '100', 'damage%': '66.67%' },
      'Synthetic Pet (Example Player)': {
        ...row,
        name: 'Synthetic Pet (Example Player)',
        Job: 'Pet',
        damage: '500',
        encdps: '50.00',
        ENCDPS: '50',
        healed: '0',
        enchps: '0',
        deaths: '0',
        'damage%': '33.33%',
      },
    }
    combat.Encounter.damage = '1500'
    combat.Encounter.encdps = '150.00'
    combat.Encounter.ENCDPS = '150'
  } else if (name === 'pets-merged') {
    Object.assign(row, { damage: '1500', encdps: '150.00', ENCDPS: '150' })
    combat.Encounter.damage = '1500'
    combat.Encounter.encdps = '150.00'
    combat.Encounter.ENCDPS = '150'
  } else if (name === 'limit-break') {
    combat.Combatant['Limit Break'] = {
      ...row,
      name: 'Limit Break',
      Job: 'Limit Break',
      healed: '0',
      crithits: '0',
      DirectHitCount: '0',
      CritDirectHitCount: '0',
      'crithit%': '0%',
      DirectHitPct: '0%',
      CritDirectHitPct: '0%',
      hits: '1',
      swings: '1',
      misses: '0',
      deaths: '0',
      maxhit: 'Limit Break-750',
      MAXHIT: '750',
      damage: '750',
      encdps: '75.00',
      ENCDPS: '75',
      'damage%': '37.5%',
    }
    row['damage%'] = '62.5%'
    combat.Encounter.damage = '2000'
    combat.Encounter.encdps = '200'
    combat.Encounter.ENCDPS = '200'
  } else if (name === 'zero-duration') {
    row.duration = combat.Encounter.duration = '00:00'
    row.DURATION = combat.Encounter.DURATION = '0'
    for (const record of [row, combat.Encounter])
      for (const key of [
        'dps',
        'DPS',
        'encdps',
        'ENCDPS',
        'hps',
        'HPS',
        'enchps',
        'ENCHPS',
        'Last10DPS',
        'Last30DPS',
        'Last60DPS',
      ])
        delete record[key]
    output.availability.combatData = { state: 'partial', reason: 'Zero duration: all rates are unavailable, not zero' }
  } else if (name === 'post-revision') {
    row.damage = combat.Encounter.damage = '1350'
    row.encdps = combat.Encounter.encdps = '135.00'
    row.ENCDPS = combat.Encounter.ENCDPS = '135'
  } else if (name !== 'full') throw new Error('Unknown fixture scenario')
  if (name !== 'zero-duration') {
    const rows = Object.values(combat.Combatant)
    const damage = rows.reduce((sum, row) => sum + Number(row.damage), 0),
      healing = rows.reduce((sum, row) => sum + Number(row.healed), 0)
    for (const actor of rows) {
      Object.assign(actor, {
        dps: (Number(actor.damage) / 10).toFixed(2),
        encdps: (Number(actor.damage) / 10).toFixed(2),
        ENCDPS: (Number(actor.damage) / 10).toFixed(0),
        hps: (Number(actor.healed) / 10).toFixed(2),
        enchps: (Number(actor.healed) / 10).toFixed(2),
        ENCHPS: (Number(actor.healed) / 10).toFixed(0),
        'damage%': `${((Number(actor.damage) / damage) * 100).toFixed(2)}%`,
        'healed%': `${((Number(actor.healed) / healing) * 100).toFixed(2)}%`,
      })
      if (actor.healed === '0') {
        delete actor.maxheal
        delete actor.MAXHEAL
      }
    }
    Object.assign(combat.Encounter, {
      hits: String(rows.reduce((sum, actor) => sum + Number(actor.hits), 0)),
      damage: String(damage),
      healed: String(healing),
      encdps: (damage / 10).toFixed(2),
      ENCDPS: (damage / 10).toFixed(0),
      enchps: (healing / 10).toFixed(2),
      ENCHPS: (healing / 10).toFixed(0),
    })
  }
  return output
}
export async function activate(context: PluginContext) {
  const producer = overlayProducer(context.views, 'combat')
  let current = state(),
    queue = Promise.resolve()
  const enqueue = <T>(task: () => T | Promise<T>) => {
    const next = queue.then(task)
    queue = next.then(
      () => {},
      () => {},
    )
    return next
  }
  const endEncounter = async (id: string) => {
    if (id !== current.encounterId) return 'staleEncounter' as const
    if (current.combatData!.isActive === 'false') return 'alreadyEnded' as const
    current = state(id, false)
    await publish()
    await context.views.flush()
    return 'ended' as const
  }
  const service = await provideOverlayService(context, enqueue, endEncounter)
  async function publish() {
    await producer.publish(current)
    await service.publish(current)
  }
  await enqueue(publish)
  await context.views.flush()
  await context.views.onCommand('fixture', (input) =>
    enqueue(async () => {
      const command = input as { scenario: string; encounterId?: string; active?: boolean }
      current = scenario(command.scenario, command.encounterId, command.active)
      await publish()
      await context.views.flush()
      return { encounterId: current.encounterId }
    }),
  )
  await context.ui.registerFeature({
    id: 'fixture-control',
    name: 'Synthetic overlay acceptance',
    entry: 'control.html',
  })
  await producer.onEnd((id) => enqueue(() => endEncounter(id)))
  const selected = typeof __OVERLAY_FIXTURE_SOURCES__ === 'undefined' ? [] : __OVERLAY_FIXTURE_SOURCES__
  for (const definition of selected)
    await context.ui.registerOverlay({ ...definition, name: definition.id, defaultSize: { width: 600, height: 400 } })
  return service.dispose
}
declare const __OVERLAY_FIXTURE_SOURCES__: { id: string; compatibility: OverlayCompatibility }[]
