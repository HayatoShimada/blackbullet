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
- Search, related notes and the graph's "similar" links are served by the `memo-mcp` sidecar that `setup.sh` starts and wires up for you (it writes the connection into your space's `CONFIG` page). The first search downloads a ~120 MB embedding model once and runs it on the CPU. Set `MEMO_EMBED=off` in `.env` for word-based search only, with no download.
- `./setup.sh --stop` stops everything; `./setup.sh --rebuild` rebuilds after a `git pull`. All settings are in `.env` (`.env.example` explains each one).

### Use it from an AI assistant

`setup.sh` prints a ready-made command. In short, the sidecar speaks [MCP](https://modelcontextprotocol.io) at `http://127.0.0.1:3010/mcp`, protected by the bearer token in `.env` (`MEMO_MCP_TOKEN`):

```bash
claude mcp add --transport http memo http://127.0.0.1:3010/mcp \
  --header "Authorization: Bearer <MEMO_MCP_TOKEN>"
```

Any MCP client works the same way (Claude Desktop, Cursor, …; JSON examples in [`packages/memo-mcp/README.md`](packages/memo-mcp/README.md)). Tools include `search_notes`, `read_note`, `related_notes`, `list_tasks`, `list_journal`, `append_journal` and `add_inbox`. The sidecar listens on localhost only; to reach it from another device, put it behind a VPN or the tailnet front door below.

### Ask your notes

`Memo: Ask` answers a question from your notes with citations: the sidecar picks the matching sections, the Anthropic API writes the answer, and each `[n]` links back to the section. It needs an API key in the space's `CONFIG` page, `config.set("memoAsk", {apiKey = "sk-ant-…"})` (optionally `model`, default `claude-opus-5-5`). Only the sections that match that one question are sent, only when you run the command, and not from a space marked `:confidential` in `MEMO_SPACES` unless you set `memoAsk.allowConfidential = true`. The browser sends the key to your SilverBullet server, which forwards it; it never goes to the sidecar and is never indexed. Details in `libraries/Library/Std/Editor/Memo Ask.md`.

### Reach it from your other devices (optional)

`./setup.sh --tailnet` adds a tailnet-only HTTPS front door: a real domain and certificate, but only people on your [Tailscale](https://tailscale.com) network *and* on your allowlist can open it, and the app itself needs no login screen. Fill in the `TS_AUTHKEY` … `SITE_DOMAIN` keys in `.env` first; the Tailscale ACL, Cloudflare token and DNS steps are in [`deploy/tailnet-proxy/README.md`](deploy/tailnet-proxy/README.md).

## What's inside

| Part | Where |
| --- | --- |
| Page tree with drag-and-drop move, *Move to…*, undo, pinning | `client/navigator/ui/mediator/`, [`dev-docs/phase2-sidebar-design.md`](dev-docs/phase2-sidebar-design.md) |
| Page header: cover + large icon | `libraries/Library/Std/Editor/Page Header.md` |
| Block editor: drag handles, fold toggles, reorder blocks | `client/codemirror/block_editor/`, [`dev-docs/phase3-block-editor-design.md`](dev-docs/phase3-block-editor-design.md) |
| Database views from a ```` ```db ```` block: table / board / calendar, with in-place edits | `plugs/db-view/`, [`dev-docs/phase4-db-views-design.md`](dev-docs/phase4-db-views-design.md) |
| Search and related notes; a graph with semantic edges, filters and hops | `libraries/Library/Std/Editor/Memo Search.md`, `plugs/object-graph/` |
| Ask your notes: answers with citations through the Anthropic API | `libraries/Library/Std/Editor/Memo Ask.md` |
| In-app guide (the **?** button; Japanese) | `libraries/Library/Std/Docs/Fork Guide.md` |
| MCP server + REST sidecar: hybrid search (FTS5 trigram + local embeddings, RRF), related notes, graph | [`packages/memo-mcp/`](packages/memo-mcp/) |
| Tailnet-only HTTPS front door (Tailscale login, no password screen) | [`deploy/tailnet-proxy/`](deploy/tailnet-proxy/) |

Commands added by BlackBullet (open the command palette with `Ctrl-/` or `Cmd-/`): `Navigate: Tree`, `Tree: Undo Move`, `Page: Set Icon`, `Page: Set Cover`, `Page: Remove Cover`, `Memo: Search` (`Ctrl-Shift-f` / `Cmd-Shift-f`), `Memo: Related Notes`, `Memo: Ask`, `Help: Fork Guide`. Everything from SilverBullet (quick notes `Ctrl-q q`, journal `Ctrl-q j`, templates, Space Lua, …) is still there.

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
