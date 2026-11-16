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

The background publishes values with `views.set`. The SDK sends at most once every 200ms and retains only the latest value per channel. Do not mutate values after passing them. Use `await views.flush()` when a view must see the update before a command returns.

This counter background registers features, a settings page and an overlay:

[entry.ts](https://github.com/thewakingsands/mojito-plugins/blob/main/examples/plugin-views/entry.ts)

The page subscribes to the channel and sends commands:

[page.ts](https://github.com/thewakingsands/mojito-plugins/blob/main/examples/plugin-views/page.ts)

## Lifecycle

Navigating away releases the feature document; returning creates a new one. Keep persistent view state in the background. Dispose subscriptions and revoke Blob URLs when the view closes.

`navigate-to-preference-item` is delivered only to settings pages as `{ id, keyword }`. Events arriving before a listener are retained as the latest event per name for the first listener. See [Preference search](../features.md#preference-search).

If the host rejects a published value, the SDK logs a warning and throws on the next `set` or `flush`; the previous accepted value remains. Handle command failures in the view. The host handles the enclosing frame's loading-failure and stopped-background states.
