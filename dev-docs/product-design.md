# BlackBullet product design: the meaning layer

Status: design, 2026-10-02. Written against the demo space, the baseline screenshots
and the two audits (usability; accessibility / mobile / dark). This document is the
reference for what things are called, what the app is for, and what every surface
must do before it is allowed to look good. Streams (theme, navigator, dbview, graph,
lua) implement section 8; items outside their files are listed in section 10 for the
owner, each with the default chosen here.

Guiding sentence: **BlackBullet is one person's notes, kept as Markdown files they own,
with an editor that makes capturing fast, organising cheap, finding by meaning normal,
and asking questions possible. AI is a guest with a key to the Inbox, never the owner
of the house.**

---

## 1. Concept model and vocabulary

One name per concept. Labels, commands, docs, empty states and error text use these
words and no synonyms. The guide stays Japanese but translates these same concepts
1:1 (the Japanese term is listed so the guide and the chrome never drift).

| Concept | What it is to the user | Shown as | Never shown | 日本語 (guide) |
| --- | --- | --- | --- | --- |
| **Page** | One Markdown file. The unit of everything. | Its name = last path segment ("Spring Launch"); the folder as a dim breadcrumb ("Projects ›") | the `.md` extension, "object", "note" as a different thing | ページ |
| **Folder** | A path prefix that groups pages. Pages move between folders; links follow. | Tree node, breadcrumb | "directory", "prefix" | フォルダ |
| **Tag** | A `#word` on a page or task. Free-form. | Chip `#next` | "meta" tags, `tags:` frontmatter key | タグ |
| **Database** | A declared set of pages that share **properties** (Status, Due, Area…). Lives in one folder, has a template, has typed properties. | By its title ("Projects") and its + New | that it is "tag + frontmatter + folder", `database.define`, `tag.define`, YAML | データベース |
| **Property** | A typed field of a database row (select / date / page / number / text). | Column header, chip, cell editor | "attribute", "frontmatter key" | プロパティ |
| **Row** | One page that belongs to a database. | Table row / board card / calendar card | "object", "record" | 行 |
| **View** | A lens on a database or on tasks: **Table**, **Board**, **Calendar**. A ```` ```db ```` block *is* a view. "Save view" writes its tab, sort and filter into the block. | Tabs Table · Board · Calendar; "Save view" | "widget", "iframe", "db block" (in chrome), 表/ボード/カレンダー in English chrome | ビュー |
| **Task** | A checkbox line anywhere (`* [ ]`). Has Done and Due; belongs to the page it is on. | Checkbox + text + Due + Page | "task object", `@195` offsets | タスク |
| **Journal** | One page per day under `Journal/`. "Today" is the entry point. | "Journal: Today", prev/next day | the folder path in the header | ジャーナル |
| **Quick note** | A page captured in seconds into the **Inbox**. The action is "Quick note", the place is "Inbox". | "Quick note" (action), "Inbox" (folder) | `Inbox/2026-10-02/11-17-18` as a title | クイックノート / 受信箱 |
| **Template** | A page under `Templates/` that New copies. | Picked by name in New | `${title}` plumbing (except in docs) | テンプレート |
| **Search** | Section-level search over everything, by words *and* meaning. One modal. | "Search" (modal title), `Search: Notes` | "Memo", "sidecar", "RRF", ranks, scores | 検索 |
| **Related** | The pages most related to the one open: similar in meaning and/or linked. | "Related notes" panel; chips "Similar", "Linked", "Similar · Linked" | numeric scores | 関連ノート |
| **Graph** | Pages as nodes; links, mentions and similarity as edges. | "Graph" | "Object Graph", "semantic edges" in labels (say "Similar pages") | グラフ |
| **Ask** | A question answered from the notes, with citations `[1]`. One conversation at a time; answers can be saved as pages under `Ask/`. | "Ask" (modal), `Ask: Notes` | "Memo: Ask", model plumbing in the first screen | 質問 (Ask) |
| **Document** | A non-Markdown file in the space (PDF, image, docx…). Searchable, openable, not editable. | File icon, kind badge `PDF p.3` | "attachment", "blob" | 文書 |
| **Trash** | `Trash/`. Everything deleted from the UI goes here first and can be restored. Permanent deletion happens only *inside* Trash. | "Move to trash", "Trash: Restore", "Trash: Empty" | "Delete" as a one-click permanent action, `trashedFrom` | ゴミ箱 |
| **Home** | The `index` page. | "Home" | "index" as a title | ホーム |
| **Panel** | A dockable chrome surface: Tree, Related notes, Ask, Search. (Not a "view": that word belongs to databases.) | by its title | `view.define`, "dock" | パネル |

### What the user should never have to know
- that a database is a tag plus frontmatter in a folder; they declare it once via
  `Database: New Database` (today `Database: Define in CONFIG`) and then only see
  properties, rows and views;
- that Search, Related, the graph's similar edges and Ask share a sidecar called
  "memo-mcp" (one setting, one off-state message: "Search by meaning is off");
- scores, ranks, RRF, embeddings, "semantic";
- `trashedFrom`, `pageDecoration.tree.priority`, `archived: true` as YAML (the row menu
  says Archive);
- that views are sandboxed iframes (no second toolbar from the host, no "bake");
- `@195` offsets, `Page@96`: a task reference is the page name, nothing more;
- Japanese labels in English chrome or vice versa; the guide is Japanese *by design*,
  the chrome is English *by design*.

### Where things live (the folder contract the space template and demo follow)
`Home` (index) · `Inbox/` (quick notes, MCP `add_inbox`) · `Journal/` · `Projects/`,
`Areas/`, `Goals/`, `Resources/` (databases or plain folders; the demo makes Projects a
database) · `Templates/` · `Ask/` (saved answers) · `Trash/` · `Library/` (code the user
does not edit; hidden from pickers and tasks) · `CONFIG` (settings; hidden from pickers).

---

## 2. Jobs to be done and primary flows

For each job: the one-keystroke / one-tap path, what sits in the command palette, what
is progressive disclosure, and the order of elements on the screen.

### 2.1 Capture ("get it out of my head in five seconds")
- One keystroke: `Ctrl-q q` quick note; `Ctrl-q j` today's journal. One tap on the
  phone: **+ New → Quick note** in the tree drawer header, and **Journal** next to it.
- Flow: keystroke → page opens with the caret ready → placeholder "Write it down. It
  is saved as you type. Esc goes back." → user types → `Esc`/back returns to the
  previous page. The title area says "Quick note · 11:17", not the path.
- Palette: `Quick Note`, `Journal: Today`, `Journal: Previous Day`, `Journal: Next Day`,
  `Page: New`, `New: Row in <database>`.
- Progressive: templates (`Ctrl-q t`), MCP `add_inbox` (the AI's door into the same Inbox).
- Later processing: the Inbox folder in the tree, newest first; move with drag or
  "Move to…"; nothing nags.

### 2.2 Organise ("put it where I will find it")
- One keystroke: `Ctrl-o` tree; drag a row to a folder; `Ctrl-k` then `Shift-Enter`
  creates in the current folder.
- Unified **New** (tree header `+`, palette `New`, `Ctrl-Alt-n`): Page here · Row in
  <database>… (one entry per declared database) · Quick note · Journal: Today. The
  same list in the same order everywhere.
- Properties are edited in the page's folded frontmatter chips or in any view; tags
  are typed inline.
- Progressive: `Database: New Database` (writes CONFIG for you, then opens the view),
  Pin, Move to…, Rename (links follow), Archive.

### 2.3 Find ("I know it exists")
- One keystroke: `Ctrl-k` open by name (recent first) · `Ctrl-q s` Search (sections,
  by words and meaning; `Ctrl-Shift-f` once the editor keymap yields, see §10)
  · `Ctrl-Shift-g` Graph.
- Search modal order: input → count line ("12 sections for *launch*") → results
  (Page › Section, then the matched sentence) → footer hint "Enter: jump · Esc: close".
  Scope words (`in:Projects/`, `kind:pdf`, `#tag`) are progressive, shown as a hint
  under the input only when the phrase starts with `in:`/`kind:`/`#` or on `?`.
