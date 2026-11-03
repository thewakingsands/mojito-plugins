# Community Raidboss package builder

Build the fixed runtime, the shared plugin views and this tool from the repository root:

```sh
pnpm --filter @ffcafe/mojito-plugin-sdk build
pnpm build:package
pnpm --filter @ffcafe/mojito-raidboss build
pnpm --filter @ffcafe/mojito-plugin-raidboss build
pnpm --filter @ffcafe/mojito-raidboss-tools build
node packages/raidboss-tools/dist/cli.js \
  --key /path/to/private-key.json \
  --id MyRaidbossRules --name 'My Raidboss rules' --version 1.0.0 \
  --entry /path/to/rules.ts --timeline /path/to/timeline.txt \
  --out /path/to/MyRaidbossRules.mojito
```

`--entry` and `--timeline` may be repeated. Entries must be local `.js`, `.mjs` or
`.ts` files on a common filesystem root. Timeline keys are their filenames; duplicate
names fail. Keep an explicit stable `set.id` and `trigger.id` when updating rules.
For a set without an ID, its entry path relative to the common entry directory is the
fallback identity. Use a community plugin ID, distinct from `MojitoRaidbossOfficial`.

Entries may default-export a trigger set or use `Options.Triggers.push(...)` /
`Options.Triggers = [...]`. Normal dynamic construction and callback closures are
preserved. Registration closes after module loading; runtime additions are unsupported.
Local helper imports are bundled. Fixed helper imports such as
`@cactbot/resources/outputs` refer to the pinned adapted cactbot resources.
Node builtin imports, remote modules and unknown package imports fail. The tool does
not install dependencies or run the input's npm scripts, build plugins or tsconfig.
Compilation does not execute the input; enabling the resulting ordinary Worker plugin
does execute it under the existing host permissions.

The result includes the shared management page, overlay, fixed runtime provenance and
license. It uses the existing Rust codec to produce a signed `.mojito` envelope and 7z archive,
the generated envelope can be verified with the same CLI. `--key` is an Ed25519 private JWK;
keep it outside source and plugin directories. Import
it through the normal plugin installer and enable only one Raidboss plugin. Audio is
optional. A loaded rule is not proof of real-game compatibility: unsupported fields,
legacy whole-line matchers and unavailable timeline syncs retain their existing
per-rule diagnostics. Complete old matchers with type/netRegex in plugin settings,
preserving all source/target constraints; edit timeline sources and rebuild when their
syncs need conversion. The builder adds no permissions or log-line fallback.

Synthetic build/runtime tests cover registration, closures, partial support, path and
package validation. Real community files and Windows P1N view/audio acceptance still
need their own evidence; do not distribute actual player recordings with source rules.
