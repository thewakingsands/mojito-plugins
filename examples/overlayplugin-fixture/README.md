# Synthetic overlay service fixture

Use an isolated acceptance profile. This fixture deliberately uses the CombatStatistics
ID to supply synthetic `CombatStatistics/overlay` states to the three standalone
plugins; install the real combat-statistics package in normal profiles.

Build this repository’s SDK, statistics and overlay plugin workspace, then run:

```sh
pnpm exec vite build --config examples/overlayplugin-fixture/vite.config.ts
```

The fixture output is `.tmp/overlayplugin-fixture`. Package it and the three overlay
plugin directories with the existing Rust CLI. Enable the fixture provider, then the
consumers. The fixture control feature
publishes synthetic scenarios through the same service contract and handles end-encounter
commands. No real account, game input or live client is used.

For remote protocol checks a harness can define `__OVERLAY_FIXTURE_SOURCES__` to refer
to host-managed profiles. Package pages and popups are restricted to declared documents
and own resources; the host supplies its sandboxed compatibility preload. Remote profiles
keep their existing HTTP(S) networking and permission restrictions.

Acceptance drivers can call `fixtureState(state)` from the control view to publish a
synthetic `OverlayState`. The fixture validates it with the SDK before publication;
this permits precise final-frame revisions without changing statistics calculations.
