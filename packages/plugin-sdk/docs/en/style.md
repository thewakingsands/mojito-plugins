# Style

Feature pages, home panels, settings pages and overlays are independent web documents. The host injects `--mojito-*` CSS variables, serves optional `/host/mojito-base.css` and provides Geist fonts under `/host/fonts/`.

Any web framework or canvas renderer can use these values. Variables update with the host's light/dark theme. The sans/mono variables already select Geist with system fallbacks.

## Principles

- Take colors, type sizes, radii and control heights from host variables.
- Interactive controls use `--mojito-radius-control` (8px), panels use `--mojito-radius-panel` (12px). Reserve capsules for status and roles.
- Use `--mojito-control-height` (30px); large primary actions and labels-above-fields use the large value (34px). Keep control heights consistent within a row.
- Give each region one primary action. Express status with text as well as color. Use tabular numerals and at least 12px for Chinese text.

## Variables

Read `--mojito-contract` for the style version, currently 1. Names and meanings remain stable within that version; additions are allowed, and renamed variables retain aliases until the next version. Actual colors may change with the theme or host design.

| Variable | Value / purpose |
| --- | --- |
| `--mojito-font-sans`, `--mojito-font-mono` | Geist / Geist Mono with system fallbacks |
| `--mojito-text-xs`, `-sm`, `-base`, `-lg`, `-xl` | 12 / 13 / 14 / 16 / 20px |
| `--mojito-radius-small`, `-control`, `-panel` | 4 / 8 / 12px |
| `--mojito-control-height`, `-large` | 30 / 34px |
| `--mojito-space-page`, `-section`, `-group` | 20 / 24 / 12px |
| `--mojito-ease` | Transition easing; use around 150ms |
| `--mojito-bg` | Page background |
| `--mojito-bg-subtle`, `-muted`, `-hover` | Subtle surfaces, tracks/disabled segments, hovered rows/buttons |
| `--mojito-border`, `-strong` | Separators / control borders |
| `--mojito-fg`, `-secondary`, `-tertiary` | Main / secondary / placeholder text |
| `--mojito-accent` | Links, selected text/icons |
| `--mojito-focus` | Focus ring |
| `--mojito-primary`, `-hover`, `-fg` | Primary action background, hover, foreground |
| `--mojito-ok-bg`, `-fg` | Positive status |
| `--mojito-warn`, `-bg`, `-fg` | Attention status |
| `--mojito-danger`, `-bg`, `-fg` | Failure / destructive action |
| `--mojito-tank-bg`, `-fg`; `healer`, `dps` | Role colors |
| `--mojito-chart-grid`, `-axis` | Charts |
| `--mojito-shadow-raised`, `-popover` | Raised state / plugin popovers |
| `--mojito-shadow-popover-edge` | Combine with popover shadow for its top edge |
| `--mojito-shadow-control`, `-primary`, `-card` | Control edges / primary button / panel shadow |
| `--mojito-border-heavy` | Checkbox borders and hovered fields |
| `--mojito-bg-strong`, `-selected`, `-chip` | Strong/disabled fills, selected fills, neutral chips |
| `--mojito-thumb`, `--mojito-shadow-thumb` | Switch thumb and shadow |
| `--mojito-scrim` | Modal backdrop |

Use matching `-bg` and `-fg` pairs. In dark mode, translucent status backgrounds are intended to sit over `--mojito-bg`.

## Base stylesheet

```html
<link rel="stylesheet" href="/host/mojito-base.css">
```

The leading slash resolves to the host resource from a `mojito-plugin://runtime/plugin/…` page, including development views. A Vite warning that it does not exist at build time is expected.

Base styles live in `@layer mojito`. Your unlayered CSS takes priority regardless of selector specificity or order; keep your own overrides outside that layer.

### Controls and content

- `body` gets host type, colors and page padding. Override padding when needed. Headings, text, links, code, `kbd`, focus, selections and scrollbars are styled.
- Buttons default to secondary, with a light/dark edge and a pressed offset. `data-variant="primary|ghost|danger"`, `data-size="large"` and `data-icon` select variants. Custom interactive drawings can override `box-shadow` and `transform`.
- `aria-pressed` buttons use the accent color when selected. Inputs, selects and textareas have host height, hover borders and focus rings.
- Single selects use Chromium `appearance: base-select`: rounded picker, checkmarks and hover states. Options may include icons. `optgroup` supplies muted group headings; multi-select and larger listboxes retain their native presentation.
- Search inputs have a search icon and clear action. Number inputs use tabular numerals without spinner buttons; arrow keys still adjust them. Date/time icons and selected text use host styles, while the calendar popup stays native. File inputs use a secondary button; color inputs are control-height swatches.
- Checkboxes, radios, ranges, progress and meters use host colors. `<input type="checkbox" role="switch">` is a switch. A `progress` without `value` animates an indeterminate segment and respects reduced motion.
- `<span class="mojito-spinner"></span>` follows text color. A disabled button with `aria-busy="true"` shows a spinner; primary buttons retain their accent color.
- Labels, fieldsets, legends, lists, quotes, code, preformatted text, keycaps and marks follow host styles. `details`/`summary` animate height; `.mojito-chevron` inside an `aria-expanded` button rotates with state.
- `dialog` and its backdrop fade. A confirmation layout uses `header` for title/description and `footer` for right-aligned actions, with the primary action last; these may sit inside `<form method="dialog">`.
- `dl` lays out a 96px label column and value column; each pair may be wrapped in a `div`. `.mojito-facts` is the stacked-label alternative.
- Tables use 36px rows, hover feedback and tabular numerals. Set `data-align="end"` on numeric `th` and `td`. A sortable `th` contains a button and `aria-sort="ascending|descending|none"`; the plugin performs sorting.

