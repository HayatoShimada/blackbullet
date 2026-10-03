# BlackBullet design system: the form layer

Status: design, 2026-10-02. Companion to `dev-docs/product-design.md` (the meaning
layer). That document says what every surface must mean; this one says what it looks
like, how it moves and how it feels under a finger. Where the two disagree, the
product document wins. Every value here was measured against the demo space at
1280×800 and iPhone 13 (390 wide), light and dark; the contrast ratios are computed
WCAG ratios on the exact pairs listed, not estimates.

Streams and their files are fixed (theme, navigator, dbview, graph, lua). Section 9
lists what each stream consumes from the theme stream so they can build in parallel:
the theme stream publishes tokens, everyone else reads `var(--…)`.

---

## 1. Direction

**A quiet page that happens to be a database.** The page is the product; chrome is a
thin frame around it that shows its hands only when asked. Three decisions follow:

1. **Content-first density.** The editor column is the brightest, widest, calmest thing
   on screen. The top bar is the page's own colour with a hairline under it; the dock
   is one step darker, never a different material. Nothing in the chrome is bolder
   than an H2 in the page.
2. **Proportional text, mono where text is code.** Notes read like notes. The chrome
   stops being 28 px monospace that cannot fit "Open Page or document" into 260 px.
   Code, raw source and the `editorFont = "mono"` setting keep iA Writer Mono S.
3. **One grammar of controls.** Every control is one of seven shapes (text button,
   primary button, danger button, icon button, segment, chip, input) at one of two
   sizes (desktop 32 px, touch 44 px) with one focus ring, one hover tint, one radius
   scale, one shadow scale. A `⋯` opens a popover everywhere. A pencil means edit
   everywhere. Red means "cannot be undone from here" and nowhere else.

What "state of the art" means for this app: the calm of a well-set document, the
speed of a palette that already knows what you want, the trust of a UI that never
drops your text or hides a button under another button. It does not mean gradients,
glass, or motion for its own sake. Hover reveals, never hover-only; 44 px under a
thumb; keyboard first; light and dark as two readings of one palette, not two
palettes.

---

## 2. Tokens

All tokens live in `client/styles/_tokens.scss` (palette and scale, bundled into both
`main.css` and `components.css` so sandboxed views see them) and `theme.scss` (the
semantic roles that already exist, remapped to the palette). Existing upstream names
(`--ui-*`, `--editor-*`, `--modal-*`, `--button-*`) are kept and re-pointed; new
names are prefixed `--sb-`. No raw hex outside `_tokens.scss` and the dark mixin in
`theme.scss`; everything else uses `var()` or `color-mix()`.

### 2.1 Type

```
--sb-font-sans: ui-sans-serif, -apple-system, "Segoe UI", Roboto, "Helvetica Neue",
                "Hiragino Sans", "Noto Sans JP", "Yu Gothic UI", Meiryo, Arial, sans-serif;
--sb-font-mono: "iA-Mono", ui-monospace, Menlo, Consolas, "Noto Sans Mono CJK JP", monospace;
--ui-font:      var(--sb-font-sans);     /* chrome: top bar, dock, modals, views, graph */
--editor-font:  var(--sb-font-sans);     /* prose in .cm-content */
--editor-monospace-font: var(--sb-font-mono);  /* code, frontmatter, raw source, kbd */
```

- System stacks only; the only font files are the four iA Writer Mono S `.woff2`
  already in `client/fonts/`. No request leaves the machine (`_fonts.scss` unchanged
  except `font-display: swap`).
- Japanese glyphs come from the OS (Hiragino / Yu Gothic / Noto Sans JP). The guide
  renders in the same stack, so prose and chrome share one voice per script.
