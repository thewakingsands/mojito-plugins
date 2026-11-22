# Data and events

Complete types are in [types.ts](https://github.com/thewakingsands/mojito-plugins/blob/main/packages/plugin-sdk/src/types.ts) and [context.ts](https://github.com/thewakingsands/mojito-plugins/blob/main/packages/plugin-sdk/src/context.ts).

## Availability

A `Field<T>` with `state === 'ok'` contains `value`, `observedAt`, `timeBase` and its `from` source. Other states carry a `reason`. Unrequested fields may be omitted. Preserve unknown/unavailable values instead of inventing zero, an empty name or `false`.

`Sample<T>` carries data in `value` and provenance in `meta`. Identify its source using `sessionId`, `characterGeneration`, `clockGeneration` and live/replay mode; compare generations before timestamps.

`Json` is the JSON-compatible type used by configuration and logs. `Value` additionally accepts `bigint`, `Uint8Array` and arrays/objects containing them, for API and view transport.

## Territory and map

Both `territoryType` and `mapId` in `game.zone` are `Field<number>`. Live queries and recording share a zone sampler: a nonzero `mapOverride` takes precedence; otherwise it uses `GameMain.mapId` from the same sample. If both are zero, the map is `unknown`. A zero territory or a territory change during the read discards that observation and makes both live fields `unknown`. Read failures produce `unavailable`; subsequent successful samples can recover.

New recordings store the resolved value in the existing `mapId` field, and replay reads it directly. Older nonzero values are preserved; zero is `unknown`. Packet-only recordings without memory map records report `unavailable`. Replay does not depend on locally installed game data. Recording behavior during loading remains unchanged; replay cannot reconstruct loading states that were not recorded.

## Subscriptions

A subscription exposes `ready`, `dispose()` and `closed`. Await `ready` to confirm establishment. Inspect the closure reason and optional error. Callbacks receive `Batch<T>` with `items`, sequence numbers, `initial` and `complete`. Consume in order and handle completeness rather than treating every batch as a full snapshot.

The SDK does not send the next batch until an asynchronous callback completes. Each time the host waits for plugins, it waits at most 300ms for each subscription; a subscription that runs over is not waited for until it has processed the data it had received by then, and meanwhile the game state it queries may be newer than the event being processed. Once the backlog exceeds the limit, the subscription closes with `overflow`. Return promptly after retaining needed data. Reflect failure, cancellation, source termination and missing data in feature state.

## Initial snapshots and invalidation

When you need both the current value and later changes, subscribe first, then query the current value. If the subscription delivers new data before the query returns, the query result is stale and should be discarded, even if both have the same timestamp:

```ts
let revision = 0
let player: PlayerState | null = null
const subscription = context.game.subscribe('player', (batch) => {
  revision++
  for (const sample of batch.items) player = sample.value
}, { fields: ['inCombat'] })
await subscription.ready
const before = revision
const initial = await context.game.getPlayer({ fields: ['inCombat'] })
if (revision === before) player = initial.value
```

Clear old state on session or character changes, source loss and replay resets.

State subscriptions may coalesce rapid changes. Use events when each observation matters, and list multiple types in one `events.subscribe` call when cross-type ordering matters.

## Combat and statuses

Player `inCombat` comes from self-directed ToggleAggro packets through `game.read` or `events.read`; raw packet/memory capabilities are unnecessary. `playerCombatChanged` emits the first valid value; identical values refresh observation time. Zone boundaries, session changes and source loss can invalidate the field without emitting synthetic `false`.

`targetableChanged` and `cutsceneChanged` are sampled memory observations without packet metadata. Old recordings or client profiles without the relevant signatures may not provide them. `statusesReplaced` preserves original `slot` values; match changes by slot. In `statusSlotsChanged`, a refresh disappears before its replacement appears.

Combat calculations use inputs including `actionEffect`, `statusSlotsChanged`, `actorProfileChanged`, `overTimeTick`, `jobGaugeChanged` and `playerStatsChanged`. Stop affected calculations when `SessionSnapshot.opcodeVersion` differs from the plugin's state data. The public [combat-model](https://github.com/thewakingsands/mojito-plugins/tree/main/packages/combat-model) provides derived combat results.

## Time and errors

Live mode uses the host clock; replay uses recording time. `context.clock.now/state/sleep/setTimeout` follow pause and playback rate. `now()` returns `null` when unavailable. Backward replay resets change generations and invalidate work; handle `clock_reset` on pending waits.

API failures use `PluginError` with `code`, `message` and `retryable`. Correct inputs for `invalid_argument`, check declarations for `permission_denied`, handle temporary absence for `unavailable`, discard stale results for `stale_session`, and end work for `cancelled` / `plugin_stopped`. Transport and queue limits still apply; read current values from `context.limits`.
