# Mojito plugins

English | [简体中文](README.zh-CN.md)

[Plugin development documentation](https://thewakingsands.github.io/mojito-plugins/docs/en/): API, permissions, views, style, signing and publication.

The Mojito plugin SDK, package codec, author examples and official plugins.
Use Node 24, pnpm 12.13.0 and stable Rust. Clone this repository on its own:

```sh
git submodule update --init --recursive
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
Skyline records the pinned upstream commit time as its build date.

## Packages

- `packages/plugin-sdk`: `@ffcafe/mojito-plugin-sdk` and its public exports.
- `packages/matcha`: Matcha worker, settings and bundled UI from `vendor/matcha-overlay`.
- `packages/combat-model`: the combat model (periodic damage splits, buff attribution, potency samples).
- `packages/combat-statistics`: combat statistics and its overlay service.
- `packages/overlay-plugins`: the OverlayPlugin template plugins (Kagerou, Skyline, MopiMopi2 and others).
- `packages/raidboss`: the fixed Raidboss runtime and rule corpus.
- `packages/plugin-raidboss`: the official Raidboss plugin and shared views.
- `packages/raidboss-tools`: the community rule package builder.
- `packages/plugin-skill-display`: SkillDisplay, described below.
- `packages/deepseek-tts`: DeepSeek voices, described below.
- `crates/plugin-protocol` and `include`: the shared native protocol and C ABI.
- `crates/package`: the CLI, codec, native verifier and browser verifier.

Package names and plugin IDs remain stable. The host consumes the SDK as a git dependency
on a fixed commit of this repository, which pnpm builds with its `prepare` script, and
the native packages through a Cargo git tag. Do not push an `sdk-v*` tag for such a
commit: the tag publishes the SDK to npm. When changing both repositories, use temporary
local links or Cargo overrides for development, then commit locked git sources. Keep
those local overrides out of commits.

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
and writes one `.mojito` package per official plugin (the list is in
`scripts/pack-official.mjs`), `SHA256SUMS` and template source archives under
`dist/official`. Plugin versions come from their manifests.

The `official-v*` tag workflow builds without secrets, transfers the runtime trees and
CLI through an artifact, then signs in a separate job. Configure `OFFICIAL_SIGNING_JWK`
as the shared private key secret and `OFFICIAL_SIGNER_FINGERPRINT` as its public
fingerprint variable. Signed artifacts remain available as GitHub Release attachments.

The upload job takes `.mojito` packages from the signed artifact and uploads them as
Mojito server drafts. Set `ci_upload_token` / `MOJITO_CI_UPLOAD_TOKEN` on the server,
configure the same credential as the repository secret `MOJITO_SERVER_UPLOAD_TOKEN`,
and set the server root address in the repository variable `MOJITO_SERVER_URL`.
Confirm the signer and publish to TEST and PROD in the administration interface.
Use Actions' **Re-run failed jobs** after an upload failure to reuse the original signed
artifact. Re-uploading an identical published package succeeds; changed bytes require
bumping the corresponding plugin's manifest version.
Publishing SDK versions, tags and official packages requires the corresponding release
authorization. The `v0.1.0` source tag used by Cargo is separate from official release tags.

## Author examples

`examples/plugin-worker` runs in a Worker, [`examples/plugin-views`](examples/plugin-views/README.md)
demonstrates pages and development HMR, and `examples/plugin-native-rust` is an independent native author
project. [`examples/overlayplugin-fixture`](examples/overlayplugin-fixture/README.md) provides synthetic
overlay inputs. `examples/tts-provider` offers two beep voices and speaks in two TTS channels.
[`examples/catalog`](examples/catalog/README.md) provides a static publication example
with a signed `.mojito` package and matching catalog metadata.
Run plugins in an installed Mojito host; building them requires this repository only.
Host integration drivers stay in [Mojito](https://github.com/thewakingsands/mojito).

## Codec and web CI

Codec validation runs on Linux and Windows when its Rust sources, protocol, headers,
test scripts, the catalog example or shared Rust build inputs change. On pull requests, the web build watches its verifier
library, web assets, build script and shared Rust inputs. SDK/plugin sources and pnpm
dependencies do not trigger these jobs. Changes to the checks workflow trigger both.

The browser verifier is built into `dist/package-web` with relative Worker and WASM
URLs, so it works under the `/mojito-plugins/` Pages path. When the repository variable
`PAGES_DEPLOY_ENABLED` is `true`, each push to `main` builds the verifier and documentation
into one `dist/pages` artifact, with documentation under `docs/`, and deploys through
the `github-pages` environment. Enable
Pages with GitHub Actions as its source, allow `main` in that environment, and authorize
deployment before setting that variable; the workflow does not enable settings automatically.

## SkillDisplay

`packages/plugin-skill-display` shows a time strip of your own executed skills. Add SkillDisplay
from the host's overlay manager, then choose the time window, icon size and direction in the plugin
settings. The settings page includes a looping preview; topmost, lock and click-through use the
host's overlay controls.

## DeepSeek voices

`packages/deepseek-tts` gives Mojito DeepSeek's 海星 (stella) and 暗潮 (tide) TTS voices. It needs your
own DeepSeek API key: enter it on the plugin's settings page and the voices become available in Mojito's
TTS settings. The settings page also shows the cost so far, estimated at list price.
