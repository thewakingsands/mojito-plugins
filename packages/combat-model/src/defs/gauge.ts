import type { GaugeModifier } from '../defs.js'

// The fire and the ice spells of the thaumaturge and the black mage
const FIRE = [141, 147, 152, 3577, 162, 16505, 25794, 36989]
const ICE = [142, 25793, 154, 3576, 159, 25795]

/** The potency of the fire and ice spells at each stack of Astral Fire and Umbral Ice, from Aspect Mastery I–III */
function aspectMastery(stance: number, fire: number, ice: number | null): GaugeModifier[] {
  const modifiers: GaugeModifier[] = [
    {
      gauge: 'BlackMage',
      when: (gauge) => gauge.elementStance === stance,
      type: 'potency',
      value: [{ level: 1, value: fire }],
      actions: FIRE,
      category: null,
      damageType: null,
    },
  ]
  if (ice !== null) {
    modifiers.push({
      gauge: 'BlackMage',
      when: (gauge) => gauge.elementStance === stance,
      type: 'potency',
      value: [{ level: 1, value: ice }],
      actions: ICE,
      category: null,
      damageType: null,
    })
  }
  return modifiers
}

export const gaugeModifiers: readonly GaugeModifier[] = [
  // Enochian, and Enhanced Enochian I–IV
  {
    gauge: 'BlackMage',
    when: (gauge) => gauge.enochianActive,
    type: 'damageDealt',
    value: [
      { level: 1, value: 0.05 },
      { level: 70, value: 0.1 },
      { level: 78, value: 0.15 },
      { level: 86, value: 0.22 },
      { level: 96, value: 0.27 },
    ],
    actions: null,
    category: null,
    damageType: 'magic',
  },
  // Astral Fire raises the fire spells and lowers the ice spells; Umbral Ice lowers the fire spells only
  ...aspectMastery(1, 0.4, -0.1),
  ...aspectMastery(2, 0.6, -0.2),
  ...aspectMastery(3, 0.8, -0.3),
  ...aspectMastery(-1, -0.1, null),
  ...aspectMastery(-2, -0.2, null),
  ...aspectMastery(-3, -0.3, null),
]
