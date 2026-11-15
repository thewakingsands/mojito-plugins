# Static plugin catalogs

English | [简体中文](README.zh-CN.md)

This example contains a signed no-op Worker plugin for Plugin API 2.0. Its source is
in `plugin`; `first.mojito` contains that source and an embedded signature.
`catalog.json` records the size and SHA-256 of the complete `.mojito` file.
No private signing key is included. Use these artifacts only for testing.

Upload `catalog.json` and `first.mojito` to static hosting. Replace
the catalog's `downloadUrl` with the package's permanent absolute HTTPS URL.
Changing the download URL does not require signing the package again. Changing any
package bytes does.

For GitHub Pages, use direct file URLs such as
`https://<owner>.github.io/<repository>/catalog.json`. For GitHub raw hosting, use
`https://raw.githubusercontent.com/<owner>/<repository>/<ref>/catalog.json`;
`github.com/.../blob/...` pages are not catalog files. Relative URLs are unsupported.
HTTP is accepted only on loopback hosts, such as `http://127.0.0.1:18080/catalog.json`.
HTTPS redirects cannot downgrade to HTTP. ETag and Last-Modified are optional.

Each release requires `pluginId`, `version`, `apiVersion`, `downloadUrl`, `size` and
`sha256`. `display` and `changelog` are optional. Native plugins specify `os: win32`
and `arch: x64` together; Worker plugins omit both. Signatures are embedded in the
package; catalogs do not have a `signatureUrl` field.

Build the CLI and verify the example locally:

```sh
pnpm build:package
./target/release/mojito-package verify examples/catalog/first.mojito
node scripts/package-cli-smoke.mjs
```

Use `target/release/mojito-package.exe` on Windows. Verification checks the embedded
signature and every archive member. A valid self-signature does not authenticate
a publisher; supply a separately trusted fingerprint to `verify` when needed.

To build your own package, keep your private JWK outside the plugin directory and
use the [package CLI](../../crates/package/README.md). Use the size and SHA-256 of the
resulting `.mojito` file in your catalog, and copy its plugin ID, version and API range
from the signed manifest. The host's
[catalog validator](https://github.com/thewakingsands/mojito/tree/master/tools/catalog)
checks metadata with the client's parser and enforces the 2 MiB catalog limit.
