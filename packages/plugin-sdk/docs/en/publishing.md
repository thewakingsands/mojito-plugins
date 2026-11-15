# Publish and update

Upload the signed `.mojito` to a stable HTTPS URL, then publish a static `catalog.json` pointing to it. Start from the [catalog example](https://github.com/thewakingsands/mojito-plugins/tree/main/examples/catalog).

## Catalog release

```json
{
  "schemaVersion": 1,
  "releases": [{
    "pluginId": "SessionNotes",
    "version": "1.0.0",
    "apiVersion": "^2.0.0",
    "downloadUrl": "https://example.com/plugins/SessionNotes-1.0.0.mojito",
    "size": 1234,
    "sha256": "REPLACE_WITH_COMPLETE_PACKAGE_SHA256"
  }]
}
```

`size` and `sha256` above are placeholders. Replace them with the actual complete `.mojito` file's values before publishing. Copy `pluginId`, `version` and `apiVersion` from its signed manifest.

```sh
node --input-type=module -e "import{readFileSync}from'node:fs';import{createHash}from'node:crypto';const b=readFileSync(process.argv[1]);console.log(JSON.stringify({size:b.length,sha256:createHash('sha256').update(b).digest('hex')}))" ./plugin.mojito
```

Worker releases omit `os` and `arch`; native releases provide both `os: "win32"` and `arch: "x64"`. `display` and `changelog` are optional. Signatures are embedded in the package.

## Hosting and installation

Use absolute HTTPS URLs to actual files for both the catalog and `downloadUrl`, such as GitHub Pages or `raw.githubusercontent.com` URLs. GitHub `blob` pages are HTML and cannot serve as JSON or package download URLs.

Local development allows loopback HTTP, such as `http://127.0.0.1:18080/catalog.json`. HTTPS redirects cannot downgrade to HTTP. Catalog ETag and Last-Modified are optional.

Add the catalog URL in Mojito's plugin repository settings, then install from the catalog. Verify the downloaded package with the CLI first; installation lets the user confirm the source, runtime mode and permissions.

## Updates

Increase the manifest's SemVer version, retain its plugin ID and signing key, rebuild and sign, then record the new file's size and SHA-256. A signer change prevents a direct update.

Changing only `downloadUrl` leaves the package unchanged and needs no new signature. Changing any package byte requires signing again. Plugin-package releases and SDK npm releases are separate workflows.
