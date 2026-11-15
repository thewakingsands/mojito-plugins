# Plugin style guide

Plugin pages (sidebar features, home panels and settings pages) and plugin overlays are independent web documents; host styles and components cannot reach them. To match the host's appearance, the host provides:

- **Style variables**: `--mojito-*` CSS variables injected automatically into every plugin page and overlay. No plugin code is needed. Values update with the light/dark theme.
- **Base stylesheet** (optional): `/host/mojito-base.css` makes ordinary HTML buttons, inputs, switches and tables look like the host's controls. The plugin's own styles always take priority.
- **Fonts**: bundled Geist; `--mojito-font-sans` and `--mojito-font-mono` already select it, with Microsoft YaHei as the Chinese fallback.

The host supplies neither a component library nor a form-description renderer. Plugins may use any framework (React, Vue, native DOM or canvas), taking colors, type sizes, radii and dimensions from these variables.

## Principles

- Use `--mojito-*` variables for colors, type sizes, radii and control heights instead of hardcoded colors. Plugins then follow host redesigns and new themes automatically.
- Interactive controls use an 8px radius (`--mojito-radius-control`), containers 12px (`--mojito-radius-panel`). Reserve capsules for statuses and roles, rather than buttons.
- Controls are 30px high (`--mojito-control-height`); use 34px (`--mojito-control-height-large`) for labels-above-fields and a page's primary action. Keep heights consistent within a row.
- Give each region at most one primary action (`--mojito-primary`). Express status with text as well as color. Use tabular numerals (`font-variant-numeric: tabular-nums`) and at least 12px for Chinese text.

## Variables

The style version is 1, readable from `--mojito-contract`. Within a version, variables may be added but are neither removed nor renamed; a necessary rename retains the old name as an alias until the next version and is documented here.

| Variable | Light / dark | Purpose |
| --- | --- | --- |
| `--mojito-font-sans` | Geist, Microsoft YaHei fallback | Body text |
| `--mojito-font-mono` | Geist Mono | Code, IDs and aligned numerals |
| `--mojito-text-xs` `-sm` `-base` `-lg` `-xl` | 12 / 13 / 14 / 16 / 20px | Help / controls / body / headings / large figures |
| `--mojito-radius-small` `-control` `-panel` | 4 / 8 / 12px | Small markers / interactive controls / containers |
| `--mojito-control-height` `-large` | 30 / 34px | Control height |
| `--mojito-space-page` `-section` `-group` | 20 / 24 / 12px | Page padding / sections / groups |
| `--mojito-ease` | | Transition easing, with a duration around 150ms |
| `--mojito-bg` | White / dark gray | Page background, matching the host frame |
| `--mojito-bg-subtle` | | Subtle surfaces: headers, code blocks, unselected segments |
| `--mojito-bg-muted` | | Tracks and disabled segments |
| `--mojito-bg-hover` | Translucent | Hovered rows and buttons |
| `--mojito-border` `-strong` | | Separators / control borders |
| `--mojito-fg` `-secondary` `-tertiary` | | Main / secondary / placeholder text |
| `--mojito-accent` | Green / lime | Links and selected text/icons |
| `--mojito-focus` | | Focus ring |
| `--mojito-primary` `-hover` `-fg` | Lime | Primary action background, hover and foreground |
| `--mojito-ok-bg` `-fg` | | Positive status |
| `--mojito-warn` `-bg` `-fg` | | Attention status |
| `--mojito-danger` `-bg` `-fg` | | Failure and destructive actions |
| `--mojito-tank-bg` `-fg`, `healer`, `dps` | | Tank, healer and damage roles |
| `--mojito-chart-grid` `-axis` | | Chart grid and axes |
| `--mojito-shadow-raised` `-popover` | | Selected states / plugin popovers |
| `--mojito-shadow-popover-edge` | | Popover top edge; combine it with the popover shadow: `box-shadow: var(--mojito-shadow-popover-edge), var(--mojito-shadow-popover)` |
| `--mojito-shadow-control` `-primary` `-card` | | Button/picker edges / primary button edges / subtle panel shadow |
| `--mojito-border-heavy` | | Checkbox borders and hovered inputs |
| `--mojito-bg-strong` `-selected` `-chip` | | Hovered switches and disabled fills / selected fills / neutral chips |
| `--mojito-thumb` `--mojito-shadow-thumb` | | Switch thumb and shadow |
| `--mojito-scrim` | | Dimmed backdrop behind a dialog |

