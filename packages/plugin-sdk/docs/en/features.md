# Feature placement

`ui.registerFeature({ id, name, entry, icon?, placement? })` accepts `sidebar` (the default),
`home` or `settings` as its `placement`. All three use the existing `ui.register` permission and the same isolated view bridge;
choosing a placement grants no additional capability.

A plugin may register multiple sidebar pages, but only one live home panel and one live settings page. Pending registrations reserve these slots.
Invalid placement values and duplicate home/settings registrations reject with `invalid_argument`. Disposing a registration frees its slot.

```ts
const remove = await context.ui.registerFeature({
  id: 'overview',
  name: 'Overview',
  entry: 'overview.html',
  placement: 'home',
})
```

A page calls `connectView()` from `@ffcafe/mojito-plugin-sdk/view`. A feature's `identity.placement` is immutable:
`sidebar`, `home` or `settings`; an overlay's is `null`. Features without an explicit placement receive `sidebar`.

The host selects an available home panel by the user's preference, or by ascending plugin ID when no preference is available or selection is automatic. Selecting the status page disables automatic home-panel selection.
Only one feature document is mounted at a time: navigating away releases it, and returning creates a fresh document. Keep state that must survive navigation in the background.

Use `prefers-color-scheme` for theme changes. The host's native theme preference also applies to isolated plugin pages. The host injects its colors,
type and sizes as `--mojito-*` CSS variables and serves optional `/host/mojito-base.css`; variables, page boundaries and the checklist are in
[style.md](style.md). See `examples/plugin-views` for all placements.

## Preference search

Since Plugin API 1.5.0, the host's settings search and command palette (Ctrl K) can find settings on a plugin's settings page. The Worker submits
all items at once with `context.ui.setPreferenceItems(items)`, which needs `ui.register`. Each call replaces all previously submitted items,
without merging; an empty array clears them.

```ts
await context.ui.setPreferenceItems([
  { id: 'scope', title: 'Scope', description: 'Who is included in the overlay and recordings.' },
  { id: 'split', title: 'Segment interval', description: '' },
])
```

`id` uses the feature-ID format and must be unique within one call. `title` is nonempty and has 1–100 characters; `description` has 0–300 characters.
Duplicate or malformed IDs, an empty `title` or unknown fields reject with `invalid_argument`; a failed call preserves the previous items. Items belong to the activation:
stopping, disabling or updating the plugin removes them, so submit them again in `activate`.

The host matches items like its own settings (full text, pinyin and initials), and shows them only while the plugin's settings page is available. Items submitted
before the page is registered wait for it. Items have no modified state, so the host's “modified only” filter hides them.

When the user selects an item, the host clears search, opens the plugin's settings page again (even when it is already open), and sends one
`navigate-to-preference-item` event. The page highlights the item itself:

```ts
const view = await connectView()
view.on('navigate-to-preference-item', ({ id, keyword }) => {
  document.querySelector(`[data-preference="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'center' })
})
```

`keyword` is the user's input, trimmed, and may be pinyin or initials. Ignore an `id` the page does not know, for example after replacing the items.
Only settings pages receive the event, once per selection. If it arrives before the page calls `view.on`, the SDK retains the latest event of each name
for its first listener. `examples/plugin-views` submits its settings page's items and highlights the selected item.

## Overlays

`ui.registerOverlay` accepts an ID, name, entry and `defaultSize: { width, height }`, and returns a disposer. The user adds instances in the overlay manager and controls topmost, locking and click-through there; publish state through the [view bridge](api/view.md).

OverlayPlugin-compatible pages declare `ui.register` and `ui.overlayplugin`, register `compatibility` instead of `entry`, and publish `OverlayState` through `overlayProducer`. Packaged sources list their entry and allowed documents; remote sources reference a host-managed profile and also need `ui.overlayplugin.remote`. See [overlayplugin.ts](https://github.com/thewakingsands/mojito-plugins/blob/main/packages/plugin-sdk/src/overlayplugin.ts) for definitions.
