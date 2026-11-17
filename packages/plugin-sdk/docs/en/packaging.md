# Package and sign

Users install a `.mojito` file: an archive of the plugin's build output, plus a signature made with your private key. Mojito uses the signature to confirm that updates come from the same publisher.

## Prepare the packaging tool

Install [Node 24 or later](https://nodejs.org/) and use the tool through `npx @ffcafe/mojito-package`. The npm package includes WebAssembly; Rust and system compression tools are unnecessary.

## First time: generate and back up a private key

Generate the private key once and sign every later version with it:

```sh
npx @ffcafe/mojito-package keygen
```

The tool saves the key as `.mojito-keys/author.jwk` in your user directory and shows its location. If the file already exists, it fails and preserves the existing key. Back up the file somewhere safe: anyone who obtains it can publish updates that Mojito treats as yours.

Use `keygen /safe/location/MyPlugin.jwk` for another location. Saving inside a git working tree requires `--allow-git`; add `--gitignore` to append the relative key path to the working tree's `.gitignore`. The default user-directory location is usually sufficient.

Losing or replacing the key changes the publisher as far as users are concerned. Mojito warns users about the change; continuing the installation deletes all data and permissions of the old plugin.

## Every release: pack

Build the plugin first. The build output directory must contain `plugin.json` and every file it references, such as the `dist` from [Pages and overlays](features.md):

```sh
npx @ffcafe/mojito-package pack ./dist
npx @ffcafe/mojito-package verify ./dist.mojito
```

`pack` uses your existing default key, compresses with LZMA2, and writes a `.mojito` beside the input directory with the same name. Repacking replaces the existing package. Both commands verify the signature and every file, then print the manifest and the complete file's `size` and `sha256` for the [catalog](publishing.md).

Use options for another key, output file or compression method:

```sh
npx @ffcafe/mojito-package pack ./dist --key /safe/location/MyPlugin.jwk --output ./MyPlugin-0.1.0.mojito --compression lzma2
```

`--compression copy` disables compression. Keep both the private key and output outside the input directory. The output's `signer.fingerprint` identifies the signing key; packages signed with the same key have the same value.

Modifying or recompressing a `.mojito` invalidates its signature; pack it again.

## Common failures

| Cause | Action |
| --- | --- |
| The key file already exists | Keep using that key; choose another location when generating a new key |
| The key location is inside a git working tree | Use the user directory or explicitly confirm with `--allow-git` |
| `plugin.json` or the entry file is missing | Build first and check `entry.path` |
| The key or output is inside the plugin directory | Move it outside |
| Incomplete or mismatched private key | Restore a complete Ed25519 private JWK backup |
| Symbolic links, conflicting Windows paths or exceeded size limits | Clean up the build output |

The complete package and expanded contents are limited to 256 MiB each, individual files to 32 MiB, and the file count to 4096.

## Check in the browser

The [online tool](https://thewakingsands.github.io/mojito-plugins/) uses the same WASM codec to verify the signature and every file. Files are not uploaded.

For format details, see the [package format description](https://github.com/thewakingsands/mojito-plugins/blob/main/crates/package/README.md). Next: [Publish and update](publishing.md).