Use matching `-bg` and `-fg` pairs. In dark mode, translucent `-bg` values are designed to sit over `--mojito-bg`.

## Usage

### Variables only

```css
.toolbar {
  display: flex;
  gap: 8px;
}
.toolbar button {
  height: var(--mojito-control-height);
  padding: 0 12px;
  font: 500 var(--mojito-text-sm) var(--mojito-font-sans);
  color: var(--mojito-fg);
  background: var(--mojito-bg);
  border: 1px solid var(--mojito-border-strong);
  border-radius: var(--mojito-radius-control);
}
```

### Include the base stylesheet

```html
<link rel="stylesheet" href="/host/mojito-base.css">
```

All base rules live in the CSS layer `@layer mojito`. The plugin's unlayered styles take priority regardless of selector specificity or order, so stronger selectors are unnecessary. Keep your own styles out of the `mojito` layer.

Use a leading slash: from a plugin page at `mojito-plugin://runtime/plugin/…`, this resolves to the host's `mojito-plugin://runtime/host/mojito-base.css`. Vite may warn that it “doesn't exist at build time”; that is expected. Development-server views can use the same address.

The base stylesheet includes:

- `body`: background, text color, fonts and `--mojito-space-page` padding. Override padding when needed.
- Headings, paragraphs, links, `small`, separators, `code`/`kbd`, focus rings, selected text and scrollbars.
- `button`: secondary by default, with a subtle light/dark edge and a pressed offset; `data-variant="primary"`, `"ghost"`, `"danger"`; `data-size="large"` uses 34px; `data-icon` makes a square icon button. Disabled primary buttons turn gray. All buttons have this treatment; custom plugin buttons (list rows, timeline markers) can set `box-shadow: none` and `transform: none` to remove it.
- Pressable buttons use `aria-pressed`, for example a “Show player names” toggle or job selection. `aria-pressed="true"` is lime; `"false"` text is lighter than ordinary button text.
- `input`, `select`, `textarea`: 30px high, a stronger border on hover and an accent border with a light focus ring.
- `select`: host up/down arrows and a host-style picker with rounded corners, checkmarks and hovered options. This uses Chromium customizable select (`appearance: base-select`); options can contain icons. `optgroup` has a muted group heading. `multiple` and listboxes with `size` greater than 1 retain their native presentation.
- Other inputs: `type="search"` has a search icon and host clear button; `type="number"` uses tabular numerals without native spinner buttons, while arrow keys still adjust values. Date/time inputs use host calendar/clock icons and selection color, but the calendar popup stays native. `type="file"` uses a secondary button; `type="color"` is a control-height swatch.
- Checkboxes and radios use lime when selected. `<input type="checkbox" role="switch">` is a switch for immediately applied settings. Ranges, `progress` and `meter` use host colors. A `progress` without `value` animates an indeterminate segment; reduced motion replaces it with a muted full track.
- Busy state: `<span class="mojito-spinner"></span>` is the host spinner and follows text color. Use `aria-busy="true"` and `disabled` on a busy button to show a spinner before its label; primary buttons retain their lime color.
- `label`, `fieldset`, `legend`; `details`/`summary` act like the host's advanced section, with a rotating disclosure arrow. `<span class="mojito-chevron">` inside an `aria-expanded` button rotates with that state too.
- `code`, `pre`, `kbd` keycaps, `mark`, `blockquote` and lists.
- `details` animates height when opening and closing, like the host's disclosure sections.
- `dialog` and its backdrop fade in/out. A host-style confirmation uses a `header` with a title and short description and a `footer` with right-aligned actions, primary last; both can sit inside `<form method="dialog">`.
- `dl`: a 96px muted label column and a value column; each `dt`/`dd` pair may be wrapped in a `div`. `.mojito-facts` provides the alternative below.
- `table`: headers, 36px rows, hover states and tabular numerals. Put `data-align="end"` on both `th` and `td` in numeric columns.
- Sortable headers: `<th aria-sort="descending"><button>Damage</button></th>`. Use `ascending` or `descending` on the sorted column for its direction arrow; use `none` elsewhere for a hover-only sort marker. End-aligned columns put the arrow before the label to keep labels and numbers aligned. The plugin implements sorting.
- Popovers: an element with `popover` opens from a button with `popovertarget`. It aligns below/left, flips upward if needed and aligns right when necessary; Esc or an outside click closes it. From script use `element.showPopover({ source: button })` to supply the positioning anchor. These are browser features (`popover` and CSS anchor positioning), without additional scripts or libraries.
- Menus: `<div popover role="menu">` contains `role="menuitem"` buttons, matching the host's more-actions menu. Icons are muted and 16px; trailing `small`/`kbd` shows shortcuts. Put `data-variant="danger"` actions last after `<hr>`. `role="menuitemcheckbox"` with `aria-checked` shows a checkmark when selected; `h3` labels groups. The plugin handles arrow-key navigation and closing after selection.
- Hints: `<span popover="hint">` with a matching `interestfor` trigger appears on pointer hover or keyboard focus, dark with light text, centered below the trigger. `small` is secondary text. Custom-positioned hints, such as chart readouts following the pointer, use `role="tooltip"` for the same appearance and position themselves.
- Classes:
  - `.mojito-panel`: bordered container with a 12px radius.
  - `.mojito-field`: setting row, label/description left and control right; adjacent rows get separators.
  - `.mojito-chip`: status and role labels, `data-tone="ok|warn|danger|tank|healer|dps"`. Statuses have marks (○ neutral, ● positive, △ attention, × failure); `data-mark="check|cross|dash|dot|ring|triangle|none"` changes the mark, for example a check for a kill. Do not add ✓ or ✕ to the text. Role labels have no mark.
  - `.mojito-secondary`: secondary text.
  - `.mojito-callout`: a message with optional `data-tone="warn|danger"`.
  - `.mojito-segmented`: adjacent `aria-pressed` buttons or labels wrapping radios; the selected item is lime.
  - `.mojito-tabs`: views of one page, with `aria-selected="true"` or `aria-current="page"` buttons/links.
  - `.mojito-panel > header`: panel heading row, with its last child aligned right for actions.
  - `.mojito-empty`: centered, muted empty state; optional `h3`, paragraph and final `div` containing buttons.
  - `.mojito-badge`: smaller label, such as “Recommended” or “2 updates”, without a mark; `data-tone="ok|warn|danger"`. Use `.mojito-chip` for status.
  - `.mojito-list`: `<ul class="mojito-list">` with one row per `li`, separators, border and radius; drops its own border inside `.mojito-panel`. `strong` is the title and `small` the description. `aria-selected="true"` or `aria-current` marks selected rows. Rows wrapping a single link or button highlight on hover.
  - `.mojito-facts`: a `dl` with each `<div><dt>…</dt><dd>…</dd></div>` pair laid out label-above-value in responsive columns.