### Popovers and menus

Elements with `popover` open through a `popovertarget` button, align below it, flip when needed and close with Esc/outside clicks. From script, use `element.showPopover({ source: button })` to supply the positioning anchor.

A menu is `<div popover role="menu">` with `role="menuitem"` buttons. Icons are muted and 16px; trailing `small`/`kbd` shows shortcuts. Put `data-variant="danger"` last after a separator. Checkable items use `role="menuitemcheckbox"` and `aria-checked`; `h3` labels groups. The plugin handles arrow-key navigation and closing after selection.

A hint uses `popover="hint"` and a matching `interestfor` trigger, appearing on hover or keyboard focus. Use `small` for secondary text. A custom-positioned hint can use `role="tooltip"` for the same appearance.

### Classes

| Class | Purpose |
| --- | --- |
| `.mojito-panel` | Bordered 12px-radius group; a direct `header` puts its last child on the right |
| `.mojito-field` | Setting row: label/description on the left, control on the right, separators between rows |
| `.mojito-chip` | Status or role; `data-tone="ok|warn|danger|tank|healer|dps"`; `data-mark="check|cross|dash|dot|ring|triangle|none"` selects a status mark |
| `.mojito-secondary` | Secondary text |
| `.mojito-callout` | A message, with optional `data-tone="warn|danger"` |
| `.mojito-segmented` | Adjacent `aria-pressed` buttons or radio labels |
| `.mojito-tabs` | View buttons/links with `aria-selected` or `aria-current="page"` |
| `.mojito-empty` | Centered empty state; optional `h3`, paragraph and final action `div` |
| `.mojito-badge` | Small label, optional `data-tone="ok|warn|danger"`; no status mark |
| `.mojito-list` | `ul` rows with separators; `strong` title and `small` description; selection uses `aria-selected` or `aria-current` |
| `.mojito-facts` | A `dl` of `div`-wrapped `dt`/`dd` pairs, labels above values, responsive columns |
| `.mojito-chevron`, `.mojito-spinner` | Disclosure indicator / busy indicator |

Status chips already supply their mark. Role chips have no mark. Lists inside a panel drop their own border; a row wrapping a single link/button gains hover feedback.

### Example settings

```html
<form class="mojito-panel">
  <div class="mojito-field">
    <div><label for="scope">Scope</label><small>Who is included in the overlay.</small></div>
    <select id="scope"><option>Party</option><option>Alliance</option></select>
  </div>
  <div class="mojito-field">
    <div><label for="hide">Hide outside combat</label></div>
    <input id="hide" type="checkbox">
  </div>
</form>
<button data-variant="primary">Save</button>
```

Use [Lucide](https://lucide.dev) icons: `lucide-react` for React, `lucide` or SVG elsewhere. Keep the default stroke width 2 and `currentColor`. Base styles set `svg.lucide` inside buttons to 14px, or 16px in large buttons.

### Canvas and charts

Read root variables and redraw when the theme changes:

```ts
const token = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(`--mojito-${name}`).trim()
const dark = matchMedia('(prefers-color-scheme: dark)')
const draw = () => console.log(token('fg'), token('chart-grid'))
dark.addEventListener('change', draw)
draw()
```

## Page boundaries

The host draws the outer frame, border, 12px radius and title bar. The plugin draws the content below it.

| View | Content |
| --- | --- |
| Sidebar feature | `--mojito-bg`, `--mojito-space-page`, internal scrolling at fixed height; start with content or a toolbar |
| Home panel | Same boundaries; put key data in the first screen and scroll inside the panel |
| Settings | Group rows with `.mojito-panel` and `.mojito-field`; put one primary save action at the bottom |

The host handles loading, failed-load and stopped-plugin frame states. Paint the page background promptly. While host popups are open, a screenshot may temporarily replace the embedded view.

## Overlays

Overlays stay over the game and do not follow light/dark page backgrounds. Use host type, sizing, radii and status/role colors; keep backgrounds limited to actual content that needs them.

Windows start transparent. When transparent and not fully click-through, painted controls, pointer-cursor elements, backgrounds, borders, text, images and opaque canvas pixels receive input; unpainted regions pass clicks to the game. Keep text readable with white text and a shadow/backplate, at least 12px and tabular numerals.

OverlayPlugin compatibility templates are third-party pages and do not receive host variables.

## Stable surface

Within style version 1, variable names/meanings, `/host/mojito-base.css`, its `mojito` layer, documented classes/attributes/roles and `/host/fonts/` remain available. Color values, internal host classes and frame dimensions can change.

See the public [view example](https://github.com/thewakingsands/mojito-plugins/tree/main/examples/plugin-views) for a working settings page and overlay.
