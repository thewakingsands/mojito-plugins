# Telemetry acceptance

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