- Related notes: a collapsed panel at the bottom of every page ("Related notes · 8"),
  opened once and remembered. Chips say Similar / Linked, never numbers.
- Graph: opens on the current page with its neighbours visible (never an empty canvas).
- Off-state (no sidecar): the modal still opens and says what is off and what to do
  (§5); it never flashes a red error over the text.

### 2.4 Plan ("what is next, what is late")
- The `Tasks` page is a page like any other with views on it; the home page shows
  "Due soon" (overdue first) and "Active projects".
- Tick anywhere (page, view, home). Ticking never makes the row vanish silently:
  struck through, toast "Done · Undo" (8 s), gone on the next render.
- Due: tap/click the date cell (pencil on hover, single tap on touch), ISO date in,
  "overdue" word out, not only colour.
- Board for tasks groups by **page** (the project) by default; Board for a database
  groups by its first select property (`status`). Empty columns are not shown when a
  "None" column holds everything.
- Palette: `Task: Cycle State`, `Database: New Row`, `Database: Insert View`.

### 2.5 Reflect ("what happened, what did I think")
- `Ctrl-q j` today; `Ctrl-q p` / `Ctrl-q n` move by day; home lists the last 7 days.
- A journal page is titled by its date; `@today` inserts a link to it from anywhere.
- Progressive: Related notes on a journal page surfaces the project it talks about.

