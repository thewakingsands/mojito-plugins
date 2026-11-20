import type { PluginContext } from '@ffcafe/mojito-plugin-sdk'
import { jobs } from './job-icons.js'

export async function registerGameIcons(ctx: PluginContext) {
  return ctx.views.onCommand('combat/icons', async (input) => {
    if (!input || typeof input !== 'object' || Array.isArray(input) || input instanceof Uint8Array)
      return { error: 'invalid_argument' }
    const { type, id } = input
    if (
      Object.keys(input).length !== 2 ||
      typeof id !== 'number' ||
      !Number.isSafeInteger(id) ||
      id < 1 ||
      id > 0xffffffff ||
      (type !== 'action' && type !== 'status' && type !== 'job') ||
      (type === 'job' && !jobs[id])
    )
      return { error: 'invalid_argument' }

    let iconId = 62100 + id
    if (type !== 'job') {
      const language = (await ctx.session.get()).dataLanguage ?? 'en'
      const rows = await ctx.data.rows(type === 'action' ? 'Action' : 'Status', [id], language)
      const icon = rows[0]?.subrows[0]?.cells[2]
      if (icon?.type !== 'number' || !Number.isInteger(icon.value) || icon.value <= 0) return null
      iconId = icon.value
    }
    const directory = String(Math.floor(iconId / 1000) * 1000).padStart(6, '0')
    const name = `ui/icon/${directory}/${String(iconId).padStart(6, '0')}`
    return (await ctx.data.image(`${name}_hr1.tex`)) ?? ctx.data.image(`${name}.tex`)
  })
}
