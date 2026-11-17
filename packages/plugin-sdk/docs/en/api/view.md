# View bridge

The background owns PluginContext. A page calls `connectView()` from `@ffcafe/mojito-plugin-sdk/view` to obtain a document-bound [ViewBridge](https://github.com/thewakingsands/mojito-plugins/blob/main/packages/plugin-sdk/src/view.ts). Channels connect it to this plugin's background.

| Method | Purpose |
| --- | --- |
| `snapshot(channel)` | Read the latest value |
| `subscribe(channel, listener)` | Subscribe to latest values; await the returned `ready` |
| `command(channel, value)` | Call a background command and receive a result |
| `on(name, listener)` | Receive a host view event; returns an unsubscribe function |

`identity` identifies the view, definition and overlay instance. Feature `placement` is `sidebar`, `home` or `settings`; overlays use `null`.

## State and commands

The background publishes the latest value of a channel with `views.set`. The SDK sends at most once every 200ms and sends only the latest value of each channel, so a page may not receive every intermediate value. Do not modify an object after passing it to `set`. Use `await views.flush()` when the page must see the new state before a command returns.

The background publishes state and handles a command:

```ts
let count = 0
context.views.set('counter', { count })
const removeCommand = await context.views.onCommand('increment', async () => {
  count++
  context.views.set('counter', { count })
  await context.views.flush() // The page has received the new value when the command returns
  return count
})
```

The page subscribes to the same channel and sends the command:

```ts
import { connectView } from '@ffcafe/mojito-plugin-sdk/view'

const view = await connectView()
const subscription = view.subscribe('counter', (batch) => {
  for (const item of batch.items) render(item)
})
await subscription.ready
const count = await view.command('increment', null)
```

The return value of `command` is the return value of the background handler; when the handler throws, `command` fails too. See [Pages and overlays](../features.md) for a complete project and [examples/plugin-views](https://github.com/thewakingsands/mojito-plugins/tree/main/examples/plugin-views) for a multi-page example.

## Lifecycle

Navigating away releases the feature document; returning creates a new one. Keep persistent view state in the background. Dispose subscriptions and revoke Blob URLs when the view closes.

`navigate-to-preference-item` is delivered only to settings pages as `{ id, keyword }`. Events arriving before a listener are retained as the latest event per name for the first listener. See [Preference search](../features.md#preference-search).

If the host rejects a published value, the SDK logs a warning and throws on the next `set` or `flush`; the previous accepted value remains. Handle command failures in the view. The host handles the enclosing frame's loading-failure and stopped-background states.