### 2.6 Ask ("answer this from my notes")
- `Ctrl-q a` Ask → one input ("Ask your notes…") → answer in the Ask panel with
  `[1]` citations that jump to sections → footer actions: Follow-up · Save answer ·
  New conversation.
- First run without a key: the panel opens with "Ask needs an Anthropic API key. The
  key is stored in your CONFIG page and used only when you ask." and a **Set up Ask**
  button. No red banner.
- Progressive: scope words, model choice, `maxTokens`, `allowConfidential`, History.

### 2.7 Use from AI ("let my assistant read and write the same notes")
- Nothing in the chrome. The contract is the folder contract (§1): the AI writes to
  Inbox and Journal and reads everything but CONFIG/Library. A page the AI created
  looks like any other page; the Inbox is the human's review queue.
- `./setup.sh` prints the MCP command; the guide links to it. No UI for tokens.

---

## 3. Screens: order of elements by importance

**Home (index).** 1) Capture row: Quick note · Today's journal · Search (three
buttons; on the phone they are the whole top). 2) Due soon: overdue first, max 10,
each "☐ Finish product photos · Spring Launch · Oct 14". 3) Active projects (database
view, Table, 5 rows, "Open Projects"). 4) Recent journal (7 days). 5) Recently edited.
Empty states per section (§5). No "Welcome…" prose once the space has content.

**Page.** 1) Title (last segment) with a dim breadcrumb; cover/icon when set.
2) Property chips (folded frontmatter): `#project · Status active · Due Oct 14 · Area
Marketing` — a chip opens its editor. 3) Body. 4) Related notes (collapsed, with
count). 5) Linked mentions (collapsed). Block handles and fold toggles only on hover.

**Database view (in a page).** Header, one row: `Projects · 6` · `Table | Board |
Calendar` · `Filter` · `+ New` · `⋯` (Save view · Reload · Edit source). Table: Name
first and sticky; properties in declared order; Page (for tasks) last; the row menu
`⋯` last. Board: columns in declared order, min 220 px, horizontal scroll with a
visible bar, cards wrap their title. Calendar: month title "October 2026", `‹ › Today`,
"No date" tray last.

**Search modal.** Input → count → results → hint. One result = `Page › Section` +
matched sentence; a document hit carries `PDF p.3`.

**Ask panel.** Question (dim) → answer → sources ("Cited: [1] Spring Launch › Next
actions"; "Also read: …" collapsed) → actions.

**Graph.** 1) Canvas with the current page centred and its neighbours. 2) Close (always
visible, 44 px). 3) Filters in a sidebar (desktop) or bottom sheet (phone): Similar
pages (on/off, "more / fewer"), Tags, Status, Area, with a legend of the three edge
kinds. 4) Pan/zoom controls bottom-left, never over the current node. 5) Node list
(keyboard and screen-reader path).

**Command palette.** Input → Recent (5) → Suggested (Quick Note, Journal: Today,
Search: Notes, Ask: Notes, Page: New, Navigate: Tree) → everything grouped by prefix.
Destructive and developer commands (`Client: Wipe`, `Client: Logout`, `Client: Reload
UI`, `Client: Version`, `Baked Sections: *`, `Navigate: Meta Picker`, `Navigate:
Document Picker`) appear only when typed.

**Tree.** Filter input ("Open…") · `+ New` · Collapse/Expand · rows. A row is its icon
and name; actions appear on hover/focus (pointer) or behind one `⋯` (touch). The
name has layout priority; actions overlay the row's right end with a fade, never
truncate the name below ~12 characters; full name in the tooltip.

**Page picker.** Input → "Press Shift-Enter to create *X* in *Projects/*" only when no
exact match → results, recent first. Pages tab hides `Library/`, `Templates/`,
`Trash/`, `CONFIG` (they are in All, or when typed).

---

## 4. Consistency rules (testable)

1. **One New.** Every way to create something lists the same options in the same
   order: Page here · Row in <database>… · Quick note · Journal: Today. (Tree `+`,
   palette `New`, header `+` on the phone, view `+ New` is the "Row in…" item
   pre-selected.)
2. **One filter.** A text box labelled "Filter" with placeholder "Filter…" filters the
   list it sits in (tree, view, graph, picker). Search is a different thing and is
   never called Filter.
3. **Same affordance, same action.** Row menus are `⋯` buttons that open an anchored
   popover (Esc and click-away close; first item focused; danger item last and red).
   Cell edit: pencil on hover, single tap on touch, Enter saves, Esc cancels.
   Drag: a `⠿` handle on hover, long-press on touch; a drop line shows the target;
   Esc cancels. The same rules in the tree, the block editor and the views.