A settings page:

```html
<form class="mojito-panel">
  <div class="mojito-field">
    <div><label for="scope">Scope</label><small>Who is included in overlays and recordings.</small></div>
    <select id="scope"><option>Party</option><option>Alliance</option></select>
  </div>
  <div class="mojito-field">
    <div><label for="hide">Hide overlays outside combat</label><small>Fade out 10 seconds after combat.</small></div>
    <input id="hide" type="checkbox">
  </div>
</form>
<button data-variant="primary">Save</button>
```

A toolbar:

```html
<button aria-pressed="true">Show player names</button>
<button popovertarget="jobs">Jobs</button>
<div id="jobs" popover>
  <button aria-pressed="true">Paladin</button>
  <button aria-pressed="false">Warrior</button>
</div>
<button data-icon data-variant="ghost" interestfor="tip" aria-label="About"><svg class="lucide">…</svg></button>
<span id="tip" popover="hint">Damage attributed by received buffs</span>
```

### Icons

Use [Lucide](https://lucide.dev), like the host: `lucide-react` for React, or `lucide`/copied SVG elsewhere. Keep the default stroke width 2 and `currentColor`. Base styles make button `svg.lucide` icons 14px, or 16px in large buttons. Do not substitute characters such as ←, ▶, ✕ or emoji for icons.

### Read colors in JavaScript

For canvas and chart libraries, read variables from the root element and redraw on theme changes:

```ts
const token = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(`--mojito-${name}`).trim()
const dark = matchMedia('(prefers-color-scheme: dark)')
const draw = () => chart.setOptions({ color: token('fg'), gridColor: token('chart-grid') })
dark.addEventListener('change', draw)
draw()
```

Currently the host has light and dark themes only; `prefers-color-scheme` changes therefore reflect theme changes.

## Page boundaries

Plugin pages sit inside the host's frame. The host draws its border, 12px radius and title bar (plugin name and “Feature page”, “Home panel” or “Plugin settings”); the plugin draws the region below it.

| Page | Plugin content |
| --- | --- |
| Sidebar feature | `--mojito-bg` background and `--mojito-space-page` padding. The page has fixed height; scroll inside it when needed. Keep the outer frame, radius and shadow to the host. Its title bar already has the plugin name, so start with a toolbar or content instead of repeating that name as a large heading. |
| Home panel | Same boundaries. Put the most important figures in the first screen; height is limited, so scroll inside the panel when needed. |
| Settings page | Same boundaries. Group settings in `.mojito-panel`, one `.mojito-field` row per item; put the save action at the bottom with one primary button for the page. |

The host shows loading, load-failure and stopped-plugin states inside the frame. Paint the page background promptly to avoid a long blank region. Host popups temporarily replace the embedded page with a screenshot; this is expected.

## Overlays

- Overlays sit above the game and do not follow light/dark page backgrounds. Do not fill the window with `--mojito-bg`; host type, sizing, radii and role/status colors can be used.
- Windows start transparent. When transparent and not fully click-through, painted controls, `cursor: pointer` elements, backgrounds/images, borders, text, images and opaque canvas pixels receive input; other regions pass clicks through to the game. Add backgrounds only where interaction or a backplate is needed.
- Keep text readable over the game: white text with a shadow or translucent backplate, at least 12px, with tabular numerals.

OverlayPlugin compatibility templates are third-party pages and do not receive injected host variables.

## Guarantees and limits

Guaranteed within version 1 (neither removed nor renamed):

- Names and meanings of `--mojito-*` variables and `--mojito-contract`.
- `/host/mojito-base.css`, its `mojito` layer and plugin override priority; documented classes (`.mojito-panel`, `.mojito-field`, `.mojito-chip`, `.mojito-secondary`, `.mojito-callout`, `.mojito-segmented`, `.mojito-tabs`, `.mojito-empty`, `.mojito-facts`, `.mojito-chevron`, `.mojito-badge`, `.mojito-list`, `.mojito-spinner`); `data-variant`, `data-size`, `data-tone`, `data-icon`, `data-align`; styles for `role="switch"`, `role="tooltip"`, `role="menu"`, menu-item roles, `aria-pressed`, `aria-sort`, `aria-busy` and `popover`; and `header`/`footer` inside `dialog`.
- Font URLs under `/host/fonts/`.

Not guaranteed:

- Exact color values, which change with themes and host redesigns.
- Internal host variables and classes, which are inaccessible from plugin pages.
- Exact host-frame dimensions, such as title-bar height.

## Checklist

- [ ] Colors come from `--mojito-*`, without hardcoded color values.
- [ ] Both light and dark themes have been checked.
- [ ] The page has no duplicate outer frame, radius, shadow or large plugin-name heading.
- [ ] Interactive controls use 8px radii, containers 12px; capsules indicate status only.
- [ ] Controls in a row share a height; each region has at most one primary action.
- [ ] Status includes text; Chinese text is at least 12px; numerals are tabular.
- [ ] Overflow scrolls inside the page without a second host scrollbar.
- [ ] Overlays keep backgrounds limited to content, and transparent regions pass clicks through to the game.

## Example

See [plugin-views](https://github.com/thewakingsands/mojito-plugins/tree/main/examples/plugin-views) for settings, home-panel and transparent-overlay examples.
