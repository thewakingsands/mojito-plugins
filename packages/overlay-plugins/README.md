# Overlay plugins

Build the SDK and this workspace to produce `dist/kagerou`, `dist/skyline` and
`dist/mopimopi2`. The build fetches the fixed upstream commits into its own temporary directory. Source
archives and build patches are emitted under `dist/sources` beside the runtime trees.

Each plugin requires Mojito plugin API 1.1.0 and the `CombatStatistics` provider of
`combat.statistics.overlay` v1. Install and enable combat statistics, grant service
communication in the overlay plugin's details, then enable that plugin. Restore a
stopped provider or revoked permission and re-enable the consumer to reconnect.

Use the existing Rust CLI with a private Ed25519 JWK to create each package:

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
