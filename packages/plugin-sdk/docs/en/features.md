# Pages and overlays

`ui.registerFeature({ id, name, entry, icon?, placement? })` accepts `sidebar` (default), `home` or `settings`. Each needs `ui.register` and uses the same isolated view bridge.

A plugin can register multiple sidebar features, but only one live home panel and one settings page. Pending registrations reserve these slots. Invalid placement or duplicate home/settings registration rejects with `invalid_argument`; disposing a registration frees its slot.

```ts
import type { PluginContext } from '@ffcafe/mojito-plugin-sdk'

export async function activate(context: PluginContext) {
  return context.ui.registerFeature({
    id: 'overview',
    name: 'Overview',
    entry: 'overview.html',
    placement: 'home',
  })
}
```

The page calls `connectView()` from `@ffcafe/mojito-plugin-sdk/view`. Its immutable `identity.placement` is `sidebar`, `home` or `settings` for features and `null` for overlays.

The host selects an available home panel according to the user's preference, or ascending plugin ID when automatic. Selecting the status page disables automatic home-panel selection. Navigating away releases a feature document; returning creates a fresh one. Keep persistent view state in the background.

Use `prefers-color-scheme` for theme changes. The host injects `--mojito-*` variables and provides optional `/host/mojito-base.css`; see [Style](style.md). The [view example](https://github.com/thewakingsands/mojito-plugins/tree/main/examples/plugin-views) demonstrates all placements.

## Overlays

`ui.registerOverlay` takes an ID, name, entry and `defaultSize: { width, height }`, returning a disposer. The user adds an instance through Mojito's overlay manager and controls topmost, locking and click-through there. Publish state through the [view bridge](api/view.md).

For OverlayPlugin compatibility, declare `ui.register` and `ui.overlayplugin`, then register `compatibility` instead of `entry`. Use `overlayProducer` to publish `OverlayState`. A packaged source lists its entry and allowed documents; a remote source references a host-managed profile and also needs `ui.overlayplugin.remote`. See [overlayplugin types](https://github.com/thewakingsands/mojito-plugins/blob/main/packages/plugin-sdk/src/overlayplugin.ts).

## Preference search

`context.ui.setPreferenceItems(items)` lets host settings search and Ctrl K find settings on your page. It needs `ui.register` and replaces all previous items; an empty array clears them.

Each item has a unique feature-style `id`, a 1–100 character nonempty `title`, and a 0–300 character `description`. Duplicate/malformed IDs, an empty title or unknown fields reject with `invalid_argument`, retaining the previous items. Items belong to the activation; submit them again when the plugin starts.

The host matches full text, pinyin and initials. Items appear while the settings page is available, including items submitted before registration. They have no modified state, so the host's “modified only” filter hides them.

Selecting an item clears host search, opens a fresh settings document and sends one `navigate-to-preference-item` event. The page scrolls/highlights the item; unknown IDs can be ignored. The SDK retains the latest event per name until its first listener is registered.

```ts
import { connectView } from '@ffcafe/mojito-plugin-sdk/view'

const view = await connectView()
view.on('navigate-to-preference-item', ({ id }) => {
  document.querySelector(`[data-preference="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'center' })
})
```

The [settings example](https://github.com/thewakingsands/mojito-plugins/blob/main/examples/plugin-views/settings-page.ts) demonstrates highlighting the selected preference.
