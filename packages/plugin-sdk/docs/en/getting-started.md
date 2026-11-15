# Getting started

Use Node 24 and pnpm 12.13.0. Running a plugin requires an installed Mojito host. Building the Worker example requires neither the game, Rust nor a signing key.

## Prepare the example

```sh
git clone https://github.com/thewakingsands/mojito-plugins.git
cd mojito-plugins
git submodule update --init --recursive
pnpm install --frozen-lockfile
pnpm --filter @ffcafe/mojito-plugin-sdk build
```

`examples/plugin-worker` is a minimal plugin that can be registered directly. Its manifest:

```json
{
  "schemaVersion": 1,
  "id": "SessionNotes",
  "name": "Session notes example",
  "version": "1.0.0",
  "apiVersion": "^2.0.0",
  "entry": {
    "kind": "worker",
    "path": "entry.mjs"
  },
  "capabilities": ["session.read"],
  "networkOrigins": []
}
```

The host passes a context to `activate(context)`. This entry subscribes to session changes and saves the latest state in configuration. Its returned function unsubscribes on a normal stop:

```js
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
```

Workers use browser APIs. A TypeScript project that imports the SDK must bundle its entry as browser ESM; `entry.path` names the resulting `.mjs` or `.js` file. See [Development](development.md) for the complete view example's build configuration.

## Run in Mojito

1. Enable developer mode in settings and open the development plugins page.
2. Choose 登记来源 (register source), enter a profile name and the absolute path of `examples/plugin-worker/plugin.json`. This example uses local files; leave development server fields empty.
3. Confirm the source, select the plugin and choose 启动 (start). Ordinary capabilities are granted when starting; sensitive capabilities can be selected individually.
4. Look for `Session changed` in developer logs. Without a connected game, the plugin can still receive an idle session state.

Stop and start the development instance after changing background code. Production installation uses a [signed `.mojito` package](packaging.md).