4. **One notice voice.** A notice is two sentences at most: *what happened* and
   *what to do*, in plain English, no command-name prefix ("Memo: Ask —"), no stack of
   em-dashes. Three kinds: info (grey), success (green, with Undo when reversible),
   error (red, with an action button when one exists). Inline banners never overlap
   content; they are rows in the panel or toasts.
5. **Reversible by default.** Tick, trash, move, archive, reorder each show
   "<Verb> · Undo" for 8 s. Permanent delete exists only inside Trash and asks.
6. **Dialogs.** Title is a question with the object's name ("Move *Scratch Audit* to
   trash?"), body says the consequence ("You can restore it from Trash."), Cancel has
   focus, the verb is the button label ("Move to trash"), danger verbs are red.
7. **Dates.** ISO `2026-10-14` in cells and inputs (language-neutral, sortable); a
   relative word beside it where it matters: "overdue", "today", "tomorrow". Done rows
   never show red dates.
8. **Language.** English chrome, Japanese guide. No mixed-language surface. Column
   headers come from the database's `label`, else the key capitalised.
9. **Keyboard scheme (no collisions).**
   - `Ctrl-<letter>`: text and editor (upstream: b, i, e, f find in page, k open, o tree, / commands).
   - `Ctrl-Shift-<letter>`: open a surface (h Home, k meta, g Graph; f Search *after* §10.1).
   - `Ctrl-q <letter>` ("quick"): q quick note, j journal, p/n day, t template,
     **s Search, a Ask, r Related notes** (new).
   - `Ctrl-Alt-<letter>`: tools (t tags, i mentions, r reload, c comment, m marker, l centre, **n New**).
   - `Mod-.` chords: outline. Nothing else binds `Ctrl-Shift-f` until the editor yields it.
   - `Esc` always means "leave": close the menu/panel, cancel the edit, cancel the
     drag, and (then) let `Tab` leave the editor.
10. **Touch.** Every control a thumb needs is ≥ 44 × 44 CSS px under `(pointer:coarse)`;
    inputs are 16 px; hover-only affordances have a tap equivalent (`⋯`, long-press).
11. **Loading.** A section that waits shows a skeleton in its own box, never a spinner
    over the page; expected misses (page not found on create) are not logged as errors.
12. **Names in the index are the page name**, never `Name@offset`.

---

## 5. Empty states and first run (each teaches the next step)

| Where | Text (English chrome) | Action it offers |
| --- | --- | --- |
| Home, new space | "Your notes live here as Markdown files. Start with one of these." | Quick note · Today's journal · New database (opens `Database: New Database`) |
| Home: Due soon, none | "Nothing due. Tasks you write as `* [ ]` anywhere show up here." | — |
| Home: Active projects, no database | "Projects can be a database: pages with Status, Due and Area that you see as a table, board or calendar." | **Create the Projects database** |
| Database view, no rows | "No rows yet. **+ New** makes a page in *Projects/* from *Templates/Project*." | + New (inline, centred) |
| Database view, filter hides all | "Nothing matches *xyz*." | Clear filter |
| Tasks view, none open | "All done." | — |
| Search, sidecar off | "Search by meaning is off. Start it with `./setup.sh` or set `memoSidecar` in CONFIG." plus a row "Open a page named *launch* instead" | runs the page picker with the phrase |
| Search, no hits | "No sections match *xyz*. Try fewer words, or `in:Folder/` to narrow." | — |
| Related notes, sidecar off | "Related notes need Search by meaning. Start it with `./setup.sh`." | — |
| Related notes, none | "Nothing related yet. Links from this page will show here." | — |
| Ask, no key | "Ask needs an Anthropic API key. It is stored in your CONFIG page and used only when you ask." | **Set up Ask** |
| Ask, sidecar off | "Ask reads your notes through Search by meaning, which is off." | same as Search |
| Graph, no neighbours | "This page has no links or similar pages yet. 14 pages are hidden because they are not connected: **show them**." | Show orphans |
| Quick note, empty | placeholder "Write it down. It is saved as you type. Esc goes back." | — |
| Tree, empty folder | "Empty. **+** makes a page here." | + New page here |
| Palette, no match | "No command matches *xyz*." | — |
| Trash, empty | "Trash is empty." | — |

---

## 6. Remove or merge

- The second copy icon above a `db` widget (host bar) and the copy in the view
  header: keep none in the view header; the host bar collapses to one `⋯`.
- The host widget bar (reload · copy · bake · edit) as a permanent overlay on touch:
  one `⋯` of 44 px, and never over the view's own header.
- "Compact / Details" segment in Search (scores are developer information): remove;
  keep behind `memoSidecar.debug = true`.
