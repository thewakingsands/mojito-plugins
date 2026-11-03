/** A browser-only Worker: the host supplies context and owns its lifetime.
 * @param {import("@ffcafe/mojito-plugin-sdk").PluginContext} context
 */
export async function activate(context) {
  const subscription = context.session.subscribe(async (batch) => {
    for (const session of batch.items) {
      context.log.info('Session changed', { state: session.state, generation: session.characterGeneration })
      await context.config.set('lastSessionState', session.state)
    }
  })
  await subscription.ready
  return () => subscription.dispose()
}
