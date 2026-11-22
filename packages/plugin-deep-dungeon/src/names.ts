import type { PluginContext } from '@ffcafe/mojito-plugin-sdk'

export async function names(ctx: PluginContext, ids: number[], column: number | null) {
  const { dataLanguage } = await ctx.session.get()
  const result: Record<string, string> = {}
  // No production column is supplied until both clients have been read.
  if (dataLanguage === null || column === null) return { language: dataLanguage, names: result }
  for (let offset = 0; offset < ids.length; offset += 64) {
    try {
      const rows = await ctx.data.rows('BNpcName', ids.slice(offset, offset + 64), dataLanguage)
      for (const row of rows) {
        const cell = row.subrows[0]?.cells[column]
        if (cell?.type === 'string' && cell.value.trim()) result[row.rowId] = cell.value
      }
    } catch (error) {
      ctx.log.debug('BNpcName read failed', { language: dataLanguage, error: String(error) })
      break
    }
  }
  const current = (await ctx.session.get()).dataLanguage
  return { language: current, names: current === dataLanguage ? result : {} }
}
