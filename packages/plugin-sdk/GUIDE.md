### Cleanup

Return a disposer from `activate(context)` to finish outstanding work on normal stop.
The host pauses incoming events and allows the disposer to use its existing grants,
including `await context.storage.write(...)`, for up to 10 seconds of wall-clock time.
The user can end cleanup early. Completion, failure, timeout or early termination
revokes the context and terminates the runtime; crashes bypass cleanup. Save regularly
as well: forced termination cannot guarantee a final write.


### Player combat state

`game.getPlayer({ fields: ['inCombat'] })` and the `player` state subscription return
a `Field<boolean>`. Check `state === 'ok'` before using `value`; `unavailable` is not
false. The field is observed from the receiving player's ToggleAggro packet and does
not require memory or packet permissions, a content ID, or a populated general
`player.actorId` field. Its `observedAt` is the packet observation time, not query time.
Live observations use the host clock; replay observations use the recording clock.

Use `events.subscribe('playerCombatChanged', listener)` to receive every effective
observation in order. Data is `{ actorId, inCombat }`, with standard packet and source
metadata. The first valid value (including false) is emitted; identical values for
the same actor refresh the field without a duplicate event. To preserve ordering
with actions, subscribe to `['playerCombatChanged', 'actionEffect']` together. The
`actorIds` filter applies to the player; action/status filters are not valid for the
combat event. An older host may reject an unknown event type with `invalid_argument`.

`targetableChanged` gives `{ actorId, targetable }` for a player or battle NPC when it is
first seen and whenever that changes, and `cutsceneChanged` gives `{ playing }` when the
local player starts or stops watching a cutscene. Both come from sampled memory, so they
have no `packet`, and recordings made before them have none. `actorIds` applies to
`targetableChanged` and is not valid for `cutsceneChanged`. `cutsceneChanged` is also
absent while the client profile has no `conditions` signature.

State subscriptions may coalesce a fast true → false pair; event subscriptions keep
both observations. Subscribe before requesting an initial snapshot. Keep a local
notification revision and discard the query result if a newer event, invalidation,
or session reset arrived while it was pending, including equal timestamps. Never
use a late snapshot to replace a newer notification. Compare source generations
before comparing observation times. The combat-state fixture demonstrates this guard.

Known false remains available across a zone change without changing its observation
time. Initial unknown or known true at a zone boundary becomes unavailable until the
next valid ToggleAggro. Session/character changes, replay resets, and detected event
source loss clear the cached state. Pause and playback rate changes preserve it.
Invalid ToggleAggro values are ignored with a host diagnostic; they do not fabricate
false or terminate subscriptions. Observe the game state and session/zone/stream-end
notifications for invalidation: no synthetic false event is emitted for it.

Old v1 recordings can provide this field when they contain a valid self-directed
ToggleAggro. A recording started mid-combat remains unavailable until such a packet
arrives. Neither encounter activity nor ACT's separate `inACTCombat` substitutes for
the game combat state.

### Storage budgets

Declare storage budgets in `plugin.json`; the installation confirmation shows them before granting access. Each field is optional. Defaults are 32 MiB total and 3 MiB per file.

```json
"storage": { "totalBytes": 536870912 }
```

Worker plugins can also request larger files, for example `"storage": { "totalBytes": 536870912, "fileBytes": 33554432 }`. Use the existing whole-file `context.storage.read/write` methods and read the effective values from `context.limits.values['storage.pluginBytes']` and `context.limits.values['storage.fileBytes']`.

Explicit values must be safe integers at least as large as their defaults, with the file budget no larger than the total. Native plugins retain the 3 MiB file ceiling for the 4 MiB transport frame. These budgets cover logical plugin storage bytes. Lowering a budget preserves existing data; writes beyond it return `quota_exceeded`.

### Publishing views

Call `context.views.set(channel, value)` to publish the latest value of a view channel.
Views opened later receive this value, and subscribed views receive it as an update.
The SDK keeps only the latest value of each channel and sends it to the host at most
every 200ms, so calling `set` on every event is fine. Do not modify the object after
passing it to `set`: it is read when it is sent, not when `set` is called.

When a view has to see the value right away, for example before a command returns,
call `await context.views.flush()`. It sends every value not yet sent and resolves
once the host handled them.

If the host rejects a value, for example because it exceeds the size limit, the SDK
writes a warning to the plugin log and the next `set` or `flush` throws the error.
The host keeps the last accepted value.

```ts
context.views.set('state', { selected })
await context.views.flush()
```

### Game icons

With `data.read`, call `context.data.icon(iconId)` to read a PNG from the opened game directory. Missing icons return `null`. Send the result to the requesting view on demand; keep image bytes out of periodic snapshots.

```ts
// Worker: return the icon to the view that requested it.
await context.views.onCommand('icon', async (id) => {
  const icon = await context.data.icon(Number(id))
  return icon ? { ...icon } : null
})
```

