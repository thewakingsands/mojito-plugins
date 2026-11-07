import { mergeClassJobActions, type PeriodicDefs, parsePeriodicDefs } from '../defs.js'
import { blackMageElements, gaugeModifiers } from './ClassJobActions/BlackMage.js'
import { classJobActions } from './ClassJobActions/index.js'
import levelModifiers from './level-modifiers.json' with { type: 'json' }
import limitBreaks from './limit-breaks.json' with { type: 'json' }
import version from './version.json' with { type: 'json' }

/** The data shipped with the model, checked when the module loads */
export const periodicDefs: PeriodicDefs = parsePeriodicDefs({
  version,
  ...mergeClassJobActions(classJobActions),
  levelModifiers,
  gauge: gaugeModifiers,
  elements: blackMageElements,
  limitBreaks,
})
