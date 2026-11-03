# Development page hot updates

Build the SDK before starting this example; load it in an installed Mojito host. The development server runs on port 5173 with Vite 8.3.4. Enable its existing configuration with `MOJITO_DEV_HMR=1 pnpm exec vite --config examples/plugin-views/vite.config.ts` (PowerShell: set `$env:MOJITO_DEV_HMR = '1'` first).

Register through the host's developer registration action, with this example's absolute `plugin.json` path:

```ts
await host.registerDevelopment('author', {
  manifestPath: '/absolute/path/examples/plugin-views/plugin.json',
  serverOrigin: 'http://127.0.0.1:5173',
  mountPath: '/dev/example-views/',
  workerEntry: 'entry.ts',
  hmr: true,
})
```

The existing confirmation displays the exact WebSocket destination. Registration does not enable the plugin or grant capabilities: grant `ui.register`, then enable the development instance through the host. `hmr: true` derives `ws://127.0.0.1:5173` from the server origin and uses the mount path. An HTTPS server derives WSS. `hmrOrigin` and `hmrPath` may override these defaults; they also opt into HMR when supplied. Existing registrations without these fields keep HMR disabled. Changing a registration stops its old instance; enable it again after confirming.

This example uses these Vite 8 settings:

```ts
server: {
  host: '127.0.0.1',
  port: 5173,
  strictPort: true,
  hmr: true,
  ws: { host: '127.0.0.1', protocol: 'ws', clientPort: 5173 },
}
```

Its `base` is `/dev/example-views/`, so the final WebSocket path is `/dev/example-views/`. If you customize Vite's `server.ws.path`, register the resulting final path, including the base. Match scheme, hostname, port and path exactly. Vite's token and `vite-hmr` subprotocol are passed through unchanged. Do not disable Vite's token check or change its client source.

Accept updates in application modules with Vite's `import.meta.hot` API to retain page state; unaccepted changes may reload the whole view. CSS updates apply automatically. Reload background Worker code explicitly through the host. Closing a view, stopping the plugin, removing its registration, changing the target or reloading the background destroys old views and their sockets. Reopened views connect from the new registration.

Only admitted development view main frames can connect. Background documents, Workers, production plugins, ordinary HTTP fetches and unregistered destinations do not gain network access. The connection follows normal browser DNS and TLS behavior. Permissions, certificate checks, sandbox and web security stay enabled; an endpoint requiring additional browser permission remains unavailable. Use trusted development servers only.

## Verification

For host integration, run from a separate Mojito checkout:

```sh
node /path/to/mojito/scripts/plugin-isolation/run-vite-hmr.mjs /absolute/path/to/electron /absolute/new/output-directory /path/to/mojito-plugins/examples/plugin-views
```

The script uses the production loader with a real Vite server and checks JS/CSS updates, full reload, request restrictions and server-observed disconnect/reconnect. It is portable to Windows; use the actual Electron executable path. `MOJITO_HMR_HOST` selects a hostname or local interface to test. `MJT28_LAB_HEADLESS=1` selects Electron's headless platform for a Linux fixture. Output records versions and results without Vite tokens. Linux results do not establish Windows, LAN or WSS support; record each environment actually tested. Never bypass permission or certificate checks to make a test pass.

The example also registers `home.html` with `placement: 'home'` and
`settings.html` with `placement: 'settings'`. They show their placement and the
current `prefers-color-scheme`; the host's Appearance setting changes both pages.
Both pages take every colour, size and control style from the host: the
`--mojito-*` variables the host injects, and `/host/mojito-base.css`. See the SDK's
`docs/style.md`.
`main.html` and `details.html` keep the default sidebar placement. Each page calls
`connectView()`; it receives only its document-bound view bridge.
The worker also submits the three settings of `settings.html` with
`context.ui.setPreferenceItems`. Choosing one in the host's settings search or Ctrl K
opens the settings page, which highlights it on `navigate-to-preference-item`.
