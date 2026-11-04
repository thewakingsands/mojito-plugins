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

## Publishing the SDK

Push `sdk-v<version>` after setting the version in `packages/plugin-sdk/package.json`.
The tag must match that version and point to a commit on `main`. The SDK workflow
builds, type-checks and tests the SDK before publishing it to npm through OIDC.

Configure the trusted publisher of `@ffcafe/mojito-plugin-sdk` on npm with repository
`thewakingsands/mojito-plugins`, workflow `sdk-publish.yml`, no environment, and
permission to run `npm publish`. No npm token secret is required.
Complete the first publish within two days of adding the npm trusted publisher.

```sh
npm trust github @ffcafe/mojito-plugin-sdk --repo thewakingsands/mojito-plugins --file sdk-publish.yml --allow-publish
```

## Signing official packages

Before the first official release, generate one Ed25519 JWK for all official plugins
and retain it for future updates. Keep the key outside the repository and plugin
input directories:

```sh
pnpm pack:official /path/to/official.jwk EXPECTED_FINGERPRINT
```

The command packs and verifies the existing `dist` trees, reads their signed manifests,
and writes five `.mojito` packages, `SHA256SUMS` and template source archives under
`dist/official`. Plugin versions come from their manifests.

The `official-v*` tag workflow builds without secrets, transfers the runtime trees and
CLI through an artifact, then signs in a separate job. Configure `OFFICIAL_SIGNING_JWK`
as the shared private key secret and `OFFICIAL_SIGNER_FINGERPRINT` as its public
fingerprint variable. Upload the Release attachments to Mojito server manually.
Publishing SDK versions, tags and official packages requires the corresponding release
authorization. The `v0.1.0` source tag used by Cargo is separate from official release tags.

## Author examples

`examples/plugin-worker` runs in a Worker, `examples/plugin-views` demonstrates pages
and development HMR, and `examples/plugin-native-rust` is an independent native author
project. `examples/overlayplugin-fixture` provides synthetic overlay inputs.
Run plugins in an installed Mojito host; building them requires this repository only.
Host integration drivers stay in [Mojito](https://github.com/thewakingsands/mojito).

## Codec and web CI

Codec validation runs on Linux and Windows when its Rust sources, protocol, headers,
test scripts or shared Rust build inputs change. The web build watches its verifier
library, web assets, build script and shared Rust inputs. SDK/plugin sources and pnpm
dependencies do not trigger these jobs. Changes to the checks workflow trigger both.

The browser verifier is built into `dist/package-web` with relative Worker and WASM
URLs, so it works under the `/mojito-plugins/` Pages path. On relevant pushes to `main`,
CI uploads this directory and deploys it through the `github-pages` environment.
Enable Pages with GitHub Actions as its source and allow `main` in that environment
before deployment; the workflow does not enable repository settings automatically.
