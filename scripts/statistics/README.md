# Statistics acceptance

English | [简体中文](README.zh-CN.md)

Build `@ffcafe/mojito-combat-model` and `@ffcafe/mojito-combat-statistics`, and build a compatible Mojito host. Run the following from the plugin repository. Output directories must be disposable; the driver installs the plugin and clears its own history.

```sh
MOJITO_ACCEPTANCE_OUTPUT=/absolute/capacity.json \
  pnpm exec vitest run packages/combat-statistics/src/log/acceptance.test.ts

DISPLAY=:99 MOJITO_HOST_ROOT=/absolute/mojito \
MOJITO_ACCEPTANCE_OUTPUT=/absolute/worker-results \
  /absolute/electron --js-flags=--expose-gc scripts/statistics/acceptance.cjs
```

The capacity test generates 24 members, pets, 150 skills per member, 15 targets and 100 fights. It compares integer totals, duplicate ticks/revisions, pending allocations, pet merging and every reopened log summary. JSON summary sizes and stored Parquet sizes are reported separately, using the installed plugin's declared 2 GiB / 16 MiB limits.

The Electron driver uses the production host, Worker and feature/settings pages. It runs the same synthetic load (24 attackers and an unknown periodic tick every three seconds) once to warm up the Worker and UI, then measures five more rounds. Each round advances one hour of source time at unlimited speed and observes the stopped activation for 60 wall-clock seconds. This is a synthetic stress run, not a real recording or one hour of continuous real-time operation. `MOJITO_ACCEPTANCE_SECONDS` and `MOJITO_ACCEPTANCE_SETTLE_MS` can shorten a diagnostic run; report their actual values.

`result.json` records commits, versions, exact totals, queue counts, RPC timing in the main process (excluding intentional clock waits), process-tree RSS and cleanup counts. The detailed memory and drain samples are in `round-*.json`; keeping those traces out of the summary prevents the probe from retaining previous rounds in memory. RSS is the sum of Electron process working sets, so shared pages can be counted more than once. A Worker shares its renderer process and is not added again.

The required deterministic checks are exact integer totals, no unacknowledged input at the end, the same subscription/source-timer/window counts after every stop, destroyed Worker owner and feature view, unchanged message counts and log hashes after stop, and matching history after reopening. The page's clear action must remove completed history. The capacity test also requires zero pending allocations after post revisions. A load that repeatedly reaches the bounded drain timeout or whose queue keeps growing needs investigation even if it eventually drains.

After each stop and observation period, the driver takes nine samples one second apart in the same idle state. It runs main-process GC before each sample. For each metric, `memoryTrend` reports the samples, each round's median and range (max minus min), the largest within-round range as the observed fluctuation, and signed differences between consecutive medians. The warm-up is recorded separately.

For a main-process heap comparison, set `MOJITO_ACCEPTANCE_HEAP_SNAPSHOTS=1`. The driver takes snapshots after idle sampling in measured rounds 1 and 5 and reports the largest retained-size changes by V8 node type and constructor or label. Retained size follows the dominator tree with weak edges excluded. It counts nested instances of the same group once; different groups may overlap. Review growth alongside the reported owners, object counts and compiled-code sizes. Keep raw snapshots local.

Memory measurements and snapshot errors are diagnostic. Only the deterministic checks decide the exit status.

## Real recordings and Windows

The host already has `scripts/plugin-isolation/combat-replay-main.cjs`, which reads an `.mjrec` through the production ParserService, PacketSession and plugin host:

```sh
MOJITO_COMBAT_OUTPUT=/absolute/disposable-profile \
  /absolute/electron /absolute/mojito/scripts/plugin-isolation/combat-replay-main.cjs \
  --plugins-root /absolute/mojito-plugins --recording /absolute/sample.mjrec \
  --speed 1 --out /absolute/private-results.json
```

The recording must contain its client profile and opcode table. Use a complete recording of at least an hour of source time when available, record its actual duration/client version/input gaps, and compare a 1x run with an unlimited run (`--speed 0`). That existing driver writes raw event rows; retain them locally along with the recording. It does not collect the resource measurements of `acceptance.cjs`: for the real-recording resource check, capture the main-process request/reply and queue samples, process memory and post-stop resources alongside it. Do not claim the synthetic result as that missing check.

Game capture, live party-memory identity, real cross-world names/pet changes and same-fight ACT comparison require the game environment. Compare reported healing, observed and estimated periodic amounts, unknown amounts, damage taken and deaths separately. Keep actor identities and original logs local; share aggregate measurements and coverage gaps only.
