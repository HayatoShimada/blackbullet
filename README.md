# BlackBullet

A personal, local-first, AI-native notes app. Your notes stay plain Markdown files in a folder you own. On top of them you get a Notion-like editor, search that understands meaning as well as words, a graph of related notes, database views, and an MCP server so AI assistants can read and write the same notes. Everything runs on your own machine; note text leaves it only when you ask a question with **Ask**.

BlackBullet is a fork of [SilverBullet](https://github.com/silverbulletmd/silverbullet) (v2.11 line; Rust server, TypeScript / CodeMirror 6 client) and is not affiliated with that project. It keeps SilverBullet's internal names (crates, `SB_*` environment variables, plug API), so SilverBullet plugs and libraries keep working. Upstream's manual is in [`docs/`](docs/).

## Features

- **Write**: block editor with drag handles and folding, page tree with drag-and-drop, page cover and icon, quick notes (`Ctrl-q q`) and a daily journal (`Ctrl-q j`); a mode chip in the header shows Edit or Preview (`Ctrl-Alt-p`, `Editor: Toggle Preview`), and with vim keys NORMAL / INSERT / VISUAL, where `Esc` steps Insert → Normal → Preview.
- **Find**: one search over every section by words and meaning (`Ctrl-q s`), related notes for the page you are on (`Ctrl-q r`), and a graph of links and similar pages (`Ctrl-Shift-g`).
- **Organise**: databases declared once (typed properties, folder, template) and shown as table, board or calendar views you edit in place; one **New** for pages, rows, quick notes and journal entries (`Ctrl-Alt-n`); a trash you can restore from.
- **Ask**: answers from your own notes with citations, follow-up questions, and answers saved as pages (`Ctrl-q a`, needs an Anthropic API key).
- **Documents**: PDF, Word, Excel, PowerPoint, OpenDocument and HTML files in the folder are searchable too, with optional OCR.
- **AI assistants**: an MCP server over the same notes for Claude Code, Claude Desktop and other MCP clients.
- **Phone and other devices**: works at phone width, and an optional tailnet-only HTTPS front door (Tailscale) with no password screen.

## Quick start

You need Docker with Compose v2.

```bash
git clone https://github.com/HayatoShimada/blackbullet.git
cd blackbullet
./setup.sh
```

The first run builds the images (10 to 20 minutes); later runs just start them. Then open **http://127.0.0.1:3000**.

- Your notes live in `./space`. To use an existing folder of Markdown files, set `SPACE_DIR=/path/to/notes` in `.env` before running `setup.sh`.
- `setup.sh` also starts the search sidecar and connects it. The first indexing downloads a ~120 MB embedding model once and runs it on the CPU. `MEMO_EMBED=off` in `.env` keeps search word-based with no download.
- All settings are in `.env`; [`.env.example`](.env.example) explains each one.

| Command | What it does |
| --- | --- |
| `./setup.sh --status` | Health of the app and the sidecar, index and model state, disk use |
| `./setup.sh --backup [dir] [--with-secrets]` | A timestamped `.tar.gz` of the notes (secrets blanked unless `--with-secrets`) |
| `./setup.sh --restore <file>` | Merges a backup into the notes folder after saving a safety copy |
| `./setup.sh --upgrade` | `git pull`, rebuild and restart |
| `./setup.sh --stop` | Stops everything; the notes stay where they are |

## Use it from an AI assistant

The sidecar speaks [MCP](https://modelcontextprotocol.io) at `http://127.0.0.1:3010/mcp`, protected by `MEMO_MCP_TOKEN` from `.env` (`setup.sh` prints this command with the token filled in):

```bash
claude mcp add --scope user --transport http memo http://127.0.0.1:3010/mcp \
  --header "Authorization: Bearer <MEMO_MCP_TOKEN>"
```

Tools include `search_notes`, `read_note`, `read_section`, `related_notes`, `list_tasks`, `list_projects`, `list_journal`, `recent_changes`, `append_journal`, `add_inbox`, `complete_task`, `doc_status` and `reindex_docs`. `CONFIG` (where tokens and keys live) is never readable through MCP. Other clients and the options are described in [`packages/memo-mcp/README.md`](packages/memo-mcp/README.md).

## Ask your notes

`Ask: Notes` sends the sections that match your question to the Anthropic API and shows the answer with `[n]` links back to each section. Run `Ask: Set up` once to store an API key in the space's `CONFIG` page. Nothing is sent unless you run the command, and a space marked `:confidential` is never sent unless you allow it. Scopes (`#tag`, `in:Folder/`, `kind:pdf`, `since:2026-01-01`), follow-ups, saved answers and limits are described in [`Memo Ask.md`](libraries/Library/Std/Editor/Memo%20Ask.md).

## Databases

Declare a database once in `CONFIG`:

```lua
database.define {
  name = "projects",
  folder = "Projects/",
  template = "Templates/Project",
  properties = {
    { key = "status", type = "select", options = {"active", "someday", "done"}, default = "active" },
    { key = "due", type = "date" },
  },
}
```

Then a ```` ```db ```` block with `database: projects` shows it as a table, board or calendar with **+ New**, filters, a row menu (rename, duplicate, archive, move to trash) and **Save view**. `Database: Insert View` (or `/database`) writes the block for you. See [`DB View.md`](libraries/Library/Std/Editor/DB%20View.md) and [`Database.md`](libraries/Library/Std/APIs/Database.md).

## Phone and other devices

The layout adapts to phones: 44 px touch targets, cards instead of wide tables, and a drawer with Search, New and Journal.

`./setup.sh --tailnet` adds a front door reachable only from your [Tailscale](https://tailscale.com) network and only by the logins you allow, with a real domain and certificate and no password screen. The same address serves the MCP endpoint (`https://<SITE_DOMAIN>/mcp`) to other machines on the tailnet. Setup steps are in [`deploy/tailnet-proxy/README.md`](deploy/tailnet-proxy/README.md).

## Help

The **?** button in the header opens the in-app guide (Japanese). The command palette (`Ctrl-/`) lists every command with its shortcut. `Esc` then `Tab` moves the keyboard from the editor to the header.

## Develop

Without a local Rust toolchain or Node 24, use Docker: `docker compose build` for release images, `scripts/fork-dev.sh` for a fast client loop, and `scripts/ui-tour.mjs` for a fixed set of screenshots on the demo space in [`examples/demo-space`](examples/demo-space). With the toolchains installed:

```bash
npm run build:client
SB_DISABLE_SERVICE_WORKER=1 cargo run -p silverbullet -- <space-dir>
npm test
cd packages/memo-mcp && npm test
```

Design references: [`dev-docs/product-design.md`](dev-docs/product-design.md) (what the interface means), [`dev-docs/design-system.md`](dev-docs/design-system.md) (how it looks), and a Japanese summary in [`dev-docs/design.ja.md`](dev-docs/design.ja.md). See also [`CONTRIBUTING.md`](CONTRIBUTING.md) and [`STYLE.md`](STYLE.md).

## License

BlackBullet is licensed under the [GNU General Public License v2.0 only](LICENSE) (GPL-2.0-only).

It is based on SilverBullet, which is MIT-licensed; the MIT license lets that code be redistributed under the GPL as long as its copyright and permission notice stay with it, which [`NOTICE.md`](NOTICE.md) reproduces.

Copyright (C) 2026 HayatoShimada.
