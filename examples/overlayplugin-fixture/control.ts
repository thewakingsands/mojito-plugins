import type { Value } from '@ffcafe/mojito-plugin-sdk'
import { connectView } from '@ffcafe/mojito-plugin-sdk/view'

const view = await connectView()
Object.assign(window, {
  fixtureCustom: (custom: Value) => view.command('fixture', { scenario: 'partial', custom }),
  fixtureCombatants: (mode: string) => view.command('fixture/combatants', mode),
  fixtureState: (state: Value) => view.command('fixture', { state }),
  fixture: (scenario: string, encounterId = 'matrix', active = true) =>
    view.command('fixture', { scenario, encounterId, active }),
})
document.body.dataset.ready = 'true'
