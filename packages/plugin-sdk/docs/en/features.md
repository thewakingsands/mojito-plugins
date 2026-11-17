# Pages and overlays

A plugin's pages are ordinary HTML files in the plugin package, running in web pages isolated from Mojito. Once the background registers a page with `context.ui`, Mojito shows it in the sidebar, home page, settings or an overlay. Pages read data published by the background through the [bridge](api/view.md).

Registering pages requires the `ui.register` permission.

## Create a project

Pages are usually written in TypeScript, with Vite building the background and the pages together into `dist`. Project structure:

```text
my-plugin/
├─ plugin.json
├─ vite.config.ts
├─ main.html
└─ src/
   ├─ worker.ts      background
   └─ main.ts        page script
```

Install dependencies:

```sh
npm init -y
npm pkg set type=module
npm install --save-dev vite @ffcafe/mojito-plugin-sdk
```

The entry in `plugin.json` points to the built file name `entry.mjs`:

```json
{
  "schemaVersion": 1,
  "id": "MyPlugin",
  "name": "My plugin",
  "version": "0.1.0",
  "apiVersion": "^2.0.0",
  "entry": { "kind": "worker", "path": "entry.mjs" },
  "capabilities": ["ui.register"],
  "networkOrigins": []
}
```

`vite.config.ts`:

```ts
import { copyFile } from 'node:fs/promises'
import { defineConfig } from 'vite'

export default defineConfig(({ command }) => ({
  // Build output uses relative paths; the development server path matches the mount path entered when registering the development source
  base: command === 'serve' ? '/my-plugin/' : './',
  // Mojito replaces this placeholder with the page's nonce so that scripts from the development server can run
  html: { cspNonce: '__MOJITO_DEV_NONCE__' },
  server: { host: '127.0.0.1', port: 5173, strictPort: true, hmr: false, ws: false },
  build: {
    rolldownOptions: {
      // Keep the background's activate export
      preserveEntrySignatures: 'strict',
      input: { entry: 'src/worker.ts', main: 'main.html' },
      output: { entryFileNames: (chunk) => (chunk.name === 'entry' ? 'entry.mjs' : 'assets/[name]-[hash].js') },
    },
  },
  plugins: [
    {
      name: 'mojito-dev-pages',
      apply: 'serve',
      // Without HMR, remove the HMR client that Vite adds automatically
      transformIndexHtml: {
        order: 'post',
        handler: (html) => html.replace(/<script\b[^>]*\/@vite\/client"[^>]*><\/script>/g, ''),
      },
    },
    {
      name: 'mojito-manifest',
      apply: 'build',
      // Copy the manifest into the build output
      closeBundle: () => copyFile('plugin.json', 'dist/plugin.json'),
    },
  ],
}))
```

## Register a page in the background

The background below keeps a count, registers a sidebar page and handles the “add one” command sent by the page:

```ts
// src/worker.ts
import type { PluginContext } from '@ffcafe/mojito-plugin-sdk'

export async function activate(context: PluginContext) {
  let count = 0
  context.views.set('counter', { count })
  const removeCommand = await context.views.onCommand('increment', async () => {
    count++
    context.views.set('counter', { count })
    await context.views.flush() // The page has received the new value when the command returns
    return count
  })
  const removePage = await context.ui.registerFeature({ id: 'main', name: 'Counter', entry: 'main.html' })
  return async () => {
    await removeCommand()
    await removePage()
  }
}
```

## Page

```html
<!-- main.html -->
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <link rel="stylesheet" href="/host/mojito-base.css" vite-ignore>
</head>
<body>
  <h1>Counter</h1>
  <output>Connecting…</output>
  <button type="button" disabled>Add one</button>
  <script type="module" src="./src/main.ts" nonce="__MOJITO_DEV_NONCE__"></script>
</body>
</html>
```

```ts
// src/main.ts
import { connectView } from '@ffcafe/mojito-plugin-sdk/view'

const output = document.querySelector('output')!
const button = document.querySelector('button')!
const view = await connectView()
const subscription = view.subscribe('counter', (batch) => {
  for (const item of batch.items) output.value = String((item as { count: number }).count)
})
await subscription.ready
button.disabled = false
button.addEventListener('click', () => void view.command('increment', null))
```

