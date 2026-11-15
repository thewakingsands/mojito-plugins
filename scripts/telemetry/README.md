# Telemetry acceptance

English | [简体中文](README.zh-CN.md)

Run `pnpm typecheck`, `pnpm test`, `pnpm lint` and `pnpm build:official`.
`packages/combat-statistics/testdata/telemetry-v1.json` must remain byte-identical
to mojito-server's `testdata/telemetry-v1.json`.

The server's optional `TestTelemetryClientRoundtrip` uses this checkout's real
entry/model/permission/finalization test and replaces only its HTTP transport.
Set `TEST_TELEMETRY_PLUGINS_DIR` and `TEST_TELEMETRY_CLIENT_DATABASE_URL` when
running that test in mojito-server; the database must be fresh and disposable.

For an actual Worker and settings page, build a Plugin API 2.0-compatible Mojito host, then run
with its Electron binary:

```sh
MOJITO_HOST_ROOT=/absolute/mojito \
MOJITO_TELEMETRY_OUTPUT=/absolute/disposable-output \
/absolute/mojito/packages/@ffcafe/mojito-launcher/node_modules/electron/dist/electron \
  scripts/telemetry/isolation.cjs
```

Linux needs a display (a virtual display works). The script installs the built
statistics plugin in a disposable host profile, checks sensitive permission and
automatically saved consent through the real settings page, then injects synthetic live inputs. It
replaces only the host HTTP fetch transport, retaining origin and permission
checks; no test request reaches the production collector. A 503 response and a
restart must not repeat the attempt. `result.json` and a settings screenshot are
written to the output directory. The fixture uses the all-player scope because
Linux cannot read the Windows game process's party memory.

Windows acceptance still needs a real game connection. Verify opt-in and denied
permission, complete status inputs, an eligible encounter's single post-combat
request against an isolated service, and no retry after disconnection/restart.
An encounter without eligible unknown statuses demonstrates no false report;
it does not prove the positive reporting path.

## Offline statistics

Build the model first: `pnpm --filter @ffcafe/mojito-combat-model build`.
Using an administrator session Cookie, request `GET /api/admin/telemetry/events?type=combat.unknown-status`
and save each response as JSON. When `nextCursor` is present, pass it as the next request's `cursor`.
Event arrays are also accepted. The script deduplicates by `eventId`, so overlapping pages are safe.

```sh
pnpm --filter @ffcafe/mojito-combat-model telemetry:stats page1.json page2.json
pnpm --filter @ffcafe/mojito-combat-model telemetry:stats --json --model-version 7.57 page1.json
```

The client uploads normal-hit damage counts, sums, squared sums and potency, plus critical and direct hit
counts and summed known rate additions, without individual hit records. Each encounter makes at most one
attempt. Groups need enough samples, with no 10% damage-deviation requirement. Damage controls use clean
hits from the same encounter, player, action and target; probability controls are pooled per player.
If an event exceeds 1024 observations or 256 KiB, the least sampled observations are dropped first,
preserving every retained status combination in full.

The output contains damage ratios, critical and direct rate differences with 95% intervals, action
categories, mean potency and sample counts. Multiple-status combinations stay together. Missing controls
produce null estimates; invalid events are skipped and counted. The script only reports statistics;
review them manually before changing `ClassJobActions` or common status definitions.
