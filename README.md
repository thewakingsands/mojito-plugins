# Mojito plugins

The Mojito plugin SDK, package codec, author examples and official plugins.
Use Node 24, pnpm 12.13.0 and stable Rust. Clone this repository on its own:

```sh
pnpm install --frozen-lockfile
pnpm build:official
pnpm typecheck
pnpm test
pnpm test:package
pnpm test:official
pnpm lint
```

`build:official` builds the SDK, Rust CLI and official plugins without a signing key.
The overlays fetch the upstream URLs and full commits recorded in
`scripts/overlay-templates/build.mjs`, then apply the checked-in patches and lockfiles.
Their source archives and licenses are included beside the generated runtime trees.

## Packages

- `packages/plugin-sdk`: `@ffcafe/mojito-plugin-sdk` and its public exports.
- `packages/combat-statistics`: combat statistics and its overlay service.
- `packages/overlay-plugins`: Kagerou, Skyline and MopiMopi2 plugins.
- `packages/raidboss`: the fixed Raidboss runtime and rule corpus.
- `packages/plugin-raidboss`: the official Raidboss plugin and shared views.
- `packages/raidboss-tools`: the community rule package builder.
- `crates/plugin-protocol` and `include`: the shared native protocol and C ABI.
- `crates/package`: the CLI, codec, native verifier and browser verifier.

Package names and plugin IDs remain stable. The host consumes a fixed npm SDK version
and a Cargo git tag. When changing both repositories, use temporary local links or
Cargo overrides for development, then commit published versions and locked git sources.
Keep those local overrides out of commits.

## Signing official packages

Use the existing official Ed25519 JWK and its public fingerprint, after confirming
that all published official IDs use that signer. Keep the key outside the repository
and plugin input directories:

```sh
pnpm pack:official /path/to/official.jwk EXPECTED_FINGERPRINT
```

The command packs and verifies the existing `dist` trees, reads their signed manifests,
and writes five `.mojito` packages, `SHA256SUMS` and template source archives under
`dist/official`. Plugin versions come from their manifests.

The `official-v*` tag workflow builds without secrets, transfers the runtime trees and
CLI through an artifact, then signs in a separate job. Configure `OFFICIAL_SIGNING_JWK`
as the existing private key secret and `OFFICIAL_SIGNER_FINGERPRINT` as its public
fingerprint variable. Upload the Release attachments to Mojito server manually.
Publishing SDK versions, tags and official packages requires the corresponding release
authorization. The `v0.1.0` source tag used by Cargo is separate from official release tags.

## Author examples

`examples/plugin-worker` runs in a Worker, `examples/plugin-views` demonstrates pages
and development HMR, and `examples/plugin-native-rust` is an independent native author
project. `examples/overlayplugin-fixture` provides synthetic overlay inputs.
Run plugins in an installed Mojito host; building them requires this repository only.
Host integration drivers stay in [Mojito](https://github.com/thewakingsands/mojito).
