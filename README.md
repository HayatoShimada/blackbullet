# BlackBullet

A personal, local-first, AI-native notes app. Your notes are plain Markdown files in a folder you own; on top of them you get a Notion-like editor (page tree, blocks, database views), search that understands meaning as well as words, a graph of related notes, and an MCP server so AI assistants can read and write the same notes. Everything runs on your machine; no note text leaves it unless you decide so.

BlackBullet is a fork of [SilverBullet](https://github.com/silverbulletmd/silverbullet) (v2.11 line; Rust server + TypeScript / CodeMirror 6 client). It is **not affiliated with** the SilverBullet project. It keeps SilverBullet's internal names (crates, `SB_*` environment variables, plug API) so that SilverBullet plugs and libraries keep working and upstream changes stay mergeable. The upstream README is in [`docs/UPSTREAM-README.md`](docs/UPSTREAM-README.md) and its manual is in `docs/`.

## Quick start

You need Docker (with Compose v2). Nothing else is installed on your machine.

```bash
git clone https://github.com/HayatoShimada/blackbullet.git
cd blackbullet
./setup.sh
```

The first run builds the images (10–20 minutes; afterwards `./setup.sh` just starts things). When it finishes, open **http://127.0.0.1:3000**.

- Your notes live in `./space` (plain Markdown). To use an existing folder, set `SPACE_DIR=/path/to/notes` in `.env` before running `setup.sh`.
- Search, related notes and the graph's "similar" links are served by the `memo-mcp` sidecar that `setup.sh` starts and wires up for you (it writes the connection into your space's `CONFIG` page). `setup.sh` starts indexing in the background, which downloads a ~120 MB embedding model once and runs it on the CPU (progress: `./setup.sh --status`). Set `MEMO_EMBED=off` in `.env` for word-based search only, with no download.
- `./setup.sh --stop` stops everything; `./setup.sh --rebuild` rebuilds after a `git pull`. All settings are in `.env` (`.env.example` explains each one).

### Look after it

| Command | What it does |
| --- | --- |
| `./setup.sh --status` | Shows the containers, the app, the sidecar's health, whether the token works (a lexical search probe), the page count, whether the embedding model is present, and disk use. Exits 1 if the app or sidecar is down. |
| `./setup.sh --backup [dir] [--with-secrets]` | Writes `<dir>/blackbullet-notes-<timestamp>.tar.gz` (default `./backups`, mode 0600). `CONFIG.md` is included with its token/key/secret/password values blanked; `--with-secrets` stores it as is, plus `.silverbullet.auth.json` and `.env`. The search index is not backed up (it is rebuilt). The tailnet `ts-state` and `caddy-data` volumes are not backed up either. |
| `./setup.sh --restore <file>` | Checks the archive (no absolute or `..` paths or links), saves the current notes as `<space>.pre-restore-<timestamp>.tar.gz`, then merges the archive over the notes folder; nothing is deleted. An existing `CONFIG.md` is kept. An archived `.env` is written to `.env.from-backup` for you to merge by hand. |
| `./setup.sh --upgrade` | `git pull --ff-only`, shows the old to new commit, then rebuilds and restarts like `--rebuild`; when there is nothing new it only starts the containers. |

Starting runs (`./setup.sh`, `--tailnet`, `--rebuild`, `--upgrade`) also keep the `memoSidecar` block in `CONFIG.md` in step with `.env` (port, token, space name), unless its url points at another host. Indexing runs in the background; `--status` shows how it is going. The backup and status code is tested with `bash scripts/ops.test.sh`.

### Use it from an AI assistant

