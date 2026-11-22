import type { PluginContext } from '@ffcafe/mojito-plugin-sdk'
import { afterEach, expect, it, vi } from 'vitest'
import { registerCombatants } from './combatants.js'
import { activate } from './ember.js'
import { registerGameIcons } from './icons.js'
import { registerSay } from './say.js'
import { activateOverlay } from './worker.js'

vi.mock('./combatants.js', () => ({ registerCombatants: vi.fn() }))
vi.mock('./icons.js', () => ({ registerGameIcons: vi.fn() }))
vi.mock('./say.js', () => ({ registerSay: vi.fn() }))
vi.mock('./worker.js', () => ({ activateOverlay: vi.fn() }))
afterEach(() => vi.resetAllMocks())
it.each([false, true])(
  'releases query and speech registrations on stop or activation failure (%s)',
  async (failure) => {
    const ctx = {} as PluginContext
    const query = vi.fn(),
      speech = vi.fn(),
      icons = vi.fn(),
      overlay = vi.fn()
    vi.mocked(registerGameIcons).mockResolvedValue(icons)
    vi.mocked(registerCombatants).mockResolvedValue(query)
    vi.mocked(registerSay).mockResolvedValue(speech)
    vi.mocked(activateOverlay).mockImplementation(async () => {
      expect(registerCombatants).toHaveBeenCalledWith(ctx, 'combat')
      expect(registerSay).toHaveBeenCalledWith(ctx, 'combat')
      if (failure) throw new Error('activation failed')
      return overlay
    })
    if (failure) await expect(activate(ctx)).rejects.toThrow('activation failed')
    else await (await activate(ctx))()
    expect(query).toHaveBeenCalledOnce()
    expect(speech).toHaveBeenCalledOnce()
    expect(icons).toHaveBeenCalledOnce()
    expect(overlay).toHaveBeenCalledTimes(failure ? 0 : 1)
  },
)
