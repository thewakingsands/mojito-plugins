# Development

Register a development source as described in [Getting started](getting-started.md) and run it in an installed Mojito host. Background and view code reload separately: stop/start reloads the background; Vite HMR updates views.

## View example

Build from the repository root:

```sh
pnpm --filter @ffcafe/mojito-plugin-sdk build
pnpm exec vite build --config examples/plugin-views/vite.config.ts
```

Register `examples/plugin-views/dist/plugin.json` to run the built local files. The configuration bundles background and view entries into one distribution directory and copies the manifest:

[vite.config.ts](https://github.com/thewakingsands/mojito-plugins/blob/main/examples/plugin-views/vite.config.ts)

## Vite HMR

Start the development server; in PowerShell set the environment variable before running Vite:

```powershell
$env:MOJITO_DEV_HMR = '1'
pnpm exec vite --config examples/plugin-views/vite.config.ts
```

In the source registration form, enter the absolute source `examples/plugin-views/plugin.json` path, server `http://127.0.0.1:5173`, mount path `/dev/example-views/`, background entry `entry.ts`, and enable HMR.

Confirmation shows the derived destination `ws://127.0.0.1:5173/dev/example-views/`. HTTPS derives WSS. When overriding origin or path, match the scheme, hostname, port and final path including Vite's base exactly.

Accept `import.meta.hot` updates to retain page state. CSS updates automatically; other changes may reload the document. HMR does not replace the background Worker; reload it by stopping and starting. Changing the registered source stops the old instance.

## Troubleshooting

- Startup failure: check the manifest, `apiVersion`, built entry path and developer logs.
- View state: select 预览 (preview) in the development plugin's view list, then 打开 DevTools (open DevTools).
- Network failure: check `networkOrigins`, the HTTP capability and the confirmed development destination.
- HMR failure: check the final WebSocket path; retain Vite token checks, certificate validation and host isolation.

`@ffcafe/mojito-plugin-sdk/testing` provides an explicit test context. Existing examples participate in repository `pnpm typecheck`; SDK tests run with `pnpm --filter @ffcafe/mojito-plugin-sdk test`. Tests provide their own data and service responses; see [SDK entry points](api/exports.md).