- Numeric scores in Related chips: remove; words only, score in the tooltip.
- The `Memo:` command prefix: gone (Search:, Ask:).
- "Object Graph" title → "Graph"; "Semantic edges" → "Similar pages".
- The four permanent icons on the active tree row: hover/focus only, or one `⋯`.
- "Bookmark" vs "Pin": one word, **Pin**.
- "Delete" in the tree vs "ゴミ箱へ" in rows: one action, **Move to trash**.
- Japanese labels in the view (表 / ボード / カレンダー / 絞り込み / 名前 / 期限 /
  ページ / 更新 / ビューを保存 / 行の操作 / 名前を変える / 複製 / アーカイブ /
  ゴミ箱へ / (なし) / 日付なし / 2026年10月): English.
- Palette empty list of `Client: Wipe/Logout/Version/Reload UI`, `Baked Sections`,
  `Meta/Document Picker`: hidden until typed.
- `Repositories/Std`, `CONFIG`, `Templates/`, `Trash/` in the Pages tab: hidden.
- `Page@96` / `Spring Launch@195` task references: page name only.
- Template and library tasks in task lists: excluded (`Templates/`, `Library/`, `Trash/`).
- The home page prose that teaches `Ctrl-Shift-f` and "double-click a due date":
  replaced by the capture row and by affordances in the view.
- Three empty board columns plus a "(none)" column holding everything: drop empties.
- The pan pad on top of the current node.
- The red "not configured" banner over line 1 of the page.
- The raw path as a page title ("Inbox/2026-10-02/11-17-18", "Projects/Spring Launch").
- `mm/dd/yyyy` in a date editor: ISO.

## 7. Missing for the jobs

- Unified New (tree `+`, palette `New`, `Ctrl-Alt-n`, phone header).
- Undo toasts for tick / trash / move / archive.
- Trash as a space-wide concept (tree too), `Trash: Restore`, `Trash: Empty`.
- Result count and scroll cue in Search; body snippets.
- "overdue" as a word; done rows neutral.
- Phone entry points: Search, New, Journal in the drawer header; 44 px targets.
- A read-only, folded presentation for guide/library pages.
- Keyboard reach: Esc-then-Tab out of the editor; a focus ring on every control.
- Legend and sensible defaults in the graph; a node list.
- Skeletons for home sections.
- Proportional type for prose and chrome (mono only for code) so phones and 260 px
  docks fit words, and the editor reads like notes, not a terminal.

---

## 8. Mobile posture

**The phone is for:** capture (quick note, journal, a task line), reading (home, a
page, the Inbox), ticking (tasks as a card list), quick search / open, and moving a
page with "Move to…". Everything a thumb needs is one tap from the drawer header:
Search · + New · Journal.

**The phone is not for:** defining databases, editing CONFIG, saving views, dragging
blocks, board drag (allowed with long press but never required), graph exploration
(the graph becomes "current page and neighbours" with a bottom sheet of filters and a
node list), Ask set-up (works, but is desktop-first).

Rules: last path segment as the title; tables become cards under 480 px (Name, then
properties as "Status active · Due Oct 14"); 16 px inputs; no `user-scalable=no`
(owner item); the `⋯` row menu is the only menu; one-tap edit on editable cells.

---

## 9. Required changes by stream

Priorities: P0 blocks the jobs above or breaks a real flow; P1 makes the concept model
true in the UI; P2 polish. Acceptance is what a reviewer checks on the demo space
(desktop 1280×800, phone iPhone 13, light and dark).

### theme (client/styles/** except _navigator.scss, _dock_menu.scss; capture.scss; _fonts.scss)
- **T1 P0 Widget host bar never covers content.** On hover devices the bar sits
  outside the widget's box (above its top-right, or in-flow) and shows on hover; under
  `(hover:none)` it is one 44 px `⋯` that expands on tap. *Accept:* on Tasks the
  element at the centre of "+ New" is the New button; mobile home shows no text under
  the bar; the view's own header is fully visible.
- **T2 P0 Touch targets in the header.** Under `(pointer:coarse)` header buttons are
  ≥ 44 px with ≥ 8 px gaps; the title shows its last segment first (`direction: rtl`
  ellipsis trick or two lines). *Accept:* measured sizes ≥ 44; "Spring Launch" readable
  on the phone.
- **T3 P1 Type.** Prose and chrome in a self-hosted/system proportional stack
  (`ui-sans-serif, -apple-system, "Segoe UI", Roboto, "Noto Sans JP", sans-serif`),
  mono only in code, tables of code and the editor's raw-source mode; a config
  `editorFont` keeps mono for people who want it. *Accept:* no external font requests;
  body text proportional; code mono; same line-height rhythm light/dark.
- **T4 P1 Contrast.** Dark meta red ≥ 4.5:1; light bullets, frontmatter marker and
  fold status ≥ 4.5:1; hashtag chips ≥ 4.5:1; `completed` neutral grey, no red.
  *Accept:* audit `measure.txt` rerun shows no text < 4.5 (large ≥ 3).
