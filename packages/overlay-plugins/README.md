# Overlay plugins

English | [简体中文](README.zh-CN.md)

Build the SDK and this workspace to produce one runtime tree per OverlayPlugin template under `dist`:
`kagerou`, `skyline`, `mopimopi2`, `faceroll`, `horizoverlay`, `cmskin`, `mopimopi1`, `ikegami`, `ember`,
`amethyst`, `klondike` and `glass`. The build fetches the fixed upstream commits into its own temporary directory. Source
archives and build patches are emitted under `dist/sources` beside the runtime trees.

Each plugin requires Mojito plugin API 2.0.0 and the `ffcafe.combat-statistics/overlay` service v1. Install
and enable combat statistics, then enable the overlay plugin. Restore a stopped provider and re-enable the
consumer to reconnect.

Ember loads action and status icons from Mojito's game data through the compatibility page's
`getGameIcon` call. Its worker resolves the game row and returns an activation-bound image URL.
Template builds retain WOFF2 wherever available and copy only the font weights used by the pages.

Use the existing Rust CLI with a private Ed25519 JWK to create each package, for example:

```sh
mojito-package pack dist/kagerou private-key.json Kagerou.mojito lzma2
mojito-package pack dist/skyline private-key.json Skyline.mojito lzma2
mojito-package pack dist/mopimopi2 private-key.json MopiMopi2.mojito lzma2
mojito-package verify Kagerou.mojito
```

Normal builds need no signing key. Each runtime tree includes upstream source links,
version/revision and license notices. The sibling source archives contain the patched
source and build inputs; use the recorded Mojito checkout for the build script's
workspace paths. Template pages load directly from installed `.mojito` resources.
