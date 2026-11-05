import { type PeriodicDefs, parsePeriodicDefs } from '../defs.js'
import actionTypes from './action-types.json' with { type: 'json' }
import actions from './actions.json' with { type: 'json' }
import { blackMageElements } from './black-mage.js'
import { gaugeModifiers } from './gauge.js'
import levelModifiers from './level-modifiers.json' with { type: 'json' }
import sampleActions from './sample-actions.json' with { type: 'json' }
import statuses from './statuses.json' with { type: 'json' }
import version from './version.json' with { type: 'json' }

/** The data shipped with the model, checked when the module loads */
export const periodicDefs: PeriodicDefs = parsePeriodicDefs({
  version,
  statuses,
  actions,
  sampleActions,
  actionTypes,
  levelModifiers,
  gauge: gaugeModifiers,
  elements: blackMageElements,
})
