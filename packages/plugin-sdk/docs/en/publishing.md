# Publish and update

Publishing a plugin requires two things online: the packaged `.mojito` file and a `catalog.json` that describes it. Users add the `catalog.json` URL in Mojito to see and install the plugins it lists.

## catalog.json

To create an entry for a signed package, read its verification result. The `pack` command returns the same fields.

```sh
npx @ffcafe/mojito-package verify ./MyPlugin-0.1.0.mojito
```

| Catalog field | Value |
| --- | --- |
| `manifest` | Copy the complete `metadata.manifest` object. |
| `pluginId`, `version`, `apiVersion` | Use `id`, `version` and `apiVersion` from that manifest. |
| `signer` | Copy the fingerprint string from `signer.fingerprint`. |
| `size`, `sha256` | Copy the top-level values for the entire file. The [package workbench](https://thewakingsands.github.io/mojito-plugins/) also copies these two fields with **复制发布信息 JSON**. |
| `downloadUrl` | Use the direct HTTPS URL of your published `.mojito` file. |

For a native plugin, also copy `os` and `arch` from `manifest.entry`. You may add a `changelog` to the release.

The following catalog installs the [signed example package](https://github.com/thewakingsands/mojito-plugins/tree/79d7fa99ce718609bb0423ad7be43d38175c9410/examples/catalog).

```json
{
  "schemaVersion": 1,
  "releases": [
    {
      "pluginId": "example.static-catalog",
      "version": "1.0.0",
      "apiVersion": "^2.0.0",
      "downloadUrl": "https://raw.githubusercontent.com/thewakingsands/mojito-plugins/79d7fa99ce718609bb0423ad7be43d38175c9410/examples/catalog/first.mojito",
      "size": 1071,
      "sha256": "46a937c4c4e517ba7a29cd6064d70b437e5d3f0b8cb862e9c05aa749620fa331",
      "manifest": {
        "apiVersion": "^2.0.0",
        "capabilities": [],
        "entry": {
          "kind": "worker",
          "path": "entry.mjs"
        },
        "id": "example.static-catalog",
        "name": "Static catalog example",
        "networkOrigins": [],
        "schemaVersion": 1,
        "version": "1.0.0"
      },
      "signer": "83b2b626af08d925f9dc103e1b3515797b2bb097b073291e5516afb751cf9af4"
    }
  ]
}
```

## Hosting

Both `catalog.json` and `.mojito` must use HTTPS URLs that download the file itself, for example GitHub Pages or `raw.githubusercontent.com` URLs. URLs on the GitHub website with `/blob/` in the path are web pages and cannot be used.

For local testing you can use a local HTTP URL, for example `http://127.0.0.1:18080/catalog.json`.

## Installation

Add the `catalog.json` URL in Mojito's plugin catalog settings, then select a plugin in the list to install it. During installation, users see the plugin's source and permissions and confirm them.

## Publish an update

1. Increase `version` in `plugin.json`; keep the plugin ID.
2. Rebuild, and pack with the same private key.
3. Upload the new `.mojito` file. Replace the plugin's entry in `catalog.json` using the new package's verification result and download URL.

If only the download URL changes and the file content stays the same, you do not need to pack again; change only `downloadUrl`.

## Lost or replaced private key

Updates must be signed with the original private key. For a version signed with a different private key, Mojito warns users that the publisher changed; if a user continues the installation, all data and permissions of the old plugin are deleted. Back up the private key; see [Package and sign](packaging.md).
