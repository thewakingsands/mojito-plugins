// Read from the game data of client 2026.10.06.0000.0000 (Chinese). Each skill lists every player action of the same
// name, which takes in the versions of the trust NPCs and of PvP; the review only looks them up for party members.
// The durations follow the skill descriptions at level 100.

/** Raid buffs by Action ID, with how long they last in milliseconds */
export const raidBuffs: ReadonlyMap<number, number> = new Map(
  (
    [
      // Battle Litany
      [[3557, 9640], 20],
      // Brotherhood
      [[7396, 18915], 20],
      // Dokumori
      [[36957, 41451], 20],
      // Arcane Circle
      [[24405], 20],
      // Battle Voice
      [[118], 20],
      // Radiant Finale
      [[25785], 20],
      // Technical Finish
      [[16004, 16193, 16194, 16195, 16196, 17466, 17825, 17826, 17827, 17828, 17829, 33215, 33216, 33217, 33218], 20],
      // Searing Light
      [[25801], 20],
      // Starry Muse
      [[34675, 38992, 39593, 47144], 20],
      // Embolden
      [[7520, 20106, 26225, 41494], 20],
      // Divination
      [[16552, 18941], 20],
      // Chain Stratagem
      [[7436, 9622, 29716], 20],
    ] as const
  ).flatMap(([ids, seconds]) => ids.map((id) => [id, seconds * 1000] as const)),
)

/** Party mitigations by Action ID, with how long they last in milliseconds */
export const partyMitigations: ReadonlyMap<number, number> = new Map(
  (
    [
      // Reprisal
      [[7535, 17866, 18134, 25136, 28323, 30334], 15],
      // Divine Veil
      [[3540, 18903, 26235, 39673], 30],
      // Shake It Off
      [[7388, 17699], 30],
      // Dark Missionary
      [[16471, 18909], 15],
      // Heart of Light
      [[16160, 17715, 18133, 25081, 39681], 15],
      // Feint
      [[7549, 18954, 28324], 15],
      // Addle
      [[7560, 17686, 40057, 40060], 15],
      // Troubadour
      [[7405, 10023], 15],
      // Tactician
      [[7555, 9392, 16889, 18934, 38862], 15],
      // Dismantle
      [[2887, 40102], 10],
      // Shield Samba
      [[16012, 17954], 15],
      // Magick Barrier
      [[25857, 29697, 37489, 38936], 10],
      // Tempera Grassa
      [[34686, 39212, 39833], 10],
      // Temperance
      [[16536, 17794, 37185, 38082, 40037], 20],
      // Sacred Soil
      [[188, 23578], 15],
      // Expedient
      [[25868, 29236], 20],
      // Neutral Sect
      [[16559, 17809, 38141, 38886], 20],
      // Macrocosmos
      [[25874, 29253, 38158, 38903], 15],
      // Kerachole
      [[24298, 37410, 38923, 49815], 15],
      // Holos
      [[24310, 25415, 37412, 38925], 20],
      // Panhaima
      [[24311, 25416, 37413, 38926, 49816, 49840], 15],
    ] as const
  ).flatMap(([ids, seconds]) => ids.map((id) => [id, seconds * 1000] as const)),
)

/** The Damage Down statuses, which lower the damage the holder deals */
export const damageDownStatuses: ReadonlySet<number> = new Set([
  62, 215, 628, 696, 1016, 1090, 2092, 2404, 2522, 2911, 3166, 3304, 3964, 4370, 4371, 4514, 4874, 5451,
])
/** Damage Down, Vulnerability Up, Physical Vulnerability Up and Magic Vulnerability Up: the marks of a failed mechanic */
export const penaltyStatuses: ReadonlySet<number> = new Set([
  ...damageDownStatuses,
  // Vulnerability Up
  64,
  202,
  444,
  563,
  638,
  714,
  806,
  893,
  1054,
  1208,
  1402,
  1412,
  1597,
  1789,
  1845,
  2213,
  2347,
  2912,
  3361,
  3366,
  3557,
  4375,
  // Physical Vulnerability Up
  56,
  126,
  200,
  493,
  657,
  695,
  934,
  2090,
  2123,
  2940,
  3415,
  4162,
  5180,
  // Magic Vulnerability Up
  60,
  494,
  658,
  1138,
  2091,
  2941,
  3414,
  3516,
  3536,
  5181,
])