`/host/mojito-base.css` is provided by Mojito and makes buttons, inputs and other elements match Mojito's interface; see [Style](style.md). `vite-ignore` makes Vite keep this URL as is instead of adding the mount path on the development server.

## Build and run

```sh
npx vite build
```

`dist` contains `plugin.json`, `entry.mjs`, `main.html` and `assets`. Register the absolute path of `dist\plugin.json` in 开发者工具 (developer tools) and start the plugin; Counter appears in the sidebar. To avoid building after every change, use the development server; see [Development](development.md).

## Where pages appear

The `placement` of `registerFeature` decides where the page appears:

| `placement` | Location | Count |
| --- | --- | --- |
| `sidebar` (default) | A feature page in the sidebar | Unlimited |
| `home` | A panel on the home page | One per plugin |
| `settings` | The plugin's settings page in settings | One per plugin |

```ts
await context.ui.registerFeature({ id: 'overview', name: 'Overview', entry: 'overview.html', placement: 'home' })
```

Registering a second home panel or settings page fails with `invalid_argument`; after unregistering, you can register again. When several plugins have home panels, the user chooses which one to show; by default the first one in plugin ID order is used.

Only one feature page is shown at a time. A page is destroyed when the user leaves it and reloaded on return, so keep state that must persist in the background. A page can use `view.identity.placement` to know where it is (`null` for overlays).

## Overlays

An overlay is a separate window shown above the game. The background registers it with `registerOverlay`. The parameters are similar to pages, plus a default size:

```ts
const removeOverlay = await context.ui.registerOverlay({
  id: 'counter',
  name: 'Counter overlay',
  entry: 'overlay.html',
  defaultSize: { width: 320, height: 180 },
})
```

After registration, users add it in Mojito's overlay manager and set topmost, locking and click-through there. An overlay can be added as multiple instances. Overlay pages read data with `connectView()`, the same as feature pages.

Existing overlays written for ACT/OverlayPlugin can also run as plugins: declare `ui.overlayplugin` and register with `compatibility` instead of `entry`. See [overlayplugin.ts](https://github.com/thewakingsands/mojito-plugins/blob/main/packages/plugin-sdk/src/overlayplugin.ts) for definitions.

Modern compatibility pages can request action icons with `OverlayPluginApi.callHandler(JSON.stringify({ call: 'getGameIcon', type: 'action', id: 3 }), callback)`; use `type: 'status'` for status icons.
The host forwards `{ type, id }` to the owning plugin's `${channel}/icons` view command. The worker reads game data under its existing `data.read` permission and returns a `data.image` URL or `null`. The callback receives a JSON string containing that URL, `null`, or `{ error }`.

## Preference search

Mojito's settings search and command palette (Ctrl K) can find settings on a plugin's settings page. The background submits items with `setPreferenceItems`. Each call replaces all items; an empty array clears them:

```ts
await context.ui.setPreferenceItems([
  { id: 'scope', title: 'Scope', description: 'Who is included in the overlay and recordings.' },
  { id: 'split', title: 'Segment interval', description: '' },
])
```

- `id` must be unique within one call; `title` has 1–100 characters; `description` has 0–300 characters. Invalid arguments fail with `invalid_argument`, and the previous items are kept.
- Items are valid only for the current activation, so submit them in `activate`.
- Items are shown only after the plugin's settings page is registered.

When the user selects an item, Mojito opens the plugin's settings page and sends one `navigate-to-preference-item` event. The page scrolls to the item and highlights it itself:

```ts
view.on('navigate-to-preference-item', ({ id }) => {
  document.querySelector(`[data-preference="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'center' })
})
```

If the event arrives before the page calls `view.on`, the SDK keeps it for the first listener. Ignore an `id` the page does not know.

## Theme

Mojito injects colors, fonts and sizes into every plugin page as `--mojito-*` CSS variables, which update automatically when the light/dark theme changes. With these variables and `/host/mojito-base.css`, a plugin stays consistent with Mojito; see [Style](style.md).

A complete multi-page example is in the repository at [examples/plugin-views](https://github.com/thewakingsands/mojito-plugins/tree/main/examples/plugin-views).