- **T5 P1 Theme-aware overlays and standalone pages.** Replace `rgba(22,22,22,.07)`,
  `#0002`, `_standalone.scss` hex with tokens / `color-mix`. *Accept:* dark login/setup
  readable.
- **T6 P1 CodeMirror find panel themed** (`.cm-panels`, `.cm-search`): tokens, one row
  on desktop, 40 px controls on touch. *Accept:* dark find panel uses app colours.
- **T7 P1 Markdown tables** `overflow-x: auto` in the body and in rendered widgets.
  *Accept:* guide tables show their last column.
- **T8 P1 Notice styles.** `.sb-notification` variants info/success/error with an
  optional action button and an Undo button; never overlapping the first line of the
  page (toast is positioned at the bottom). *Accept:* a toast with a button renders.
- **T9 P2 Reduced motion** global clamp for transitions/animations.
- **T10 P2 Skeleton style** `.sb-skeleton` for home sections (used by Lua widgets).

### navigator (client/navigator/**, _navigator.scss, _dock_menu.scss)
- **N1 P0 Tree row actions on demand.** Actions render on hover/`:focus-within`
  (pointer) or as one 44 px `⋯` (coarse) opening an anchored popover: Rename · Move
  to… · Pin/Unpin · New page here (folders) · Move to trash (last, red). The name keeps
  layout priority; tooltip = full name. *Accept:* active row "Spring Launch" fully
  readable at 260 px; phone shows one control per row.
- **N2 P0 Move to trash, not delete.** The tree's action renames to `Trash/<name>`
  with `trashedFrom`/`trashedAt` (same as the row menu), dialog per rule 4.6 (Cancel
  focused, red verb), toast "Moved to trash · Undo" 8 s. `Trash: Restore` and
  `Trash: Empty` commands (restore = today's `Database: Restore From Trash`; empty asks
  and deletes pages under `Trash/`). *Accept:* a trashed page reappears after Undo and
  after Restore; no one-click permanent delete outside Trash.
- **N3 P1 Palette ordering.** Empty query shows Recent (5) → Suggested (Quick Note,
  Journal: Today, Search: Notes, Ask: Notes, Page: New, Navigate: Tree) → all by
  prefix; hidden-until-typed list from §3. *Accept:* `Client: Wipe` absent with an
  empty query, present when typing "wipe".
