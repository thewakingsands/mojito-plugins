# Services and lifecycle

Full signatures are in [PluginContext and service types](https://github.com/thewakingsands/mojito-plugins/blob/main/packages/plugin-sdk/src/context.ts). The SDK ships `.d.ts` files for editor navigation. Examples use current exports; see [Permissions](../permissions.md) for denial behavior.

## Activation and cleanup

The host calls the exported `activate(context)`. It may finish synchronously or asynchronously and return a cleanup function. On a normal stop the host pauses incoming events and allows cleanup up to 10 seconds of wall time, including final `storage.write` calls. Crashes and forced termination may bypass cleanup; save important state regularly.

`context.signal` is aborted when the activation ends. Retain and release subscription, view and service disposers. `identity` describes the plugin ID, version, activation ID, runtime mode and development/production environment. `limits` contains read-only parameters for this activation.

## Services

| Service | Purpose and behavior |
| --- | --- |
| `session` | `get` / `subscribe` read sessions; needs `session.read`; idle is valid state |
| `game` | Query players/entities and subscribe to state; needs `game.read`; check each `Field.state` |
| `events` | Subscribe to parsed events; needs `events.read`; one multi-type subscription preserves cross-type ordering |
| `packets` | `subscribe('ipc', ...)` reads raw packets; needs `packets.read`; declined access yields an empty subscription |
| `memory` | `resolve`, `read`, `watch`; needs `memory.read`; selections carry session ID and character generation; declined access is `unavailable` |
| `data` | EXD rows, names, resources, icons and maps; needs `data.read`; unopened game data is `unavailable`, missing resources may be `null` |
| `ui` | Register features, overlays and preference items; needs `ui.register`; registrations return disposers |
| `views` | Publish latest values, flush and handle page commands within the same plugin |
| `audio` | `play` plays packaged audio; needs `audio.play` |
| `tts` | `say` needs `tts.say`; `provide` needs `tts.provide`; users choose voices and playback modes |
| `host` | `openExternal` asks before opening HTTP(S); returns `opened` or `cancelled` |
| `http` | `request` needs `http.request` and `networkOrigins`; returns status, headers, final URL and body bytes; declined access is `unavailable` |
| `config` | JSON configuration by key; bigint and binary values are not JSON |
| `storage` | Read, write, delete and list the plugin's own files; binary values use `Uint8Array` |
| `log` | `debug`, `info`, `warn`, `error`; structured fields use JSON |
| `notifications` | `send` adds a host notification with a nonempty title; the latest 50 are kept until the host exits |
| `clock` | `now`, `state`, `sleep`, `setTimeout` use the current live/replay clock |
| `services` | Provide, discover, call and subscribe to plugin services; needs `services.provide` / `services.consume` as appropriate |


## Querying state

Declare `game.read` and request selected fields. Preserve `unknown` and `unavailable` as unknown state:

```ts
import type { PluginContext } from '@ffcafe/mojito-plugin-sdk'

export async function activate(context: PluginContext) {
  const sample = await context.game.getPlayer({ fields: ['inCombat'] })
  const field = sample.value.inCombat
  if (field?.state === 'ok') context.views.set('combat', { inCombat: field.value })
}
```

For ongoing changes, subscribe and await `subscription.ready`. See [Data and events](data-model.md) for ordering snapshots against subscription updates.

## Icons and resources

Send icons to the requesting view on demand instead of periodic snapshots. With `data.read`, handle a view command in the Worker:

```ts
import type { PluginContext } from '@ffcafe/mojito-plugin-sdk'

export async function activate(context: PluginContext) {
  const remove = await context.views.onCommand('icon', async (value) => {
    const icon = await context.data.icon(Number(value))
    return icon ? { ...icon } : null
  })
  return remove
}
```

`data.icon` returns PNG bytes or `null`. The view creates a Blob URL and revokes it when replaced or disposed. `data.image` and `data.map` return local URLs tied to this activation and game data; acquire them again after switching clients. `data.resource` returns raw bytes.

`data.version()` reads `ffxivgame.ver` on each call. It returns `null` for a missing/empty file and rejects with `stale_session` if data changes during the call. Invalidate game-data caches by version. `rowIds` lists actual ordinary-sheet row IDs in ascending order; read cells with `rows`. Use `none` for language-neutral sheets.

Since Plugin API 2.1, `rows('Map', ids, 'none', { columns: ['Id', 'TerritoryType'] })` returns cells in the requested EXDSchema field order. Named selection currently supports recognized `Map` layouts. Omit `columns` to receive all cells in client EXH declaration order.

## Speech

Declare channels in manifest `tts.channels`. `tts.say(text, { channel })` defaults to `default`; users choose voices and playback modes in Mojito. It resolves when speech completes, rejects with `cancelled` when aborted/replaced, and with `unavailable` when no voice can speak.

`tts.provide` registers voices and an asynchronous synthesizer, returning a `VoiceProvider` with `update` and `dispose`. `online: true` means text is sent to a network service. The host caches online audio and splits text around party names, so the synthesizer may receive sentence fragments. Handle cancellation using its supplied `signal`.

## Service discovery

Providers register a local manifest name using `services.provide`. Consumers use `pluginId/name` in `services.consumes` and calls. `connect` returns `null` when the provider is stopped or incompatible, allowing optional features to degrade:

```ts
import type { PluginContext } from '@ffcafe/mojito-plugin-sdk'

export async function activate(context: PluginContext) {
  const provider = await context.services.connect('ffcafe.combat-statistics/overlay', '^1.0.0')
  context.log.info('Service lookup', { available: provider !== null })
}
```

Use `request` for methods and `subscribe` for service events. Providers emit events with `publish`. A provider handler receives the consumer ID and abort signal and answers with its own capabilities.
