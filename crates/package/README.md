# Mojito plugin package

A Rust codec with a standalone CLI, a Node-API addon and a browser WASM verifier.
The runtime needs no installed archive executable. Packages use non-solid 7z with
Copy or LZMA2; native entries are automatically unplugged.

## Build and use

Use the repository's Node/pnpm versions and stable Rust:

```sh
pnpm build:package
cargo test --locked --package mojito-package
node scripts/package-cli-smoke.mjs
```

The executable is `target/release/mojito-package` (`.exe` on Windows). The codec builds in the root Cargo workspace and is also reused by the host Node addon. Build on Windows, Linux or macOS for the CLI and bindings;
CI exercises all three. The Windows installer uses the same addon.

For the server's native C ABI, build only this library:

```sh
cargo build --locked --release --package mojito-package --lib --features ffi
cargo test --locked --package mojito-package --features ffi
```

Distribute `target/release/mojito_package.dll` (Windows) or
`target/release/libmojito_package.so` (Linux) beside the server executable.
Record the source Git commit with the artifact. The header is
`include/mojito_package.h`; the only C exports are `mojito_package_verify` and
`mojito_package_free`. Verification reads every member. Input is borrowed for the
synchronous call; output is a length-delimited UTF-8 JSON buffer, freed exactly
once by the matching library even on failure. The caller can lower the package
limit from 256 MiB. The `ffi` feature requires panic unwinding and catches Rust
panics at the ABI boundary; it cannot recover from process aborts or allocation
failure. Keep the loaded library alive through all calls and buffer releases.

```sh
mojito-package pack ./plugin ./private.jwk ./plugin.mojito lzma2
mojito-package inspect ./plugin.mojito
mojito-package verify ./plugin.mojito EXPECTED_SHA256_FINGERPRINT
mojito-package read ./plugin.mojito backend/index.mjs
```

Input must contain `plugin.json` and its declared entry. Keep the private Ed25519 JWK
and output outside the input directory. Existing output files are never overwritten.
`copy` disables compression. Directories with spaces and Unicode names are supported;
symlinks, special files and paths that conflict on Windows are rejected. No package
scripts or plugin code execute while packing. CLI verification checks all member CRCs.

An Ed25519 private JWK uses `kty: "OKP"`, `crv: "Ed25519"`, a base64url public `x`,
and private 32-byte seed `d`. Existing Mojito signing keys are accepted. Node can
create one with `generateKeyPairSync('ed25519').privateKey.export({format:'jwk'})`.
Keep the private key confidential and distribute the public fingerprint separately.

The host’s `@ffcafe/mojito-rust` Node entry exports synchronous
`packFiles(files, privateJwk, compression?)`, accepting `{path, bytes}` entries and a private JWK JSON string.
`openPackage(buffer)` runs on the native work queue. The returned
`PackageArchive` owns its bytes; `read(path)` decodes one member, and `readAll()` is
for installation validation. `inspection` and `entries` are JSON strings. The codec
checks format safety and entry existence; the host applies the SDK's manifest schema,
API compatibility and signer continuity rules.

## Publication

Each `.mojito` carries its signature. The distribution package's
`preparePublication(bytes, downloadUrl)` verifies the package and returns the catalog
release for that artifact. The installer stores worker packages as archives and
extracts native packages according to the signed manifest entry.

## Browser

```sh
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.129 --locked
pnpm build:package:web
```

Serve `dist/package-web` using any static HTTP server. It contains the viewer, a worker and
WASM/JS bindings. Files stay in the browser; no backend or upload is used. The worker
verifies the embedded JWS, signed manifest metadata, and the complete inner archive's
size/SHA-256. An optional expected fingerprint binds verification to a known key.
It does not decode individual 7z members or compare their manifest with the signed
copy; CLI and installation perform that additional check. A valid self-signature
does not authenticate a publisher's identity.

## Format version 1

| Bytes | Content |
| --- | --- |
| 0–7 | `MJPKG01` followed by NUL |
| 8–11 | unsigned little-endian compact-JWS byte length |
| 12… | UTF-8 compact JWS, at most 128 KiB |
| remainder | complete unchanged standard 7z archive |

JWS uses EdDSA/Ed25519, `typ: mojito-package+jws`, and a public-only OKP JWK in the
protected header. Its payload contains `formatVersion`, the complete `manifest`,
`archiveSize` and lowercase hexadecimal `archiveSha256`.
The host extracts native entries and reads worker entries from the archive. Version 1
keeps the existing Windows x64 native ABI; cross-platform packing does not expand
native runtime support.

The signed digest covers the inner 7z, while catalog size/hash describe the complete
`.mojito` artifact. Parsing uses the declared prefix length, never a magic scan.
Duplicate JSON keys, unsupported fields/algorithms, noncanonical base64url, changed
bytes, inconsistent manifests, solid blocks, unsafe/conflicting paths, links and
oversized content are rejected. Limits: 256 MiB package, 256 MiB expanded, 32 MiB per
member, 4096 entries. 7z header parsing uses sevenz-rust2; data blocks accept Copy/LZMA2.

Mojito installs JS packages as one immutable archive snapshot and serves their ESM,
HTML and assets through `mojito-plugin:`. Reading compressed JS still decodes it in
memory. Native packages are extracted to the version directory before loading. Both
modes retain the existing transaction journal, rollback and publisher-key binding.

Direct archive-tool compatibility is verified for 7-Zip 25.01 and 26.05. It is not a
promise for every archive tool: libarchive 3.7.4 rejects nonempty custom prefixes.
Editing or repacking with another tool invalidates the signature; sign the result
again with this codec.
