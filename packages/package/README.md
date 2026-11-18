# Mojito package tools

English | [简体中文](README.zh-CN.md)

Package, sign and verify Mojito plugins with Node 24 or later. The npm package includes the same WASM codec used by the browser tool.

```sh
npx @ffcafe/mojito-package keygen
npx @ffcafe/mojito-package pack ./dist
npx @ffcafe/mojito-package verify ./dist.mojito
```

Generate the private key once and back it up. The default location is `.mojito-keys/author.jwk` in your user directory. Existing keys are preserved. Losing or replacing the key changes the plugin's publisher; continuing such an update deletes the old plugin's data and permissions.

`pack` uses the default key and LZMA2 compression, writes beside the input directory and replaces existing output. Use `--key`, `--output`, and `--compression copy|lzma2` to override these defaults. Keep the key and output outside the input directory. Both `pack` and `verify` print JSON containing the complete file's `size` and `sha256` for catalog entries.

`keygen [PRIVATE_JWK]` accepts another location. Saving inside a git working tree requires `--allow-git`; add `--gitignore` to append the relative key path to `.gitignore`.

## JavaScript API

```js
import { generatePrivateKey, validatePrivateKey, packFiles, verifyPackage } from '@ffcafe/mojito-package'

const privateJwk = generatePrivateKey()
const signer = validatePrivateKey(privateJwk)
const bytes = packFiles(files, privateJwk, 'lzma2')
const result = verifyPackage(bytes)
```

`files` is an array of `{ path, bytes: Uint8Array }`. Private keys use JWK JSON text across all operations; `validatePrivateKey` returns only `{ publicKey, fingerprint }`. Verification checks the signature, archive, manifest and every member's size and CRC. Invalid inputs throw errors.

Browser and module worker consumers import the same operations plus `init` from `@ffcafe/mojito-package/web`, then `await init()` before use. The module loads its included WASM using a relative URL. Key generation uses the runtime's secure random source. Files are processed locally.

See the [plugin developer guide](https://thewakingsands.github.io/mojito-plugins/docs/en/packaging).

## License

AGPL-3.0-only. See [LICENSE](LICENSE).
