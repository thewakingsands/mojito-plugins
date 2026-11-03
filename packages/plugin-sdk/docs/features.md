# Feature placement

`ui.registerFeature({ id, name, entry, icon?, placement? })` accepts `sidebar`
(the default), `home`, or `settings`. All three use the existing `ui.register`
permission and the same isolated page bridge; choosing a placement grants no
additional capability.

A plugin may register multiple sidebar pages, but only one live home page and one
live settings page. Pending registrations reserve these slots. Invalid placement
values and duplicate home/settings registrations reject with `invalid_argument`.
Disposing a registration frees its slot.

```ts
const remove = await context.ui.registerFeature({
  id: 'overview',
  name: 'Overview',
  entry: 'overview.html',
  placement: 'home',
})
```

A page calls `connectView()` from `@ffcafe/mojito-plugin-sdk/view`. Its immutable
`identity.placement` is `sidebar`, `home`, or `settings` for a feature, and `null`
for an overlay. A feature without an explicit placement receives `sidebar`.

The host chooses an available home page by the user's preference, or by ascending
plugin ID when the preference is unavailable or automatic. Selecting the status
page disables automatic home-page selection. Only one feature document is mounted
at a time: navigating away releases it, and returning creates a fresh document.

Use `prefers-color-scheme` for theme changes. The host's native theme preference
also applies to isolated plugin pages. The host also injects its colours, type and
sizes as `--mojito-*` CSS variables and serves an optional `/host/mojito-base.css`;
see [style.md](style.md) (in Chinese) for the variables, page boundaries and a
checklist. See `examples/plugin-views` for all three placements.

## Preference search

Plugin API 1.5.0 lets the host's settings search and command palette (Ctrl K) find
the settings on a plugin's settings page. The worker submits every item at once with
`context.ui.setPreferenceItems(items)`, which needs `ui.register`. Each call replaces
all items submitted before, without merging; an empty array clears them.

```ts
await context.ui.setPreferenceItems([
  { id: 'scope', title: '统计范围', description: '悬浮窗和记录里计入哪些人。' },
  { id: 'split', title: '分段间隔', description: '' },
])
```

`id` uses the format of a feature ID and is unique within one call. `title` has 1–100
characters and `description` 0–300; a plugin has at most 200 items
(`context.limits.values['ui.preferenceItems']` and the two `ui.preference*Chars`
limits). A duplicate or malformed ID, an unknown field or a length out of range
rejects with `invalid_argument`, too many items with `quota_exceeded`; a failed call
keeps the previous items. Items belong to the activation: stopping, disabling or
updating the plugin removes them, so submit them again in `activate`.

The host matches items like its own settings (full text, pinyin and initials) and
shows them only while the plugin's settings page is available; items submitted
before the page is registered wait for it. They have no modified state, so 只看已修改
hides them.

When the user chooses an item, the host clears the search, opens the plugin's
settings page again (even when it is already open) and sends the page one
`navigate-to-preference-item` event. The page highlights the item itself:

```ts
const view = await connectView()
view.on('navigate-to-preference-item', ({ id, keyword }) => {
  document.querySelector(`[data-preference="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'center' })
})
```

`keyword` is what the user had typed, trimmed; it may be pinyin or initials. An `id`
the page does not know, for example after the items were just replaced, should be
ignored. Only settings pages receive the event, once per choice. If it arrives before
the page calls `view.on`, the SDK keeps the latest event of each name and gives it to
the first listener. `examples/plugin-views` submits the items of its settings page
and highlights the chosen one.
