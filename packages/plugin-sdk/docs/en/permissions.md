# Permissions

Declare the names you use in manifest `capabilities`. Ordinary capabilities are granted at installation. Users can decline individual sensitive capabilities or revoke them while the plugin runs.

`context.capabilities.get()` returns declared capabilities as `available`, `denied`, or `unavailable` with a reason. The host updates the SDK snapshot through `capabilitiesChanged`; read it again when needed instead of permanently caching the initial grant.

## Ordinary capabilities

| Name | Purpose |
| --- | --- |
| `session.read` | Session state and changes |
| `game.read` | Structured player, entity, party and zone state |
| `events.read` | Parsed game events |
| `data.read` | Game sheets, resources, icons and maps |
| `ui.register` | Register features, settings, home panels and overlays |
| `ui.overlayplugin` | Register OverlayPlugin-compatible pages |
| `ui.overlayplugin.remote` | Use host-managed remote OverlayPlugin profiles |
| `audio.play` | Play packaged audio |
| `tts.say` | Speak in the plugin's speech channels |
| `tts.provide` | Offer voices to the host |
| `services.provide` | Provide plugin services |
| `services.consume` | Consume services declared in the manifest |

An undeclared ordinary capability causes the corresponding operation to reject with `permission_denied`. Even granted capabilities may have no data without a game session or resource; see [Data availability](api/data-model.md).

## Sensitive capabilities

| Name | When granted | When undeclared or declined |
| --- | --- | --- |
| `identity.read` | Read actual player identities | Per-session stand-in actor IDs and race/job names; no content ID or `gameLog`. Filters using stand-in IDs still work |
| `packets.read` | Subscribe to raw IPC packets | The subscription opens but sends no data |
| `memory.read` | Resolve signatures, read or watch memory | Calls reject with `unavailable` and a reason |
| `http.request` | Make background HTTP requests through the host | Calls reject with `unavailable` and a reason |
| `microphone.record` | Record in a view using `getUserMedia({ audio: true })` | The browser rejects with `NotAllowedError` |

Identity policy affects player IDs, names and some event parameters. Do not persist stand-in IDs as identities across sessions. In capability state, `denied` is the user's choice; `unavailable` means the host cannot currently provide the capability.

## Network and views

`networkOrigins` lists origins available to requests and view resources. Background `context.http.request` also requires the sensitive `http.request` capability. Every redirect hop must match an origin. Requests use the system proxy; `timeoutMs` applies only when supplied.

View network resources follow their declared origins. Development HMR uses a separately registered and confirmed destination; see [Development](development.md).

`host.openExternal(url)` asks the user each time and requires no capability. Configuration, plugin storage, logging, notifications, the clock and the Worker/view bridge need no extra capability. Views read files through browser file inputs and save through downloads.

## Service authorization and migration

Service providers answer with their own capabilities. Installation explains which services the consumer will use. The ordinary `services.consume` capability and `services.consumes` declaration do not require an additional per-call service grant.

API 2 uses one capability array, `tts.say` for speech and `pluginId/name` for service names. Rebuild 1.x plugins using the current manifest. The SDK's [capability lists](https://github.com/thewakingsands/mojito-plugins/blob/main/packages/plugin-sdk/src/types.ts) define the current names.
