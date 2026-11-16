# Package and sign

Use this repository's `mojito-package` to build, sign and verify `.mojito` packages. Prepare a `plugin/` directory containing only runtime files: `plugin.json`, its declared entry, pages and resources.

## Generate a publisher key

Save this as `keygen.mjs` outside `plugin/`. It creates a private Ed25519 JWK and prints the SHA-256 fingerprint of the raw public-key bytes:

```js
import { createHash, generateKeyPairSync } from 'node:crypto'
import { writeFileSync } from 'node:fs'

const { privateKey } = generateKeyPairSync('ed25519')
const jwk = privateKey.export({ format: 'jwk' })
writeFileSync(process.argv[2], JSON.stringify(jwk), { mode: 0o600, flag: 'wx' })
console.log(createHash('sha256').update(Buffer.from(jwk.x, 'base64url')).digest('hex'))
```

Retain the private key for future releases. Updates with the same plugin ID use the same key. Distribute the public fingerprint through a separately trusted channel.

## Pack and verify

Run from the repository root. Replace `EXPECTED_FINGERPRINT` with the printed fingerprint. On Windows use `target/release/mojito-package.exe`.

```sh
pnpm build:package
node keygen.mjs ./author.jwk
./target/release/mojito-package pack ./plugin ./author.jwk ./plugin.mojito lzma2
./target/release/mojito-package inspect ./plugin.mojito
./target/release/mojito-package verify ./plugin.mojito EXPECTED_FINGERPRINT
```

Keep `author.jwk`, `keygen.mjs` and the output outside the input directory. The CLI refuses to overwrite output; use a new output name when packing again. Replace `lzma2` with `copy` to disable compression.

Both `inspect` and `verify` check the signature, full archive digest and every member. Supplying an expected fingerprint also binds verification to that public key. Publisher identity depends on the fingerprint you trust independently.

## Common failures

| Cause | Action |
| --- | --- |
| Missing manifest or declared entry | Build browser ESM / native files first and check `entry.path` |
| Existing output, or key/output inside input | Select a new path outside the input directory |
| Mismatched private JWK `x` and `d` | Use a complete private JWK from the same Ed25519 pair |
| Conflicting paths, symlinks or package limits | Prepare runtime files according to [Manifest](manifest.md) and the format documentation |
| Different signer fingerprint | Check the expected publisher key and actual signer |

Limits are 256 MiB for the complete package, 256 MiB expanded, 32 MiB per member and 4096 entries. Modifying or repacking signed bytes invalidates the signature; sign the result again.

## Browser verifier

The site's root [verifier](https://thewakingsands.github.io/mojito-plugins/) reads files locally and checks the embedded signature, signed metadata and inner archive size/SHA-256. The CLI and installer also decode members, check CRCs and compare the archived manifest. Run CLI verification before publishing.

See the [package format and bindings](https://github.com/thewakingsands/mojito-plugins/blob/main/crates/package/README.md). Next: [Publish and update](publishing.md).