```ts
import type { GameIcon } from '@ffcafe/mojito-plugin-sdk'

// View: release the previous URL when replacing the image or disposing the view.
const icon = await bridge.command('icon', iconId) as GameIcon | null
if (objectUrl) URL.revokeObjectURL(objectUrl)
objectUrl = icon ? URL.createObjectURL(new Blob([icon.data], { type: icon.mime })) : undefined
image.src = objectUrl ?? ''
```

### Game data version

Plugin API 1.4.0 adds `context.data.version()`, which needs `data.read`. It returns the
content of `ffxivgame.ver` in the opened game directory, trimmed, or `null` when the file is
missing or empty. It fails with `unavailable` while no game data is open, and with
`stale_session` when the game data is opened or closed during the call. The host reads the
file on each call, so a game updated while Mojito runs returns its new version. Use it to
drop anything kept from the game data when the version changes.

```ts
const version = await context.data.version()
if (version !== null && version !== saved.version) await clearCache()
```

### Preference search

Plugin API 1.5.0 adds `context.ui.setPreferenceItems(items)`, which needs `ui.register`.
It submits the `{ id, title, description }` items of the plugin's settings page so the
host's settings search and Ctrl K can find them; every call replaces all earlier items
and an empty array clears them. When the user chooses an item, the host opens the
settings page again and sends it `navigate-to-preference-item` with `{ id, keyword }`.
Listen with `view.on(name, listener)` from `connectView()`; it returns a function that
stops listening, and an event that arrived before the first listener is kept for it.
See [docs/features.md](docs/features.md#preference-search) for the limits and errors.

```ts
await context.ui.setPreferenceItems([{ id: 'scope', title: '统计范围', description: '' }])
```

```ts
const view = await connectView()
view.on('navigate-to-preference-item', ({ id }) => highlight(id))
```

### Notifications

Plugin API 1.6.0 adds `context.notifications.send({ title, detail })`, which adds a
notification to the list behind the bell in the Mojito title bar. Use it for something
the user should know about while they are not looking at the plugin's page. It needs no
permission. `title` has 1–80 characters and `detail` 0–500; a length out of range or an
unknown field rejects with `invalid_argument`. Mojito keeps the newest 50 notifications
of all plugins in its main process and clears them when it exits.

A host older than 1.6.0 rejects the call with `unavailable`. A plugin whose `apiVersion`
range allows such a host should treat the notification as optional:

```ts
void context.notifications
  .send({ title: '统计已暂停', detail: '恢复后会自动继续统计。' })
  .catch((error) => context.log.debug('发送通知失败', { error: String(error) }))
```

### Packaged OverlayPlugin pages

Plugin API 1.1.0 supports `compatibility.source: { kind: 'package', entry, documents }`.
Paths refer to this plugin's files; `documents` lists allowed navigation/popup pages and
includes `entry`. Declare `ui.register` and `ui.overlayplugin`, and publish existing
`OverlayState` values through `overlayProducer`. Remote pages use a host-managed profile.

With `data.read`, `context.data.resource(path)` returns the original SqPack file bytes (up to 32 MiB for worker plugins or 3 MiB for native plugins; larger files return `quota_exceeded`), or `null` when absent. `context.data.image(path)` returns a local PNG URL for a TEX resource; `context.data.map('s1f1/00')` returns a composed map URL. These methods return `null` for missing main files. Images are decoded when a plugin page requests the URL, which belongs to the current activation and client data. Reacquire URLs after changing clients; send the URL through a view channel and use it as an image source.

`context.data.rowIds(sheet, language)` returns all actual row IDs of an ordinary EXD sheet, sorted in ascending order. It uses `data.read` and the transport collection limit. Read their cells with `data.rows` in batches no larger than `context.limits.values['data.rowIds']`. Use `none` for sheets without languages; enumerate subrows by reading their known parent row.

### Status-list slots

Plugin API 1.7.0 preserves the original `slot` in every `statusesReplaced.data.statuses`
entry. Empty slots remain omitted. Match a later `statusChanged` by its slot, never by
the filtered list's array index. Query `Status` values are unchanged. Consumers that
require slot tracking should require `apiVersion: "^1.7.0"`.

### Potency samples

`potencySample` gives the hits the host measures the damage per potency with: hits of
the actions of each job that have a fixed potency, on the first target, while the level of
the caster is known. `potency` already follows the combo and the position of the hit. Hits
forced to be critical or direct, and hits under a status that adds potency, are left out.
Critical and direct hits are included: `critical` and `direct` tell them apart, and their
`amount` carries the critical or direct hit bonus. Plugin API 1.8.0 adds the two fields;
an older host gives samples of hits that are neither critical nor direct only, without
them. `amount ÷ potency` is the damage per potency; `multiplier` is the product of the
damage multipliers the host knows, and `factors` lists them with the status, its source
and whether the caster or the target holds it (`statusId` 0 is a modifier of the gauge).

The event comes with the packet of its actionEffect and is not sent without one. It is
available while the periodic model is: otherwise the subscription fails with
`unavailable`. `actorIds` matches the caster or the target and `actionIds` the action;
`statusIds` is not valid for it and fails with `invalid_argument`.
