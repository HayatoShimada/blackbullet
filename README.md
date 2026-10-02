# BlackBullet

A personal, local-first, AI-native notes app: Markdown on disk is the only source of truth, with a Notion-like editor, search, a graph, database views, and a tailnet-only way to publish it.

BlackBullet is a fork of [SilverBullet](https://github.com/silverbulletmd/silverbullet) (v2.11 line; Rust server + TypeScript / CodeMirror 6 client). It is **not affiliated with** the SilverBullet project. It keeps SilverBullet's internal names (crates, `SB_*` environment variables, plug API) so that SilverBullet plugs and libraries keep working and upstream changes stay mergeable. The upstream README is in [`docs/UPSTREAM-README.md`](docs/UPSTREAM-README.md) and its manual is in `docs/`.

## What BlackBullet adds
| Part | Where |
| --- | --- |
| Page tree with drag-and-drop move, *Move to…*, undo, pinning (state-machine Mediator) | `client/navigator/ui/mediator/`, [`dev-docs/phase2-sidebar-design.md`](dev-docs/phase2-sidebar-design.md) |
| Page header: cover + large icon | `libraries/Library/Std/Editor/Page Header.md` |
| Block editor: drag handles, fold toggles, reorder blocks | `client/codemirror/block_editor/`, [`dev-docs/phase3-block-editor-design.md`](dev-docs/phase3-block-editor-design.md) |
| Database views from a ```` ```db ```` block: table / board / calendar, with in-place edits | `plugs/db-view/`, [`dev-docs/phase4-db-views-design.md`](dev-docs/phase4-db-views-design.md) |
| Search and related notes; a graph with semantic edges, filters and hops | `libraries/Library/Std/Editor/Memo Search.md`, `plugs/object-graph/` |
| In-app help (`Help: Fork Guide`) | `libraries/Library/Std/Docs/Fork Guide.md` |
| A tailnet-only HTTPS front door (Tailscale login, no password screen) | [`deploy/tailnet-proxy/`](deploy/tailnet-proxy/) |

Search and the graph's semantic edges talk to an external "sidecar" over REST (`/api/search|related|graph`, configured with `config.set("memoSidecar", {...})`). **The sidecar is not part of this repository**, so without it those two features stay empty; the editor, tree, block editor and database views work on their own.

## Build and run
Follow upstream's instructions for the server and client (see `docs/Install/` and `CONTRIBUTING.md`):
```bash
npm run build:client                                  # client bundle
SB_DISABLE_SERVICE_WORKER=1 cargo run -p silverbullet -- <space-dir>
npm test                                              # vitest
```
`scripts/fork-dev.sh` is a Docker-based build/run loop for machines without a Rust toolchain.

## License
- Code from SilverBullet is under the **MIT license** (Copyright 2022, Zef Hemel): see [`LICENSE.md`](LICENSE.md). Unmodified upstream files stay MIT.
- Additions and modifications by HayatoShimada are **GPL-2.0-only**: see [`LICENSE-GPL-2.0`](LICENSE-GPL-2.0) and [`NOTICE.md`](NOTICE.md).
- As a whole, the combined work is distributed under the terms of the GPL-2.0, which MIT-licensed code is compatible with. Keep both notices when you redistribute.

Copyright (C) 2026 HayatoShimada (additions and modifications).