`setup.sh` prints a ready-made command. In short, the sidecar speaks [MCP](https://modelcontextprotocol.io) at `http://127.0.0.1:3010/mcp`, protected by the bearer token in `.env` (`MEMO_MCP_TOKEN`):

```bash
claude mcp add --transport http memo http://127.0.0.1:3010/mcp \
  --header "Authorization: Bearer <MEMO_MCP_TOKEN>"
```

Any MCP client works the same way (Claude Desktop, Cursor, …; JSON examples in [`packages/memo-mcp/README.md`](packages/memo-mcp/README.md)). Tools include `search_notes`, `read_note`, `related_notes`, `list_tasks`, `list_journal`, `append_journal` and `add_inbox`. Further tools: `read_section`, `recent_changes`, `list_projects`, `list_spaces`, `complete_task`, `doc_status` (per-document extraction status) and `reindex_docs`. `add_inbox` creates a page `Inbox/<date>/<time>` (or appends to `Inbox.md` with `mode: "append"`); set `MEMO_TZ` on the sidecar for the time zone (add `MEMO_TZ=${MEMO_TZ:-}` to the memo-mcp environment in `compose.yaml`; it stays UTC otherwise). Writes to a page are serialised per file.

The sidecar listens on localhost only. With `./setup.sh --tailnet`, the same front door also serves it, so a remote machine on your tailnet can run:

```bash
claude mcp add --transport http memo https://<SITE_DOMAIN>/mcp \
  --header "Authorization: Bearer <MEMO_MCP_TOKEN>"
```

Caddy sends `/mcp` and `/api/*` to the sidecar after the Tailscale login check, and the sidecar still requires its bearer token. Hosted connectors (such as claude.ai) cannot reach a tailnet-only name. A page named `mcp`, or any page under `api/`, is not reachable through the front door. Details in [`deploy/tailnet-proxy/README.md`](deploy/tailnet-proxy/README.md).

### Document search

Besides Markdown, the sidecar indexes PDF, docx, xlsx, pptx, OpenDocument (odt/ods/odp), HTML and plain text/csv files in the notes folder. Hits show where they are (`[PDF p.3]`, `[PPTX slide.2]`); spreadsheets are indexed row by row with their header, pptx speaker notes and docx headings/footnotes/comments are included, and extraction results are cached across restarts. Scanned PDFs and images can be read by OCR, which is opt-in: add `MEMO_OCR: "on"` to the memo-mcp service environment and `build: {args: {WITH_OCR: "1"}}` in `compose.yaml`. Legacy `.doc` / `.xls` / `.ppt` are reported as unsupported. The `doc_status` tool lists what could not be read and why; `reindex_docs` re-extracts. Narrow a search with `kind:pdf` (or `kind:doc`) and `in:Folder/` at the start of the query. Settings are in [`packages/memo-mcp/README.md`](packages/memo-mcp/README.md).

### Ask your notes

`Ask: Notes` answers a question from your notes with citations: the sidecar picks the matching sections, the Anthropic API writes the answer, and each `[n]` links back to the section. It needs an API key in the space's `CONFIG` page, `config.set("memoAsk", {apiKey = "sk-ant-…"})` (optionally `model`, default `claude-opus-5-5`). Only the sections that match that one question are sent, only when you run the command, and not from a space marked `:confidential` in `MEMO_SPACES` unless you set `memoAsk.allowConfidential = true`. With the bundled `compose.yaml` the space is not confidential; to mark it, change `MEMO_SPACES` there to `${MEMO_SPACE_NAME:-notes}=/data:confidential`. The browser sends the key to your SilverBullet server, which forwards it; it never goes to the sidecar and is never indexed. Run `Ask: Set up` to enter the key and model once (it writes a block into `CONFIG`).

You can narrow a question with leading words: `#tag`, `folder:Dir/` (or `in:Dir/`), `kind:pdf`, `area:`, `status:`, `since:2026-01-01`; `memoAsk.defaultScope` sets them for every question. `Ask: Follow-up` continues the conversation. Each follow-up makes two API calls: a short one that rewrites it into a search query (it sends the last question and the start of the last answer), then the answer call (earlier questions and answers without their notes, plus the sections that match the new question), `Ask: New Conversation` starts over. `Ask: Save Answer` writes the answer to a page `Ask/<date> <question>` with its sources, and `Ask: History` reopens recent answers of the session. The answer lists the sources cited and those sent but not cited, and a size estimate; a prompt above `memoAsk.maxInputTokens` (default 50000) is refused. `memoAsk.instructions` adds your own guidance. Details in `libraries/Library/Std/Editor/Memo Ask.md`.

### Databases

A ```` ```db ```` block shows pages or tasks as a table, board or calendar and edits them in place. Beyond the basics:

- Define a database in `CONFIG` with `database.define` (column types, defaults, folder, template); the view then has **+ New**, which expands the template (`${title}`, `${page}`, `${database}`). Board columns and calendar days have a `+` that creates a row with that column's value or date.
- Filters go beyond equality: `where: {due: {before: today}, status: [{not: done}]}` (`not lt lte gt gte before after contains empty`). The header's **Save view** button (under **⋯**) writes the current tab, sort and filter back into the block.
- Each page row has a `...` menu: rename (backlinks are updated), duplicate, archive/restore, and move to trash. Trash moves the page to `Trash/<name>` with `trashedFrom` and `trashedAt` in its frontmatter, and `Trash: Restore` brings it back. `created` and `modified` work as read-only columns and sort keys.
- Writes are checked against the declared types and options. Dragging works with touch (press and hold), and the layout adapts to phones.
- Commands: `Database: Insert View` (also `/database`), `Database: New Row`, `Database: Define in CONFIG`.

See `libraries/Library/Std/Editor/DB View.md` and `libraries/Library/Std/APIs/Database.md`.

### Reach it from your other devices (optional)

`./setup.sh --tailnet` adds a tailnet-only HTTPS front door: a real domain and certificate, but only people on your [Tailscale](https://tailscale.com) network *and* on your allowlist can open it, and the app itself needs no login screen. Fill in the `TS_AUTHKEY` … `SITE_DOMAIN` keys in `.env` first; the Tailscale ACL, Cloudflare token and DNS steps are in [`deploy/tailnet-proxy/README.md`](deploy/tailnet-proxy/README.md).

## What's inside

| Part | Where |
| --- | --- |
| Page tree with drag-and-drop move, *Move to…*, undo, pinning | `client/navigator/ui/mediator/`, [`dev-docs/phase2-sidebar-design.md`](dev-docs/phase2-sidebar-design.md) |
| Page header: cover + large icon | `libraries/Library/Std/Editor/Page Header.md` |
| Block editor: drag handles, fold toggles, reorder blocks | `client/codemirror/block_editor/`, [`dev-docs/phase3-block-editor-design.md`](dev-docs/phase3-block-editor-design.md) |
| Database views from a ```` ```db ```` block: table / board / calendar, with in-place edits | `plugs/db-view/`, [`dev-docs/phase4-db-views-design.md`](dev-docs/phase4-db-views-design.md) |
| Search and related notes; a graph with similar-page edges, filters and hops | `libraries/Library/Std/Editor/Memo Search.md`, `plugs/object-graph/` |
| Ask your notes: answers with citations, follow-ups, scope, saved answers | `libraries/Library/Std/Editor/Memo Ask.md` |
| In-app guide (the **?** button; Japanese) | `libraries/Library/Std/Docs/Fork Guide.md` |
| MCP server + REST sidecar: hybrid search (FTS5 trigram + local embeddings, RRF), related notes, graph, PDF/Office document search | [`packages/memo-mcp/`](packages/memo-mcp/) |
| Tailnet-only HTTPS front door (Tailscale login, no password screen; also `/mcp`) | [`deploy/tailnet-proxy/`](deploy/tailnet-proxy/) |
| Backup, restore, status, upgrade | `setup.sh`, `scripts/ops.sh` |

Commands added by BlackBullet (open the command palette with `Ctrl-/` or `Cmd-/`): `Navigate: Tree`, `Tree: Undo Move`, `New` (`Ctrl-Alt-n` / `Cmd-Alt-n`: a page here, a row in a database, a quick note or today's journal), `Trash: Restore`, `Trash: Empty`, `Page: Set Icon`, `Page: Set Cover`, `Page: Remove Cover`, `Search: Notes` (`Ctrl-q s`; the command palette always shows the current shortcut), `Search: Related Notes` (`Ctrl-q r`), `Graph: Explore` (`Ctrl-Shift-g`), `Graph: Global Page Map`, `Ask: Notes` (`Ctrl-q a`), `Ask: Follow-up`, `Ask: New Conversation`, `Ask: Save Answer`, `Ask: History`, `Ask: Set up`, `Database: Insert View`, `Database: New Row`, `Database: Define in CONFIG`, `Help: Fork Guide`. Everything from SilverBullet (quick notes `Ctrl-q q`, journal `Ctrl-q j`, templates, Space Lua, …) is still there. Pressing `Esc` and then `Tab` leaves the editor, so the keyboard reaches the header and the panels.

The app talks to the sidecar over its own `/.proxy/` route, configured in the space's `CONFIG` page with `config.set("memoSidecar", {url=…, token=…, space=…})` (`setup.sh` writes this). Without the sidecar, search and the semantic graph stay empty; the editor, tree, block editor and database views work on their own.

## Develop

Without a local Rust toolchain or Node 24, use Docker (`docker compose build` for the release images, `scripts/fork-dev.sh` for a fast client-bundle loop). With them:

```bash
npm run build:client                                  # client bundle
SB_DISABLE_SERVICE_WORKER=1 cargo run -p silverbullet -- <space-dir>
npm test                                              # vitest
cd packages/memo-mcp && npm test                      # sidecar tests
```

See `CONTRIBUTING.md`, `STYLE.md` and `docs/Development.md`.

## License
- Code from SilverBullet is under the **MIT license** (Copyright 2022, Zef Hemel): see [`LICENSE.md`](LICENSE.md). Unmodified upstream files stay MIT.
- Additions and modifications by HayatoShimada are **GPL-2.0-only**: see [`LICENSE-GPL-2.0`](LICENSE-GPL-2.0) and [`NOTICE.md`](NOTICE.md).
- As a whole, the combined work is distributed under the terms of the GPL-2.0, which MIT-licensed code is compatible with. Keep both notices when you redistribute.

Copyright (C) 2026 HayatoShimada (additions and modifications).
