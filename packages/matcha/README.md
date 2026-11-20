# Matcha for Mojito

English | [简体中文](README.zh-CN.md)

Matcha as a Mojito plugin. The backend is ported from `Cafe.Matcha`; the UI uses a fixed commit of `vendor/matcha-overlay` and keeps its AGPL-3.0 license.

## Build and install

From the repository root:

```powershell
git submodule update --init --recursive
pnpm install
pnpm --filter @ffcafe/mojito-matcha... build
```

The output is in `packages/matcha/dist`. Sign it with the existing Rust CLI and your own Ed25519 private JWK:

```sh
mojito-package pack packages/matcha/dist private-key.json Matcha-4.0.0-mojito.10.mojito lzma2
mojito-package verify Matcha-4.0.0-mojito.10.mojito
```

Install the generated `.mojito` package on Mojito's plugin page, grant the sensitive capabilities you want, then enable it. Once running it provides the **Matcha** overlay and the **Matcha 设置** page under Settings › Plugin settings. The main window has no Matcha feature page; everything is in the overlay.

The overlay UI comes from `vendor/matcha-overlay` and is shared with the ACT version: a fixed dark translucent background, with colors, type sizes and controls following Mojito's dark theme. The settings page uses the host's `/host/mojito-base.css`, and changes apply immediately.

The package format and the worker's state publishing use the current Mojito SDK. Plugin API 2.0 is required; capabilities follow the state reported by `context.capabilities.get()`, and changing grants while running needs no restart. Notifications use the SDK's `context.notifications.send`.

## Features

- FATE watch list (bulk selection by expansion and area), presets and notifications; notifications for duty matches, zones, bites, critical engagements and treasure hunt results.
- Market board prices compared with Universalis, gear comparison, Mini Cactpot calculation, treasure map locations and treasure hunt results.
- Submersible parts, voyage status and planning.
- Fishing status, catch archive, community bite-time distribution from 鱼漂, optional anonymous data upload, and export of the fishing log from login data.
- Webhooks, settings backup, and import/export.

One worker collects data and maintains shared state. Opening the settings page or several overlays does not capture or report twice; a new view restores the current state. Old state is cleared when the session, character or replay time changes, or when the packet subscription is interrupted. Ordinary map changes keep the character's fishing log.

## Two data sources

`matcha-overlay` can be built on its own and deployed as a static site for ACT OverlayPlugin. The existing `OVERLAY_WS` WebSocket parameter and `OverlayPluginApi` integration keep working.

When loaded inside Mojito it uses the SDK bridge automatically. `?source=mojito` selects it explicitly; this mode requires a real Mojito bridge. ACT and Mojito modes use separate settings storage, so personal data is never shared between the two hosts.

Mojito mode reads item, map, icon, FATE, duty, world, fishing and submersible data through the host's local data interface. Treasure map coordinates are converted from the game's treasure spot and map sheets; FATEs and critical engagements are tied to areas through client scene resources; presets are read from RelicNote. Data reloads when the client version or data language changes; a failed read shows as unavailable and does not fall back to static game tables or XIVAPI. ACT mode loads its original data separately, and the Mojito build does not include those static tables.

Gear materia slots use the local item-detail atlas, preferring its high-resolution texture. If the atlas is missing, unreadable or has unexpected dimensions, each slot shows its grade or an empty marker, with `+` for overmelds. The ACT overlay uses its bundled slot PNGs.

The exploration unlock prerequisites of submersibles are hand-written rules and still ship with the plugin; names, stats, experience and coordinates all come from the current client. The first read scans the game sheets in batches and keeps only the fields Matcha uses. Community services still go through the host HTTP proxy and follow permissions and CSP.

## Permissions and networking

Session, game info, local data, UI and audio are enabled on install. Packets, memory, HTTP and real character identity are sensitive capabilities that can be refused at install or revoked later. Features without their capability show as unavailable or do nothing; without real character identity the host-provided anonymous identity is used. Import uses the browser file picker, and export saves through a download.

鱼漂 and Universalis each have one switch that controls both queries and uploads, off by default. Replays never trigger notifications, webhooks or uploads. The Universalis API key and uploader ID are injected at build time from the environment variables `MATCHA_UNIVERSALIS_API_KEY` and `MATCHA_UNIVERSALIS_UPLOADER_ID`; users cannot enter them. Without both values at build time, Universalis queries and uploads are unavailable and the switch on the settings page is disabled.

The default network origins are `https://universalis.app` and `https://api.ffxiv.cyou` for Universalis and 鱼漂 queries and uploads. To use your own webhook service, add its HTTPS origin with `--origin` when packaging, then reinstall and grant access.

```powershell
node packages/matcha/scripts/package.mjs --origin=https://your-service.example
```

Custom origins cannot bypass host restrictions through settings; HTTP requests and redirects must match `networkOrigins`, use the system proxy, and time out only as the caller specifies. Settings backups include webhook request headers; keep them safe. The archive keeps Matcha's own single-file storage budget; API 2.0 hosts no longer enforce that budget.

## Data and compatibility

Packets use the type names Mojito provides; no separate opcode table or scanner is introduced. Binary fields follow Matcha's known layouts; the host must still provide a client configuration matching the actual game version. Gathering attributes are read-only; when they cannot be read no values are made up, and incomplete fishing samples are never uploaded.

Backend port source: Cafe.Matcha `15b2d4adece864c7a0f15729d7179e5b7d2ab821`; the frontend version is fixed by the `vendor/matcha-overlay` submodule commit. This package contains none of the source repository's private configuration, release credentials or local acceptance records.

## Development checks

```powershell
pnpm exec vitest run packages/matcha
pnpm --filter matcha-overlay test
```

Tests use synthetic packets and fake HTTP, covering protocol fields, state resets, cross-view restore, consent withdrawal, stale request invalidation and import/export edge cases. Real client version compatibility and external service responses must be confirmed separately in the matching environment.
