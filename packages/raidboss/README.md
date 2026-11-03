# Raidboss runtime (preview)

This package adapts the fixed cactbot revision recorded in
[vendor/cactbot/PROVENANCE.md](vendor/cactbot/PROVENANCE.md). It consumes structured
Mojito events; production matching never synthesizes combat log lines. The ordinary
Worker plugin is `@ffcafe/mojito-plugin-raidboss`, with the fixed upstream rule and timeline corpus. P1N is the reference acceptance
encounter. Each rule reports unsupported or unavailable inputs separately.

Build the SDK and runtime, then `@ffcafe/mojito-plugin-raidboss`. Sign the generated directory
with the existing package CLI:

```sh
mojito-package pack packages/plugin-raidboss/dist private-key.json Raidboss.mojito lzma2
mojito-package verify Raidboss.mojito
```

The private key is an Ed25519 JWK and stays outside the package. The signed package installs
through the normal plugin UI. The plugin requires host Plugin API 1.7.0 for complete status-list slots.
Collection strategy defaults and saved overrides are available in the management page
while the collection is active. Collections with `resetWhenOutOfCombat: false` retain
their state until an explicit reset or source/zone change.

Synthetic tests cover the complete P1N trigger corpus, pinned upstream network-regex
matching and callback order, translated conditions, party class/job roles, coordinate
axes, multi-target ordering, timeline windows and loop/reset, cancellation, isolated
rule faults, missing fields, and configuration conflicts. The order oracle shares
output helpers with the adapted runtime; it does not independently verify browser
rendering, speech, or actual game recordings. No real player data is in the fixtures.

Unsupported event types and fields are explicit per-rule diagnostics. A necessary
unavailable timeline sync stops that timeline and its attached triggers. Historical
names are never filled from a later entity snapshot. Party roles require real entity
classJob observations. Missing query properties fail instead of returning fabricated
zeros. Old recordings or hosts with unavailable player identity/combat fields can
therefore prevent complete P1N activation; no inferred combat or identity fallback is
used here.

The registration snapshot retains callback objects and closures, while matching
parameters are copied at module load. Configure rules by stable set/id. Text is
rendered as text, and all views share one Worker and one audio output path. Enable
only one Raidboss plugin. Audio is optional; absence of the grant leaves text visible.

Community source packages can be built with the [repository tool](../raidboss-tools/README.md). Its synthetic acceptance does not replace real community-file or P1N validation.

CombatantMemory is projected from observed entity differences. Repeated NPC generation
uses the ordered `npcSpawn` event rather than snapshot differences. Legacy text-only
conditions require structured replacements and do not silently fall back to log matching.
