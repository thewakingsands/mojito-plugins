import type { PluginContext } from '@ffcafe/mojito-plugin-sdk'
import { check, fields, object } from '@ffcafe/mojito-plugin-sdk/schema'

export async function registerGameIcons(ctx: PluginContext) {
  return ctx.views.onCommand('combat/icons', async (input) => {
    const value = object(input)
    fields(value, ['type', 'id'])
    check(value.type === 'action' || value.type === 'status', 'Invalid icon type')
    check(Number.isSafeInteger(value.id) && Number(value.id) > 0 && Number(value.id) <= 0xffffffff, 'Invalid row ID')
    const language = (await ctx.session.get()).dataLanguage ?? 'en'
    const rows = await ctx.data.rows(value.type === 'action' ? 'Action' : 'Status', [Number(value.id)], language)
    const icon = rows[0]?.subrows[0]?.cells[2]
    if (icon?.type !== 'number' || !Number.isInteger(icon.value) || icon.value <= 0) return null
    const directory = String(Math.floor(icon.value / 1000) * 1000).padStart(6, '0')
    const name = `ui/icon/${directory}/${String(icon.value).padStart(6, '0')}`
    return (await ctx.data.image(`${name}_hr1.tex`)) ?? ctx.data.image(`${name}.tex`)
  })
}
