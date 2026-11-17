# Core concepts

This page explains the concepts that come up repeatedly when writing a plugin. For the full list of methods, see [Services and lifecycle](api/context.md).

## Activation and cleanup

Each time Mojito starts a plugin, it calls the background's exported `activate(context)` once. This run is called an **activation**. `context` belongs only to this activation; the activation ends when the plugin stops, is updated or is disabled by the user.

Subscriptions, page registrations, command handlers and similar operations return a cancel function (type name `Disposer`). `activate` should return a cleanup function that calls these cancel functions:

```ts
import type { PluginContext } from '@ffcafe/mojito-plugin-sdk'

export async function activate(context: PluginContext) {
  const subscription = context.session.subscribe((batch) => { /* … */ })
  const removePage = await context.ui.registerFeature({ id: 'main', name: 'Overview', entry: 'main.html' })
  return async () => {
    subscription.dispose()
    await removePage()
  }
}
```

On a normal stop, the host waits up to 10 seconds for the cleanup function. The cleanup function does not run when the plugin crashes or is forcibly terminated, so save important data as you go (`context.config` or `context.storage`) rather than only during cleanup.

## Permissions

The manifest's `capabilities` lists the permissions the plugin uses, for example `session.read` to read sessions and `ui.register` to register pages. Calls that need an undeclared permission fail with `permission_denied`.

Reading players' real identities, raw packets and memory, and making network requests, are **sensitive permissions**. Users can decline them individually or revoke them while the plugin runs. The plugin must keep working without these permissions. See [Permissions](permissions.md).

## Subscriptions and batches

Continuously changing data (sessions, game state, events) comes through subscriptions. Subscribing returns a `Subscription`:

- `ready`: resolves once the subscription is established. `await subscription.ready` before relying on it.
- `dispose()`: cancels the subscription.
- `closed`: resolves when the subscription ends, with the reason.

Each callback call receives a **batch** (`Batch`): `items` is the data for that period; process it in order. The first batch after the subscription is established carries `initial: true` and is usually the current state. When the callback is an async function, the SDK waits for it to finish before sending the next batch, so do not do long-running work in the callback.

## Data may be unknown

Game data is not always available: the game is not running, the relevant packet has not arrived yet, the client version is not supported… So each field is represented as a `Field`:

```ts
const sample = await context.game.getPlayer({ fields: ['inCombat'] })
const field = sample.value.inCombat
if (field?.state === 'ok') {
  // field.value is true or false
} else {
  // 'unknown' or 'unavailable': show it as unknown, do not treat it as false
}
```

Treating unknown as `0`, an empty string or `false` makes the plugin show wrong data.

## Sessions

A **session** is Mojito's connection to a game process (or a replay). `session.state` is `idle` (not connected), `live` (playing the game) or `replay` (playing a recording). When the character changes, the game restarts or a replay rewinds, old data is no longer valid. The `sessionId` and the generation counters `characterGeneration` and `clockGeneration` carried by the data tell whether it belongs to the current session. See [Data and events](api/data-model.md) for how to handle this.

## The bridge between background and pages

Pages are independent web pages and cannot use `context` directly. The background and pages exchange data by name (channel) through the **bridge**:

- The background publishes the latest value of a channel with `context.views.set(channel, value)`; the page receives it with `view.subscribe(channel, …)`.
- The page uses `view.command(name, value)` to call a command the background registered with `context.views.onCommand(name, …)`, and gets its return value.

A page is destroyed when it closes; opening it again creates a new page. Keep state that must persist in the background. See [View bridge](api/view.md) for a complete example.

## Errors

A failed API call throws `PluginError`; use `code` to tell the reason:

| `code` | Meaning |
| --- | --- |
| `invalid_argument` | Wrong arguments; fix the call |
| `permission_denied` | The manifest does not declare the corresponding permission |
| `unavailable` | Not available right now (for example the game is not running, or the user declined a sensitive permission); may recover later |
| `stale_session` | The session changed during the call and the result is stale; discard it |
| `cancelled`, `plugin_stopped` | The operation was cancelled or the plugin is stopping; end the work in progress |

## Terms

| Term | Meaning |
| --- | --- |
| manifest | The `plugin.json` at the root of the plugin package; see [Manifest](manifest.md) |
| capability | One permission declared in the manifest |
| origin | The scheme, host and port of a URL, for example `https://api.example.com`; used to declare which sites the plugin can access |
| catalog | A `catalog.json` that lists installable plugin versions; users add its URL in Mojito to install plugins |
| JWK | A format for storing keys as JSON; the private key for plugin signing is saved in this format |
