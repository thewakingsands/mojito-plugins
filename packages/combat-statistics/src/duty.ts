import type { DataService } from '@ffcafe/mojito-plugin-sdk'

// Columns in the order of the EXH header, which ctx.data.rows follows and SaintCoinach numbers by. EXDSchema
// (ver/2026.09.01.0000.0000) lists the fields in the order of their offsets instead, so the numbers come from the
// SaintCoinach definitions of 6.58. Both sheets gained fields since then and EXDSchema cannot tell their columns,
// so dutyName checks that the duty points back to its territory. Checked against the CN client of 2026.10.06:
// TerritoryType 1295 holds ContentFinderCondition 1061, 永远之暗歼灭战.
const TERRITORY_CONTENT_FINDER_COLUMN = 10
const CONTENT_FINDER_TERRITORY_COLUMN = 1
const CONTENT_FINDER_NAME_COLUMN = 43

/**
 * The name of the duty held in a territory, such as 海德林歼灭战 for the territory 母水晶; null when the territory
 * holds no duty or the data cannot be read.
 */
export async function dutyName(data: DataService, territoryType: number, language: string): Promise<string | null> {
  try {
    // TerritoryType has no languages, and the host rejects any other language for it
    const [zone] = await data.rows('TerritoryType', [territoryType], 'none')
    const duty = zone?.subrows[0]?.cells[TERRITORY_CONTENT_FINDER_COLUMN]
    if (duty?.type !== 'number' || duty.value === 0) return null
    const [row] = await data.rows('ContentFinderCondition', [duty.value], language)
    const cells = row?.subrows[0]?.cells ?? []
    // A duty that does not point back to the territory means the columns moved in this game version.
    const territory = cells[CONTENT_FINDER_TERRITORY_COLUMN]
    if (territory?.type !== 'number' || territory.value !== territoryType) return null
    const name = cells[CONTENT_FINDER_NAME_COLUMN]
    return name?.type === 'string' && name.value ? name.value : null
  } catch {
    return null
  }
}
