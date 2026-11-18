# Publish and update

Publishing a plugin requires two things online: the packaged `.mojito` file and a `catalog.json` that describes it. Users add the `catalog.json` URL in Mojito to see and install the plugins it lists.

## catalog.json

```json
{
  "schemaVersion": 1,
  "releases": [
    {
      "pluginId": "example.my-plugin",
      "version": "0.1.0",
      "apiVersion": "^2.0.0",
      "downloadUrl": "https://example.com/plugins/MyPlugin-0.1.0.mojito",
      "size": 1234,
      "sha256": "…"
    }
  ]
}
```

- `pluginId`, `version` and `apiVersion` are the same as in the package's `plugin.json`.
- `downloadUrl` is the download URL of the `.mojito` file.
- `size` and `sha256` are the byte count and SHA-256 of the whole `.mojito` file; Mojito checks the file against them after downloading.
- Entries for native plugins also need `"os": "win32"` and `"arch": "x64"`. `display` and `changelog` are optional.

See [examples/catalog](https://github.com/thewakingsands/mojito-plugins/tree/main/examples/catalog) for a complete example.

The packaging tool's `pack` and `verify` commands print the complete file's `size` and `sha256`. Query an existing package at any time:

```sh
npx @ffcafe/mojito-package verify ./MyPlugin-0.1.0.mojito
```

Copy the top-level `size` and `sha256` into the release entry. `metadata.archiveSize` and `metadata.archiveSha256` describe the inner archive and have a different meaning.

## Hosting

Both `catalog.json` and `.mojito` must use HTTPS URLs that download the file itself, for example GitHub Pages or `raw.githubusercontent.com` URLs. URLs on the GitHub website with `/blob/` in the path are web pages and cannot be used.

For local testing you can use a local HTTP URL, for example `http://127.0.0.1:18080/catalog.json`.

## Installation

Add the `catalog.json` URL in Mojito's plugin catalog settings, then select a plugin in the list to install it. During installation, users see the plugin's source and permissions and confirm them.

## Publish an update

1. Increase `version` in `plugin.json`; keep the plugin ID.
2. Rebuild, and pack with the same private key.
3. Upload the new `.mojito`, write an entry for the new version in `catalog.json`, and replace `size` and `sha256` with the new file's values.

If only the download URL changes and the file content stays the same, you do not need to pack again; change only `downloadUrl`.

## Lost or replaced private key

Updates must be signed with the original private key. For a version signed with a different private key, Mojito warns users that the publisher changed; if a user continues the installation, all data and permissions of the old plugin are deleted. Back up the private key; see [Package and sign](packaging.md).