- `html[data-editor-font="mono"]` (set by the client from `editorFont` config; the
  attribute hook is an owner item, the CSS is theme's) flips `--editor-font` back to
  `--sb-font-mono`. The chrome stays sans either way.

**Scale** (px; line-height as ratio). Chrome is 14 px, the editor 17 px: one step
apart, same rhythm.

| Token | Size / line | Use |
| --- | --- | --- |
| `--sb-text-xs` | 11 / 1.35 | chips, kbd hints, counts, calendar day numbers |
| `--sb-text-sm` | 12.5 / 1.4 | descriptions under rows, column headers, table cells in views |
| `--sb-text-md` | 14 / 1.45 | **chrome default**: dock rows, palette rows, buttons, inputs, view bodies |
| `--sb-text-lg` | 16 / 1.45 | modal inputs, phone inputs (iOS does not zoom at ≥ 16) |
| `--sb-text-editor` | 17 / 1.6 | `.cm-content` prose (`#sb-main .cm-editor { font-size }`) |
| `--sb-text-title` | 20 / 1.3 | top-bar page title (desktop); 18 on the phone |
| `--sb-h1` … `--sb-h4` | 1.6em / 1.3em / 1.15em / 1em, line 1.25, weight 650 | editor headings (`.sb-line-h1…`) |

Weights: 400 body, 500 chrome labels and tree folders, 600 headings and titles. The
current `font-weight: 900` on `.sb-strong` becomes 700. Letter-spacing is 0
everywhere except `--sb-text-xs` uppercase labels (none exist today; do not add).
Numbers in cells and dates: `font-variant-numeric: tabular-nums`.

### 2.2 Spacing, radius, elevation

4-pt scale: `--sb-space-1: 4px` `-2: 8` `-3: 12` `-4: 16` `-5: 24` `-6: 32`.
Control heights: `--sb-control: 32px` (desktop) and `--sb-control-touch: 44px`
(`@media (pointer: coarse)`); row height `--sb-row: 36px` desktop, 44 px touch.
Gaps between adjacent targets ≥ `--sb-space-2` on touch.

Radius: `--sb-radius-1: 4px` (inputs, buttons, chips in text), `--sb-radius-2: 8px`
(cards, popovers, segments wrap, widgets), `--sb-radius-3: 12px` (modals, bottom
sheets, toasts), `--sb-radius-pill: 999px` (status chips, tag chips).

Elevation (one shadow colour token so dark mode can deepen it):
```
--sb-shadow-color: 0 0 0;          /* dark: 0 0 0 still, but higher alpha */
--sb-shadow-1: 0 1px 2px rgb(var(--sb-shadow-color) / .06);               /* raised control, card */
--sb-shadow-2: 0 4px 16px rgb(var(--sb-shadow-color) / .10), 0 1px 2px rgb(var(--sb-shadow-color) / .06); /* popover, dock menu, tooltip */
--sb-shadow-3: 0 16px 48px rgb(var(--sb-shadow-color) / .18), 0 2px 6px rgb(var(--sb-shadow-color) / .08); /* modal, palette, bottom sheet */
```
Dark multiplies alphas by 2 (`.12 / .24 / .40`). Borders are hairlines; shadows carry
elevation, borders carry edges. Nothing has both a strong border and a strong shadow.

### 2.3 Colour roles

Light on the left, dark on the right. Ratios are against the surface the role sits on.

| Role | Light | Dark | Contrast (light / dark) |
| --- | --- | --- | --- |
| `--sb-bg` (page, `--root-background-color`) | `#ffffff` | `#131518` | — |
| `--sb-bg-panel` (dock, modal, `--panel-background-color`, `--modal-background-color`) | `#f6f7f8` | `#191b1f` | — |
| `--sb-bg-2` (cards, column heads, hover, `--ui-surface-section-background-color`) | `#eef1f4` | `#202329` | — |
| `--sb-ink` (`--root-color`) | `#1c2128` | `#e6e9ee` | 16.2 / 15.0 |
| `--sb-ink-2` (`--subtle-color`, descriptions, icons at rest, placeholders) | `#5b6572` | `#a3abb6` | 5.9 / 7.9 (on panel 5.5 / 7.4) |
| `--sb-ink-3` (bullets, fold status, dim labels; **never body text**) | `#667180` | `#8b939e` | 4.65 / 5.9 |
| `--sb-line` (hairline separators, `--ui-surface-border-color`) | `#e4e7eb` | `#2b3037` | non-text |
| `--sb-line-strong` (input and control borders) | `#8e97a1` | `#5c6670` | 3.0 / 3.1 (UI ≥ 3) |
| `--sb-accent` (`--ui-accent-color`) | `#2f5fb3` | `#79a9f2` | 6.2 / 7.6 as text on bg |
| `--sb-on-accent` (`--ui-accent-contrast-color`, text on filled accent) | `#ffffff` | `#0c1a30` | 6.2 / 7.3 |
| `--sb-accent-soft` (selected row, active segment) | `color-mix(in srgb, var(--sb-accent) 12%, var(--sb-bg-panel))` | same | ink on it 13.8 / 12.9 |
| `--sb-link` (`--link-color`) | `#2456b0` | `#8fb3ff` | 6.9 / 8.8 |
| `--sb-danger` | `#b42318` | `#ff8a80` | 6.6 / 8.0; white on it 6.6, `#1a0a08` on it 8.4 |
| `--sb-warn` (today, soon) | `#8a5a00` | `#f3b74d` | 5.9 / 10.2 |
| `--sb-ok` (success, done, active status) | `#1e7a4b` | `#5fd39a` | 5.3 / 9.8 |
| `--sb-info` | `var(--sb-accent)` | same | — |
| `--sb-overlay-8` (theme-aware tint, replaces `rgba(22,22,22,.07)` and `#0002`) | `color-mix(in srgb, currentColor 8%, transparent)` | same | — |
| `--sb-overlay-16` | `color-mix(in srgb, currentColor 16%, transparent)` | same | — |
| `--sb-focus` | `var(--sb-accent)` | same | ring, 2 px, offset 2 px |
| `--sb-skeleton` | `#e9ecf0` | `#23272d` | shimmer base |
| `--sb-toast-info-bg / -fg` | `#f6f7f8` / `#1c2128` | `#23272d` / `#e6e9ee` | 15.1 / 12.3 |
| `--sb-toast-success-bg / -fg` | `#e6f4ec` / `#0f5132` | `#17301f` / `#9fe2bd` | 8.3 / 9.5 |
| `--sb-toast-error-bg / -fg` | `#fdecec` / `#7f1d1d` | `#3a1b19` / `#ffb3ad` | 8.8 / 9.1 |

Editor roles (remapped in `theme.scss`; the audit's failures are the first six):

| Token | Light | Dark | Ratio |
| --- | --- | --- | --- |
| `--editor-list-bullet-color` | `#667180` | `#8b939e` | 4.65 / 5.9 (was 2.96) |
| `--editor-frontmatter-marker-color` | `#8a3a42` (opaque) | `#e8858c` | 7.4 / 6.6 on frontmatter bg (was 2.40) |
| `.cm-frontmatterFoldStatus` (uses `--sb-ink-2`, opacity 1) | `#5b6572` | `#a3abb6` | 5.7 / 7.3 (was 3.26 / 3.78) |
| `--meta-color` (frontmatter keys, `[due:]`) | `#7a2630` | `#ef9aa0` | 9.5 / 7.9 (dark was 3.33) |
| `--editor-hashtag-background-color / -color` | `#e3ecfb` / `#1d4a94` | `#223b66` / `#cfe0ff` | 7.2 / 8.4 (was 4.24) |
| `--editor-task-completed-color` (new; `[completed:]` and ticked text) | `var(--sb-ink-3)` | same | neutral grey, no red, strike-through only on the task text |
| `--editor-heading-meta-color` (`#` marker, large) | `#7b8591` | `#7f8894` | 3.75 / 5.1 (large ≥ 3) |
| `--editor-frontmatter-background-color` | `#fbf8ea` | `#1d1d1a` | unchanged feel, lower chroma |
| `--editor-code-background-color` | `var(--sb-bg-2)` | same | |
| `--editor-selection-background-color` | `color-mix(in srgb, var(--sb-accent) 18%, transparent)` | 28% | |
| `--editor-widget-background-color` (widget frame) | `var(--sb-line)` | same | the frame is a hairline, not a grey slab |
| `--top-background-color` | `var(--sb-bg)` | same | top bar = page colour + `--sb-line` underline |
| `--editor-wiki-link-page-background-color` | `color-mix(in srgb, var(--sb-link) 8%, transparent)` | same | |

Status chips in views (dbview consumes, theme publishes):
```
--db-overdue: var(--sb-danger)   --db-today: var(--sb-warn)   --db-soon: var(--sb-warn)
--db-ok: var(--sb-ok)            --db-danger: var(--sb-danger) --db-on-accent: var(--sb-on-accent)
--db-drop: var(--sb-accent)
```
Dark overdue `#ff8a80` on `#131518` is 8.0 (was 3.47); on a card `#202329` 6.9.

Graph palette (graph stream owns `object-graph.scss`; it reads the `--sb-*` roles and
defines only hues):

| Token | Light | Dark | Note |
| --- | --- | --- | --- |
| `--gv-link` | `#87919c` | `#707a86` | 3.2 / 4.2 (edges ≥ 3) |
| `--gv-link-dim` | `color-mix(in srgb, var(--gv-link) 50%, transparent)` | same | dimmed edges stay visible |
| `--gv-link-similar` | `#0f8a78` | `#3fc8b3` | 4.3 / 8.8; dashed |
| `--gv-link-mention` | `#8a62d6` | `#ad97f0` | 4.4 / 7.4; dotted |
| `--gv-label` | `var(--sb-ink)` | same | 11 → 12 px |
| `--gv-label-dim` | `#5f6973` | `#a0a8b2` | 5.6 / 7.6 (was 4.48) |
| `--gv-node-stroke` | `var(--sb-bg)` | same | 1 px on every node, 2 px on current |
| `--gv-tag-project` | `#3b6fd6` | `#6f9cf0` | hue 1 |
| `--gv-tag-area` | `#1f8f57` | `#4fc380` | hue 2 (green; project is blue, no longer both green) |
| `--gv-tag-goal` | `#b8771a` | `#e0a44a` | |
| `--gv-tag-journal` | `#7c5cd6` | `#ad97f0` | |
| `--gv-tag-resource` | `#b8469a` | `#e07ac4` | |
| `--gv-untagged` | `#8a929c` | `#9aa2ac` | 3.15 / 7.1 as a fill; resolved via `getComputedStyle`, never `var()` into canvas |

### 2.4 Motion

```
--sb-dur-1: 80ms   /* hover tints, focus ring, chip state */
--sb-dur-2: 160ms  /* popover open, segment slide, row-actions fade, fold rotate */
--sb-dur-3: 240ms  /* modal and bottom sheet enter, toast enter, drawer */
--sb-ease-out: cubic-bezier(.2,.8,.2,1);  --sb-ease-in: cubic-bezier(.4,0,1,1)
```
Enter = opacity 0→1 plus translateY(4px→0) with `--sb-ease-out`; exit is half the
duration with `--sb-ease-in` and no translate. Nothing bounces, nothing scales.

Reduced motion (global, in `theme.scss`):
```
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { transition-duration: .01ms !important; animation-duration: .01ms !important;
                            animation-iteration-count: 1 !important; scroll-behavior: auto !important; }
}
```
Spinners become a static ring; the graph simulation renders its settled layout.

### 2.5 Density

One density. Desktop rows 36 px, touch rows 44 px, view table rows 34 px (cells
`padding: 6px 8px`), board cards `padding: 8px 10px`. The editor column stays
`--editor-width: 800px`, content `padding: 5px 24px`. Panels have `padding: 8px 10px`
headers and flush lists. No compact/comfortable setting; the scale is the setting.

---

## 3. Components

Each spec names the files (stream), selectors and tokens. "Touch" means
`@media (pointer: coarse)`; "hover" means `@media (hover: hover)`.

### 3.1 Top bar (`client/styles/top.scss`, theme)

- `#sb-top`: height `--sb-top-height: 52px` (phone 56 px), background `--sb-bg`,
  `border-bottom: 1px solid var(--sb-line)`. No grey slab; the dock below shares the
  hairline so the two edges meet in a T.
- Title `#sb-current-page .sb-input`: `--sb-text-title` (20 px, weight 600, sans),
  `aria-label="Page name"` (owner item; CSS assumes it). Phone: 18 px, `direction:
  rtl; text-align: left; unicode-bidi: plaintext` so the ellipsis eats the folder
  prefix and "Spring Launch" survives, until the component ships the breadcrumb.
- Breadcrumb (when the component lands, owner item 3): a `.sb-page-crumb` span
  before the title, `--sb-text-sm`, `--sb-ink-2`, content "Projects ›".
- Action buttons `.sb-actions button`: 32×32, `border-radius: --sb-radius-1`, icon
  18 px, colour `--sb-ink-2`, hover `--sb-overlay-8` tint and `--sb-ink`, active
  (`.sb-enabled`) `--sb-accent-soft` with `--sb-accent` icon. Touch: 44×44, gap 8 px.
  Tooltip text carries the key: "Home · Ctrl-Shift-h".
- Hamburger fly-out (`.sb-actions.hamburger`): `--sb-bg-panel`, `--sb-shadow-2`,
  `--sb-radius-2`, items 44 px; the `>_` and lock icons get labels ("Commands",
  "Read-only").
- Progress ring: unchanged geometry; colours `--sb-accent` / `--sb-line`.
- Mode chip `.sb-mode-chip` after the title (`client/components/mode_chip.tsx`, a
  Passive View of `chipView()`): 24 px pill, `--sb-text-sm` 500, the word carries the
  state. Tones: `quiet` (Preview, Read-only: `--sb-bg-2`, `--sb-ink-2`, eye / lock
  icon), `outline` (Edit, NORMAL: `--sb-line-strong` border), `accent` (INSERT:
  `--sb-accent-soft`, `--sb-accent`), `accent-outline` (VISUAL, REPLACE). Tooltip
  names the next step and the key ("NORMAL · Esc for Preview · Ctrl-Alt-p"). Touch:
  32 px tall with a 44 px hit area. Read-only is disabled. It replaces the phone's
  lock button.

### 3.2 Dock and tree (`_navigator.scss`, `_dock_menu.scss`, `client/navigator/**`; navigator)

- `.sb-nav-root`: `--sb-bg-panel`, `font: --sb-text-md` (14 px; was 16 px mono),
  `--sb-nav-row-height: 36px` (44 touch), right hairline `--sb-line`.
- Header `.sb-nav-header`: one row, `padding: 8px 10px`: the filter input, then
  `+ New` (icon button, opens the New menu), the dock menu `⋯`. Second row (tree
  only): segments and collapse/expand. Phone drawer header adds a third row of three
  44 px text-and-icon buttons: **Search · + New · Journal** (`.sb-nav-entry-points`).
- `.sb-nav-input`: placeholder "Open…" (tree) / "Filter…" (lists), `--sb-text-md`,
  placeholder colour `--sb-ink-2` (5.5 / 7.4; was 4.30 / 3.82); focus = 2 px
  `--sb-focus` ring on the row box, not an underline. Touch 16 px.
- Segments `.sb-segments` / `.sb-segment`: wrap `--sb-bg-2`, radius 8; segment
  height 28 px desktop, 44 px touch; active = `--sb-bg` with `--sb-shadow-1` and
  `--sb-ink` (the "raised pill" pattern), inactive `--sb-ink-2`.
- Rows `.sb-nav-row`: icon 16 px `--sb-ink-2`, name `--sb-ink`, folder weight 500,
  current page `aria-current="page"`: `--sb-accent-soft` background and a 3 px
  `--sb-accent` bar; hover `--sb-overlay-8`; `:focus-visible` 2 px `--sb-focus`
  ring inset −2 px (new).
- Row actions `.sb-row-actions`: hidden; `.sb-nav-row:hover`, `:focus-within` show a
  **single** `⋯` icon button (24 px, 44 touch) at the right end over a 20 px fade.
  The name keeps `flex: 1 1 auto; min-width: 12ch`. Touch: `⋯` always visible,
  44×44, one per row. The old four icons are gone.
- Row popover (reuses `.sb-dock-menu`): `--sb-bg-panel`, `--sb-radius-2`,
  `--sb-shadow-2`, `padding: 4px`, items 32 px (44 touch) with 16 px icon + label +
  right-aligned `kbd`: Rename · Move to… · Pin/Unpin · New page here (folders) ·
  separator · **Move to trash** (`.sb-dock-menu-danger`: `--sb-danger` text). First
  item focused on open; Esc and click-away close; arrows move.
- Drag: `.sb-nav-grip` `⠿` at `--sb-ink-3`, visible on hover; drop line
  `.sb-nav-drop-before/after` 2 px `--sb-accent`; folder target `--sb-accent-soft`.
  Touch: long-press 400 ms lifts the row (`--sb-shadow-2`, scale 1 — no scale).
- Empty folder row: "Empty. + makes a page here." `--sb-ink-2`, with the `+` as a
  real button.
- Inbox: children newest first; a time-named page under a date folder renders
  "11:17" (`row_item.tsx` display only).

### 3.3 Command palette and page picker (`modals.scss`, `_navigator.scss`; theme + navigator)

- `.sb-modal-box` / `.sb-modal`: width 640 px, `--sb-radius-3`, `--sb-shadow-3`,
  border `--sb-line`, backdrop `rgb(0 0 0 / .24)` (dark `.48`) with 4 px blur
  (`--modal-backdrop-color` re-pointed; the modal no longer floats on nothing).
  Phone: inset 8 px, top under the bar, radius 12.
- Header `.sb-header`: 48 px, the label ("Open", "Run", "Search") in `--sb-ink-2`,
  input `--sb-text-lg` (16 px) sans, no underline; the right side holds the dock
  menu and `×` as 32 px icon buttons. The label carries the verb, so the modal
  placeholder never repeats it: "Open" + "a page…" / "a document…" / "a page or
  document…" ("Open Open a page…" is a defect); the dock keeps "Open…" alone.
- Help text `.sb-help-text`: `--sb-bg-2`, `--sb-text-sm`, `--sb-ink-2`, only when
  there is something to say (the Shift-Enter hint only without an exact match).
- Group headers (new, `.sb-nav-group`): "Recent", "Suggested", then prefixes
  ("Page", "Navigate", "Database"…) in `--sb-text-xs` uppercase-free, `--sb-ink-3`,
  `padding: 10px 12px 4px`.
- Rows `.sb-option`: 36 px (44 touch), icon 16 px, label `--sb-ink`, description
  `--sb-text-sm` `--sb-ink-2` on the same line after a `·`; selected
  `--sb-accent-soft`; key hint `.sb-hint` as a `kbd` chip: `--sb-bg-2`, `--sb-ink-2`,
  `--sb-font-mono` 11 px, radius 4 (replaces the navy `#212476` pill).
- Result list `.sb-result-list`: `max-height: min(60vh, 11 rows)`, visible scrollbar,
  bottom fade 24 px when scrollable (`mask-image`).
- Footer hint row (new, `.sb-modal-footer`): "↑↓ move · Enter open · Shift-Enter
  create · Esc close", `--sb-text-xs`, `--sb-ink-3`, hidden on touch.

### 3.4 Editor body (`editor.scss`, `colors.scss`; theme)

- `#sb-main .cm-editor`: `font: 17px/1.6 var(--editor-font)`; `.cm-content`
  `padding: 8px 24px 0`. Headings per §2.1, weight 650, `margin-top` via
  `--sb-line-pad-y: 6px` for H1/H2. The `#` markers (`--editor-heading-meta-color`)
  hang in the margin at ≥ 880 px, inline below.
- Lists: bullet `•` at `--editor-list-bullet-color`; task checkbox `1.15em` box,
  radius 4, 1.5 px `currentColor` border; checked stays ink-on-paper (no green
  fill): box border and tick `--sb-ink-3`, text `line-through` at
  `--editor-task-completed-color`. `[completed: …]` grey, no strike.
- Inline chips: `#tag` per §2.3, radius 6, `padding: 0 5px`, 0.9em; wiki links
  `--sb-link` on `--editor-wiki-link-page-background-color`, radius 4, underline on
  hover only; `[due: 2026-10-14]` uses `--meta-color` on `--sb-overlay-8` (was
  `rgba(22,22,22,.07)`), overdue adds nothing in the editor (the view says
  "overdue").
- Frontmatter block: background per §2.3, radius 8, fold placeholder row 36 px with
  the chips, "7 lines hidden" at `--sb-ink-2`, marker `◂ frontmatter` as a 28 px
  text button at `--editor-frontmatter-marker-color`.
- Code and fences: `--sb-font-mono` 0.92em, `--editor-code-background-color`, radius
  6, the language tag `--sb-text-xs` `--sb-ink-3`; copy button is an icon button.
- Tables (`.sb-table-widget` and widget `table`): `display: block; overflow-x: auto;
  max-width: 100%`, header row `--sb-bg-2` and `--sb-ink` (not `#333` on `#eee`),
  zebra `--sb-overlay-8`, cells `padding: 6px 10px`, `white-space: normal` for body
  cells (the guide's 操作 column wraps instead of clipping).
- Blockquote bars `--sb-line-strong`; admonition hues unchanged.
- Widgets (`.sb-lua-directive-block`, `.sb-markdown-*-widget`, `.sb-page-widget`):
  frame `1px solid var(--sb-line)`, radius 8, title strip `--sb-bg-2` 40 px, body
  `padding: 10px 12px`.
- **Host bar** (`.button-bar`): no longer inside the frame. `position: absolute;
  top: -14px; right: 8px` (sits on the frame's top edge, half outside), `--sb-bg`,
  `--sb-line` border, radius 6, `--sb-shadow-1`, 28 px icon buttons: Reload · Edit
  (the second copy and bake move behind `⋯`; copy exists once, in `⋯`). Shows on
  `:hover` / `:focus-within` with `--sb-dur-2`. Touch: one 44×44 `⋯` at the same
  spot, always visible, opening the popover. `.db-header` therefore needs no reserved
  padding once this lands; until then dbview keeps `padding-right: 88px`.
  *Until the host emits the `⋯` button* (`data-button="more"` in `lua_widget.ts`, an
  owner item), the touch fallback is **Reload · Edit only**, 44 px each, in-flow at the
  frame's bottom edge: Copy and Bake are hidden (`display: none`) on touch, never a
  four-icon strip. The fenced-code copy button that CodeMirror adds to a ```` ```db ````
  fence (`.sb-fenced-code-iframe .sb-code-copy-button`) is hidden: a view has its own
  `⋯`, and a lone copy icon floating above the frame is the "second copy" product §6
  removes.
- Block handles: `⠿` and `▾` in the margin at `--sb-ink-3`, 0.8 opacity on hover,
  drop line `--sb-accent` 2 px (`.sb-block-drop-line`).
- CodeMirror find panel (`.cm-panels-bottom .cm-search`, `colors.scss`): background
  `--sb-bg-panel`, top hairline, one row on desktop: input (flex 1, `.sb-input`
  styling) · next · previous · all · three checkboxes as segments · `×`; buttons use
  `.sb-button` metrics (28 px), 40 px on touch where the panel wraps to two rows
  (input row, controls row). No `background-image` gradients. The Memo/Search
  modal is a different surface; this is "find in page".
- Selection, caret, external edit colours per §2.3.

### 3.5 Database views (`plugs/db-view/ui/db-view.scss` + components; dbview)

The view is an iframe that loads `components.css`, so `--sb-*` and `--db-*` are
available. `html { font: 14px/1.45 var(--ui-font) }`.

**Header** `.db-header`: one row, 40 px, `gap: 8px`, no wrap on desktop:
`Projects · 6` (`.db-title` 500, `.db-count` `--sb-ink-2`) · spacer · segments
`Table | Board | Calendar` (`.db-tabs` as `.sb-segments`; active = raised pill, text
`--sb-ink`, never white-on-accent) · `Filter…` input (`.db-filter`, 160 px, `aria-label
="Filter rows"`, a search-icon prefix) · `+ New` (`.sb-button-primary` 28 px) · `⋯`
(icon button; popover: Save view · Reload · Edit source). Under 600 px the header
wraps to two rows: title + `⋯` + `+ New`; then segments full width; filter under
them. All controls 44 px on touch. No copy button.

**Table** `.db-table`: header cells `--sb-text-sm` 500 `--sb-ink-2`, sort arrow
`--sb-accent` when active, `:focus-visible` ring; body rows 34 px, hairline
`--sb-line`, hover `--sb-overlay-8`. Name column `position: sticky; left: 0;
background: var(--sb-bg)` with a 12 px right edge fade when the scroller can scroll
(`.db-table-scroll[data-scrollable]::after`). Checkbox: 16 px glyph inside a 44×44
label (`.db-check-label`), `aria-label="Done: <name>"`. Editable cells
`.db-editable`: pencil icon (`--sb-ink-3`, 14 px) appears at the cell's right on
hover; single tap enters edit on touch; editing swaps in `.db-input` (16 px on touch);
Enter saves, Esc cancels; ISO date input. Dates: `tabular-nums`; `.db-due-overdue`
`--db-overdue` 600 plus the word "overdue" in `--sb-text-xs` after the date;
`.db-due-today` `--db-today` with "today"; done rows `.db-row-done` all text
`--sb-ink-3`, dates grey, no red. Status chip `.db-status`: pill, `--sb-text-xs`,
`--sb-bg-2` with `--sb-line`; `.db-status-active` border/text `--db-ok`;
`.db-status-done` `--sb-ink-3`.

**Row menu** `.db-row-menu-btn`: `⋯` icon button (24 px, 44 touch), `aria-label="Row
actions"`; opens `.db-popover` (fixed, anchored below-right, `--sb-bg-panel`,
`--sb-radius-2`, `--sb-shadow-2`, items 32/44 px): Rename · Duplicate · Archive /
Unarchive · separator · Move to trash (`--sb-danger`). Esc / click-away close, first
item focused, row height unchanged.

**New row** `.db-new-row`: after `+ New`, the input renders as the first table row
(or first card in the chosen column; in Calendar as a row above the grid), full
width, `--sb-text-md`, autofocus via `.focus()` on mount, placeholder "Title", a
`--sb-text-xs` hint "Enter opens · Shift-Enter stays · Esc cancels" beneath on
desktop; inline error "A page named X already exists" in `--sb-danger` under the
input. The header count does not jump onto the input.

**Board** `.db-board`: `grid-auto-columns: minmax(220px, 1fr)`, `gap: 12px`,
`overflow-x: auto; scrollbar-width: thin` (visible). Column `.db-column`:
`--sb-bg-2`, radius 8, head `.db-column-head` 36 px with title (500) and count
(`--sb-ink-2`), `+` icon button. Card `.db-card`: `--sb-bg`, `--sb-line` border,
radius 8, `--sb-shadow-1`, `padding: 8px 10px`, title wraps (`overflow-wrap:
anywhere`), meta row `--sb-text-xs` `--sb-ink-2`; dragging `--sb-shadow-2`, target
column `--sb-accent` 2 px dashed inset. Phone: `grid-auto-columns: 86%`, snap.
A drop is a mutation like a tick: the view shows the inline notice "Moved to
*someday* · Undo" (8 s) even when the view's own filter then hides the card, so a row
never vanishes silently. Cards that cannot move (a tasks board grouped by page) do not
lift: no grab cursor, no dashed target; a tap or click opens the row instead.

**Calendar** `.db-cal-*`: nav row `‹ › Today` as icon/text buttons + "October 2026"
(500); day numbers `--sb-text-xs`; today `.db-today .db-cal-num` filled
`--sb-accent` with `--db-on-accent` text (7.3 in dark; was 2.39); out-of-month
`--sb-ink-3`; "No date" tray `.db-undated` with the same card style. Phone: list of
days with cards.

**Cards under 480 px** (`@container (max-width: 480px)` on `.db-app`): the table
becomes `.db-card-list`: each row a card with the checkbox, Name (500), and a meta
line "Status active · Due 2026-10-14 · Area Store" in `--sb-text-sm`; `⋯` top-right.
No horizontal scroll.

**Empty states** `.db-empty-view`: centred, `--sb-ink-2`, 24 px padding, text from
product §5, the action as a `.sb-button-primary` beneath.

**Focus**: `.db-tab, .db-btn, .db-th, .db-check-label, .db-editable, .db-card` share
`:focus-visible { outline: 2px solid var(--sb-focus); outline-offset: 2px }`.

### 3.6 Graph (`plugs/object-graph/ui/object-graph.scss` + components; graph)

- Header `.gv-header`: 48 px, title "Graph" (`--sb-text-md` 600) · spacer · Hops
  select (`.sb-select`, labelled) · "Hide labels" and "Hide orphans" as toggles ·
  Expand all / Focus (`.sb-button`) · Close (`.sb-button-icon` 32 px, 44 touch,
  `position: sticky; right: 0`). Under 640 px: header is two rows (title + Close;
  then a "Filters" button that opens the sheet); Expand all / Focus move into the
  sheet.
- Sidebar `.gv-sidebar` 240 px desktop (`--sb-bg-panel`, right hairline). Sections
  `.gv-section-header` `--sb-text-sm` 500 `--sb-ink-2`, 32 px, chevron. Order:
  **Similar pages** (toggle, "more / fewer" pair instead of two sliders, count in
  `--sb-ink-2`, off-state line "Similar pages need Search by meaning") · **Legend**
  (three rows: solid "Link", dotted "Mention", dashed "Similar page", each a 24 px
  swatch line at its token) · Tags (swatch dot per hue) · Status · Area · Filter
  input (`.sb-input`, labelled "Filter nodes", 16 px touch). Hidden-orphans line:
  "14 pages hidden (no connections) · Show" as a `.gv-more` link.
- Canvas: nodes r = 6 + log(degree), fill by tag hue, `1px` stroke `--gv-node-stroke`
  (2 px `--sb-accent` ring on the current page), labels 12 px `--gv-label` with a
  `--sb-bg` halo; dimmed nodes 0.55 opacity with labels at `--gv-label-dim` (never
  0.35). Edge widths 1.25 px; similar dashed `4 3`, mention dotted `1 3`.
- Controls `.graph-controls`: zoom (`+ −`) bottom-right, pan pad bottom-left, both
  `--sb-bg` 32 px (44 touch) buttons with `--sb-shadow-1`; 16 px inset; the layout
  centres the current node in the canvas minus a 64 px safe band at the bottom so
  the pads never sit on it.
- Node list `.gv-node-list` (`role="listbox"`): desktop below the sidebar sections
  (collapsible "Nodes · 12"), phone under the canvas inside the sheet; rows 32/44 px,
  name + kind chip, `aria-selected` synced with the canvas; arrows move, Enter opens.
- Bottom sheet (`.gv-sheet`, phone): `--sb-bg-panel`, radius 12 top corners,
  `--sb-shadow-3`, handle 36×4 `--sb-line-strong`, collapsed height 56 px ("Filters
  · Legend · Nodes"), expanded 60 vh, scrolls inside; canvas keeps ≥ 70 % of the
  width because the sheet overlays the bottom, not the side.

### 3.7 Toasts and notices (`top.scss` `.sb-notifications`, `colors.scss`; theme)

- Container `.sb-notifications`: `position: fixed; bottom: 16px; left: 50%;
  transform: translateX(-50%)`, phone bottom 72 px (above the keyboard bar), column,
  gap 8 px, `z-index: 1000`. Never at `top: 60px` over line 1.
- Toast `.sb-notification-{info,success,error}`: `--sb-radius-3`, `--sb-shadow-3`,
  `padding: 10px 14px`, `--sb-text-md` sans, colours per §2.3, max width 480 px, an
  icon 16 px (info i, success check, error alert), message, then
  `.sb-notification-actions` with `.sb-button` 28 px ("Undo", "Set up Ask", "Open")
  and the `×` dismiss. Enter from `translateY(8px)` `--sb-dur-3`; auto-dismiss 8 s
  when an Undo is present, 4 s otherwise; hover pauses.
- Inline notices inside panels (`.sb-nav-notice`, `.db-notice`, `.gv-header-notice`):
  rows, not banners: `--sb-bg-2`, radius 8, `--sb-text-sm`, an icon, at most two
  sentences, an action button at the right when there is one.
- Voice: "<What happened>. <What to do>." No command prefix, no em-dash chains.

### 3.8 Dialogs (`modals.scss` `.sb-prompt`; theme)

Title as a question with the object name in 600 ("Move *Scratch Audit* to trash?"),
body `--sb-ink-2` ("You can restore it from Trash."), buttons right-aligned: Cancel
(`.sb-button`, focused) then the verb (`.sb-button-primary`, or `.sb-button-danger`
for permanent delete and Trash: Empty). Width 440 px, radius 12.

### 3.9 Page header: cover and icon (`Page Header.md`; lua)

Cover: full editor width, 180 px (phone 120), radius 8, `object-fit: cover`. Icon:
64 px emoji overlapping the cover's bottom-left by 24 px, else inline above the
title. Breadcrumb line "Projects ›" (`--sb-text-sm`, `--sb-ink-2`) above the cover,
so the H1 is the title and the top bar may show only the last segment.

### 3.10 Skeletons (`colors.scss`; theme) and loading

`.sb-skeleton`: `background: linear-gradient(90deg, var(--sb-skeleton) 25%,
color-mix(in srgb, var(--sb-skeleton) 60%, var(--sb-bg)) 50%, var(--sb-skeleton)
75%)`, `background-size: 200% 100%`, `animation: sb-shimmer 1.4s linear infinite`,
radius 6; `.sb-skeleton-line` (height 1em, margin 6px 0), `.sb-skeleton-row` (36
px). Lua widgets render three lines while a query runs. Per section, never a spinner
over the page; `.sb-loading-spinner` stays for inline waits under 300 ms.

### 3.11 Quick note placeholder (`client/codemirror/block_editor/**`; lua)

CodeMirror `placeholder()` on an empty page under `Inbox/`: "Write it down. It is
saved as you type. Esc goes back." styled `--sb-ink-3`, italic off.

### 3.12 Standalone pages (`_standalone.scss`; theme)

Login, setup, dashboard reuse the roles: `.sb-folder-browser` and `.sb-token-list`
backgrounds `--sb-bg-panel`, borders `--sb-line`, `#555/#999` → `--sb-ink-2/-3`,
`#1a7f37` → `--sb-ok`, `#9a6700` → `--sb-warn`, `#0002` → `--sb-overlay-8`.

---

## 4. Interaction principles

**Keyboard.** Every surface is reachable without a mouse: `Ctrl-k` open, `Ctrl-/`
commands, `Ctrl-o` tree, `Ctrl-q s/a/r` search/ask/related, `Ctrl-Shift-g` graph,
`Ctrl-Alt-n` New; Esc always leaves (menu → panel → modal → then Tab leaves the
editor, owner item). Focus is visible on every control: 2 px `--sb-focus` ring,
offset 2 px (−2 px inside rows). Popovers open with the first item focused and trap
arrows, not Tab. Tooltips name the key ("Tree · Ctrl-o").

**Touch.** Under `(pointer: coarse)`: 44 px targets with 8 px gaps, 16 px inputs,
one `⋯` where hover would reveal actions, single tap to edit, long-press (400 ms)
to drag, bottom sheets instead of side panels, the drawer header holds Search · +
New · Journal. No `user-scalable=no` (owner item).

**Empty states** are content, not absence: a sentence in `--sb-ink-2` and one
action button, text from product §5, centred in the component's own box.

**Loading**: skeletons in place; the first paint of a view never shifts once the
data arrives (reserve row heights). Expected misses are not errors.

**Errors**: inline rows with an action when one exists; toasts for things that
happened elsewhere; dialogs only when a decision is needed. Red is reserved for
irreversible actions and failures; overdue is `--sb-danger` only in views and only
with the word beside it.

**Reversible**: every mutation from chrome shows "<Verb> · Undo" for 8 s; the toast's
Undo is a real button; undo restores the file content read before the action.

---

## 5. UI language

Chrome labels follow upstream English (commands, tabs, menus, tooltips, empty states,
dialogs, toasts) so upstream plugs and the palette read as one list. The in-app guide
(`Library/Std/Docs/Fork Guide.md`) stays Japanese and translates the product §1
glossary 1:1. No surface mixes the two. Dates are ISO everywhere; the only words next
to them are "overdue", "today", "tomorrow". No `uiLanguage` switch now; the token
and component layer does not change when one arrives.

---

## 6. What must not change

- **Markdown is the truth.** No chrome state that is not a file change or a
  per-browser convenience. Views write back to the ```` ```db ```` block; the tree
  writes renames; toasts undo by rewriting the file.
- **Upstream code stays minimal and additive**: token *names* (`--ui-*`,
  `--editor-*`, `--modal-*`, `--button-*`) are kept and re-pointed; new names are
  `--sb-*`. No new build steps, no CSS framework, no external fonts, no icon font
  (Feather SVGs as today).
- **Offline and local**: every asset is in the bundle; the sidecar being absent
  degrades to a sentence.
- **Keyboard-first**: no existing upstream shortcut is rebound; new ones use the
  `Ctrl-q` and `Ctrl-Alt` registers only.
- **The editor column**: 800 px max, CodeMirror 6, the block editor's handle and
  fold toggle, the frontmatter fold, the hashtag/wiki-link chips as inline elements.
- **Light and dark**: one palette with two readings; `html[data-theme]` and
  `prefers-color-scheme` both honoured; iframes keep receiving the attribute.
- **Component rule** (CLAUDE.md): components render props and `emit` events; the
  mediator decides. Nothing here asks a component to own state.
- **The space layout** and the folder contract; the view, command and library names
  the product document fixes.

---

## 7. Measured acceptance (what a reviewer runs)

- `audit-a11y/measure.mjs` on the demo: no text under 4.5 (large ≥ 3), no interactive
  element under 44 px on iPhone 13, no unlabelled input, no page-level overflow.
- Screenshots `shots/<name>` light/dark × desktop/mobile for home, project, Tasks
  (table/board/calendar), palette, picker, search, graph, journal, quick note,
  trash dialog, a toast with Undo.
- The element at the centre of "+ New" on Tasks is the New button in both schemes.
- No external network request for fonts (`document.fonts` lists only iA-Mono).

---

## 8. Token cheat sheet (names every stream may use)

Published by theme in `_tokens.scss` / `theme.scss`, visible in `main.css` and
`components.css` (so inside db-view and graph iframes):

```
Fonts     --sb-font-sans --sb-font-mono --ui-font --editor-font --editor-monospace-font
Type      --sb-text-xs --sb-text-sm --sb-text-md --sb-text-lg --sb-text-editor --sb-text-title
Space     --sb-space-1..6  --sb-control --sb-control-touch --sb-row
Radius    --sb-radius-1 --sb-radius-2 --sb-radius-3 --sb-radius-pill
Shadow    --sb-shadow-1 --sb-shadow-2 --sb-shadow-3 --sb-shadow-color
Motion    --sb-dur-1 --sb-dur-2 --sb-dur-3 --sb-ease-out --sb-ease-in
Surfaces  --sb-bg --sb-bg-panel --sb-bg-2 --sb-line --sb-line-strong --sb-overlay-8 --sb-overlay-16
Ink       --sb-ink --sb-ink-2 --sb-ink-3
Accent    --sb-accent --sb-on-accent --sb-accent-soft --sb-link --sb-focus
Semantic  --sb-danger --sb-warn --sb-ok --sb-info
Views     --db-overdue --db-today --db-soon --db-ok --db-danger --db-on-accent --db-drop
Toasts    --sb-toast-{info,success,error}-{bg,fg}
Misc      --sb-skeleton --sb-top-height
Legacy    --ui-accent-color --ui-accent-contrast-color --ui-surface-* --modal-* --button-*
          --subtle-color --panel-background-color --root-* --editor-* (all re-pointed, still valid)
```

Owned by graph (defined in `object-graph.scss` from the roles above):
`--gv-link --gv-link-dim --gv-link-similar --gv-link-mention --gv-label --gv-label-dim
--gv-node-stroke --gv-tag-{project,area,goal,journal,resource} --gv-untagged`.

Shared component classes (in `components.scss`, usable in iframes): `.sb-button
.sb-button-primary .sb-button-danger .sb-button-icon .sb-input .sb-select .sb-checkbox
.sb-segments .sb-segment .sb-badge .sb-kbd .sb-skeleton .sb-popover` (new: the
popover shell `.sb-dock-menu` is promoted to `components.scss` as `.sb-popover` with
`.sb-popover-item` and `.sb-popover-danger`, so dbview and graph can use it).