- **N4 P1 Page picker.** Pages tab hides `Library/`, `Templates/`, `Trash/`, `CONFIG`;
  placeholder "Open…" fits the dock; create hint only without an exact match; create
  goes to the selected tree folder (else the current page's folder) and the tree shows
  it immediately; the new page opens with the caret on line 1. *Accept:* with Projects
  selected, `Ctrl-k`, "Foo", Shift-Enter makes `Projects/Foo` and it is in the tree.
- **N5 P1 Unified New.** Tree header `+` and command `New` (`Ctrl-Alt-n`) open the
  same menu: Page here · Row in <database>… · Quick note · Journal: Today. *Accept:*
  both paths list the same items in the same order; "Row in Projects" opens the
  database's title prompt.
- **N6 P1 Phone drawer header** shows Search · + New · Journal as 44 px buttons under
  `(pointer:coarse)`; dock segments ≥ 44 px tall; tree rows 44 px. *Accept:* three
  one-tap entry points on the phone.
- **N7 P1 Focus and contrast.** `.sb-nav-row:focus-visible` 2 px accent ring;
  placeholder ≥ 4.5:1 light and dark. *Accept:* visible ring in both schemes.
- **N8 P2 Shortcut hints** in dock button tooltips ("Tree · Ctrl-o"); "Nothing to
  undo" and "Moved to X" notices follow rule 4.4.
- **N9 P2 Quick note in the tree:** Inbox children newest first; a page whose name is
  a time under a date folder is labelled "11:17" (display only).

### dbview (plugs/db-view/ui/**, DB View.md docs)
- **D1 P0 Header layout.** `Title · count` | `Table | Board | Calendar` | `Filter…` |
  `+ New` | `⋯` (Save view · Reload). No copy button. Right padding reserves the host
  bar until T1 lands. *Accept:* every header control clickable on desktop and phone.
- **D2 P0 New row input.** Focuses on mount; renders as the first row/card (not over
  the column header); Enter creates and opens, Shift-Enter creates and stays, Esc
  cancels; errors inline ("A page named *X* already exists"). *Accept:* typing after
  "+ New" goes into the input; "active 3" and the input do not overlap.
- **D3 P0 Height follows content.** ResizeObserver → height message on every render;
  row menu is an anchored popover (Esc, click-away, first item focused) so rows do not
  inflate. *Accept:* last table row visible with the New row open; a created card is
  not clipped; row height unchanged with the menu open.
- **D4 P0 English labels.** Table / Board / Calendar / Filter… / Name / Done / Due /
  Page / Status / Modified / Created / Save view / Reload / Row actions (`⋯`) / Rename
  / Duplicate / Archive / Unarchive / Move to trash / Close / None / No date / "October
  2026" / "Showing the first N rows" / "Nothing matches". *Accept:* no Japanese glyph in
  `plugs/db-view/ui/**`; DB View.md updated.
- **D5 P0 Board defaults.** Tasks source groups by `page` by default (column title =
  page name); columns with 0 rows are dropped when a None column holds everything;
  min column width 220 px, titles wrap, visible horizontal scrollbar. *Accept:*
  Tasks board shows one column per page, no empty active/someday/done columns.
- **D6 P1 Touch and hover editing.** Pencil on hover for `.db-editable`; single tap
  enters edit under `(pointer:coarse)`; checkbox gets a 44 px label hit area;
  `aria-label`s on checkboxes, filter input ("Filter rows") and menu buttons; inputs
  16 px on touch. *Accept:* Playwright touch single-tap edits a due cell.
- **D7 P1 Tick with undo.** Row stays struck through; toast "Done · Undo" 8 s; the
  count updates; Undo restores the line. *Accept:* undo within 8 s re-opens the task.
- **D8 P1 Status colours.** Per-scheme `--db-overdue/--db-today/--db-danger/--db-ok`
  tokens, `--db-on-accent` text; done rows show grey dates; overdue shows the word
  "overdue"; shared 2 px `:focus-visible` ring on tabs, buttons, headers. *Accept:*
  dark overdue ≥ 4.5:1; active tab text ≥ 4.5:1; Autumn Market Stall's date not red.
- **D9 P1 Narrow layout.** Under 480 px the table renders as cards (Name, then
  "Status active · Due 2026-10-14 · Area Store"); above it, the Name column is sticky
  with an edge fade. *Accept:* no horizontal scroll on the phone's Tasks table.
- **D10 P2 Empty states** from §5 inside the view (no rows; filter hides all; all done).
- **D11 P2 Calendar** month title "October 2026", `‹ › Today`, "No date" tray label.

### graph (plugs/object-graph/ui/**, src only for UI state)
- **G1 P0 Phone layout.** Header wraps; Close is a 44 px button pinned top-right;
  under 640 px the sidebar is a bottom sheet (collapsed by default, handle "Filters");
  Expand all / Focus live in the sheet. *Accept:* on iPhone 13 the Close button is
  on-screen and the canvas is ≥ 70 % of the width.
- **G2 P0 Untagged nodes visible.** Resolve `--gv-untagged` through `getComputedStyle`
  like the other tokens; add a 1 px stroke on every node. *Accept:* index/Tasks nodes
  grey in both schemes.
- **G3 P0 Neighbours by default.** Default similarity 0.80 (or top-k 3 without a
  threshold) with a "more / fewer" pair instead of a raw slider; "N pages hidden
  (no connections) · Show" line; pan pad bottom-left, zoom bottom-right, neither over
  the selected node. *Accept:* opening the graph on Spring Launch shows ≥ 5 edges.
- **G4 P1 Legend and colours.** Edge legend (link solid, mention dotted, similar
  dashed) in the sidebar; distinct hues for project vs area; labels ≥ 4.5:1, edges ≥
  3:1, dimmed nodes keep a readable label. *Accept:* contrast measurements pass.
- **G5 P1 Node list.** A `role=listbox` of visible nodes (name, kind) under the canvas
  on the phone and beside it on desktop; arrows move, Enter opens, selection synced
  with the canvas. *Accept:* graph navigable with the keyboard only.
- **G6 P1 Inputs.** 16 px on touch; `aria-label` on the filter input and hops select;
  controls 44 px on touch; reduced motion jumps to the settled layout.
- **G7 P2 Words.** Title "Graph"; "Similar pages" instead of "Semantic edges"; off-state
  line "Similar pages need Search by meaning" when the sidecar is absent.

### lua (Memo Search.md, Memo Ask.md, Page Header.md, Fork Guide.md, *_lua.test.ts, block_editor/**)
- **L1 P0 Keys that do not collide.** Search `Ctrl-q s`, Ask `Ctrl-q a`, Related
  `Ctrl-q r`; `Ctrl-Shift-f` is not bound by Lua until §10.1. Guide and docs updated.
  *Accept:* `Ctrl-q s` opens the Search modal on the demo at any time after load;
  nothing in the app advertises `Ctrl-Shift-f`.
- **L2 P0 Command names.** `Search: Notes`, `Search: Related Notes`, `Ask: Notes`,
  `Ask: Follow-up`, `Ask: New Conversation`, `Ask: Save Answer`, `Ask: History`,
  `Ask: Set up`; panel titles "Search", "Related notes", "Ask"; `FORK_COMMANDS`
  updated. *Accept:* no `Memo:` in the palette or the guide.
- **L3 P0 Off-states as content, not banners.** Ask without a key opens the Ask panel
  with the §5 text and a **Set up Ask** command button; Search/Related without a
  sidecar show the §5 rows (with "Open a page named … instead"); no
  `flashNotification` error for configuration. *Accept:* nothing overlaps page text.
- **L4 P0 Search results.** Snippet from the body (frontmatter and path stripped,
  matched sentence first); a count row "12 sections"; the modal scrolls with a visible
  bar and a last-row cue; "Details" segment removed (scores in the tooltip, badge only
  with `memoSidecar.debug`). *Accept:* "launch" shows body text in the top hits.
- **L5 P1 Earlier registration.** Raise the load priority of the Search/Ask blocks so
  the commands exist within ~1.5 s of editor-ready on the demo; until registered the
  palette must not show stale text. *Accept:* measured.
- **L6 P1 Related chips in words.** "Similar", "Linked", "Similar · Linked"; score in
  the tooltip; panel title "Related notes · N". *Accept:* no decimals on screen.
- **L7 P1 Notice voice.** Every `flashNotification` in Memo Ask/Search follows rule
  4.4 (two sentences, no command prefix, no em-dash chains). *Accept:* grep.
- **L8 P1 Guide.** Fork Guide rewritten to the vocabulary in §1 (Japanese), the new
  keys, New, Trash, the phone section; opens with frontmatter folded (read-only
  presentation where the Read Only Mode library allows). *Accept:* guide matches the
  chrome word for word in its glossary table.
- **L9 P2 Quick note placeholder.** `block_editor` adds a CodeMirror placeholder on an
  empty page under the Inbox prefix: "Write it down. It is saved as you type. Esc goes
  back." *Accept:* visible on `Ctrl-q q`.
- **L10 P2 Page Header breadcrumb.** When a page sits in a folder, the header widget
  shows a dim "Projects ›" line above the cover/icon so the H1 can be the title.
  (Replaces the duplicated full path once §10.6 lands.)

---

## 10. Owner items (outside every stream) and open questions

Defaults are chosen; nothing blocks on them.

1. **`Ctrl-Shift-f` precedence.** The editor's search keymap wins over command keys
   (`client/codemirror/editor_state.ts`). Default: Lua binds `Ctrl-q s`; if the owner
   wraps the command keymap in `Prec.high` (one line), `Ctrl-Shift-f` becomes the
   second binding and the primary one in the guide.
2. **Esc-then-Tab escape hatch** (`editor_state.ts`): Esc with no panel open sets a
   flag so the next Tab leaves `.cm-content`. Default: yes.
3. **Top bar** (`client/components/top_bar.tsx` or equivalent): title = last segment
   with dim breadcrumb; `aria-label="Page name"`; phone: Search · + New · ⋯; default
   `actionButtons` in `Library/Std/Config.md` become Home · Open · Search · Commands ·
   Help. Default: do it; T2 covers the CSS meanwhile.
4. **Space template and demo content** (`bin/silverbullet/space_template/index.md`,
   `examples/demo-space/*`): home per §3 with the capture row and empty states;
   `Tasks.md` loses the "double-click" prose; `Templates/Project.md` uses `${title}`.
5. **db-view core** (`plugs/db-view/src`): `name` as an alias of `title` with an error
   instead of "nil"; `tasks` source excludes `Templates/`, `Library/`, `Trash/`;
   validation messages in English; `(なし)` → `None`.
6. **Task references** in `templates.taskItem` / `fullPageItem`: page name, no `@pos`.
7. **README** mirrors the renamed commands and keys (L2, L1).
8. **Quick note path.** Keep `Inbox/<date>/<time>` (MCP `add_inbox` parity) and fix
   presentation (N9, L9); alternative flat `Inbox/<date> <time>` would need memo-mcp
   changes. Default: keep.
9. **Viewport** `user-scalable=no` in `client/html/index.html`: drop `maximum-scale`.
   Default: drop.
10. **Trash across the space**: the tree action becomes "Move to trash" (N2). Upstream
    `Page: Delete` stays as the permanent delete, hidden until typed. Default: yes.
11. **Fonts**: proportional prose by default (T3), with `editorFont = "mono"` config
    for the current look. Default: proportional.
12. **Language**: English chrome, no i18n framework now; a `uiLanguage` setting is a
    later step. Default: English.
13. **`Database: Define in CONFIG`** → `Database: New Database` (asks name, folder,
    first property) and `Database: Insert View` → `Database: Insert View` unchanged.
    Lives in DB View.md's Lua, which the dbview stream owns as docs only. Default:
    rename when D4 lands.
