# Overlay plugins

English | [简体中文](README.zh-CN.md)

Build the SDK and this workspace to produce one runtime tree per OverlayPlugin template under `dist`:
`kagerou`, `skyline`, `faceroll`, `horizoverlay`, `cmskin`, `mopimopi1`, `ikegami`, `ember`,
`amethyst`, `klondike` and `glass`. The build fetches the fixed upstream commits into its own temporary directory.

Ember requires Mojito plugin API 2.3.0. The other plugins require API 2.0.0.
All require the `ffcafe.combat-statistics/overlay` service v1. Install
and enable combat statistics, then enable the overlay plugin. Restore a stopped provider and re-enable the
consumer to reconnect.

Character names in combat statistics follow the overlay's `identity.read` permission. When it is off, the overlay
uses stand-in names for players. Ember clears its recent encounter list when the name visibility changes.

Ember uses structured game observations for the party list, skill and status timers, and HP/MP warnings.

CMSkin, Ember, Faceroll, Glass, Horizoverlay, Ikegami (legacy icon style), Kagerou and MopiMopi1
read game job icons through `getGameIcon` using the ClassJob row number. A missing image shows the job
abbreviation. Ember also supports action and status icons.
Template builds retain WOFF2 wherever available and copy only the font weights used by the pages.

Horizoverlay includes base combat classes in the default combatant list. Enable its jobless setting to show rows with no recognized job.

Use the existing Rust CLI with a private Ed25519 JWK to create each package, for example:

```sh
mojito-package pack dist/kagerou private-key.json Kagerou.mojito lzma2
mojito-package pack dist/skyline private-key.json Skyline.mojito lzma2
mojito-package verify Kagerou.mojito
```

Normal builds need no signing key. Each plugin homepage opens its pinned upstream
source. The runtime tree records the matching patch in `SOURCE.txt` and retains the
license notices. Template pages load directly from installed `.mojito` resources.

`registerCombatants(ctx, channel)` in `src/combatants.ts` registers `${channel}/combatants` for modern
`getCombatants` calls; register it before opening the overlay and dispose it when stopping. Ember uses `combat`.
Queries support ID/name union filtering and case-sensitive `props` projection. Names match fully, ignoring case.
Empty filters select all actors; empty `props` selects all available fields.

Supported fields are `ID`, `Name`, `Job`, `Level`, `CurrentHP`, `MaxHP`, `CurrentMP`, `MaxMP`,
`PosX`, `PosY`, `PosZ`, `Heading`, `OwnerID`, `TargetID`, `WorldID`, `CurrentWorldID`, `WorldName`,
`BNpcID`, `BNpcNameID` and `Type`. Missing values are omitted; known absent owner/target IDs are zero.
Position uses game x/z/y, with height in `PosZ`. Heading preserves radians. When requested and data is
available, `WorldName` reads the home world's display name from the client's `World` table. Queries
preserve SDK identity handling and return `unavailable` if their source changes before completion.
