# CLAUDE.md

## UI設計厳守ルール

すべてのコンポーネントを Root からなる階層構造下に置き、各コンポーネントは MVP パターンの Passive View として描画に関わるパラメータだけを操作し、動作は Chain of Responsibility でイベントをバブリングさせて、ステートマシンとして振る舞う Mediator に裁定させること。  
設計しやすさではなく、ユーザビリティを高めること。

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

BlackBullet: a personal, local-first, AI-native notes app. It is a fork of SilverBullet (v2.11 line; Rust server + TypeScript / CodeMirror 6 client), published as a standalone repo. It deliberately keeps SilverBullet's internal names (crates, `SB_*` env vars, plug API, `@silverbulletmd/silverbullet/...` imports) so upstream plugs/libraries work and upstream changes stay mergeable. **Keep changes to upstream code minimal and additive.** Upstream's manual is in `docs/` (see `docs/Architecture*`, `docs/ADR`); `README.md` lists what the fork adds and where.

Three deliverables live here:
- the notes app (root: `client/`, `server*/`, `bin/`, `plugs/`, `libraries/`),
- `packages/memo-mcp/` — MCP server + read-only REST sidecar (separate Node package, own `package.json`, no build step),
- `deploy/tailnet-proxy/` — Tailscale + Caddy + whois-auth front door (standalone kit; the root compose reuses its `Caddyfile` and `auth/` as the `tailnet` profile).

How it ships: `./setup.sh` → `compose.yaml` (`app` from `Dockerfile.fork`, `memo-mcp` from `packages/memo-mcp/Dockerfile`, sharing one network namespace). `setup.sh` owns `.env` (generated keys are only added when missing) and seeds the `memoSidecar` block into the space's `CONFIG.md`. There is no CI; images are built locally by compose.

## Commands

```bash
npm run build            # plugs + client bundle -> client_bundle/ (gitignored)
npm run build:client     # client only (fast); reload the browser, no server restart
npm test                 # vitest run (whole suite)
npx vitest run path/to/file.test.ts          # single test file
npx vitest run -t "name substring"           # single test by name
npm run check            # tsc --noEmit (+ e2e tsconfig)
npm run lint             # biome lint .
make check               # tsc + biome lint + format check + cargo fmt + clippy -D warnings
make fmt                 # biome format --write + cargo fmt
make test                # vitest + cargo test --workspace
make test-e2e            # Playwright (chromium) against a debug build
SB_DISABLE_SERVICE_WORKER=1 cargo run -p silverbullet -- <space-dir>   # dev server

# packages/memo-mcp (run inside that directory)
npm test                 # node --test test/*.mjs (fixture spaces, no network, no model download)
npm run reindex:embed    # rebuild index + embeddings
npm run eval             # recall@k / MRR on test/eval/golden.json
npm run start:http       # needs MEMO_SPACES and MEMO_MCP_TOKEN (see its README)

# deploy/tailnet-proxy/auth
python3 -m unittest
```

A debug server build serves `client_bundle/` from disk (rust-embed), so a client rebuild is enough; release builds embed it, so Rust must be rebuilt. The space template (`bin/silverbullet/space_template/index.md`) and the Std library are embedded too.

### Building without Rust / Node 24 on the host
Use Docker (Node 24 and Rust images); a Raspberry Pi class host takes 10–20 min for the release image.
- `./setup.sh` / `./setup.sh --rebuild` — release images via compose (`docker compose build` for just the images).
- `scripts/fork-dev.sh bundle` — rebuild client/plugs/libraries in a Node 24 container into `client_bundle/`.
- `scripts/fork-dev.sh server` — rebuild the debug image (Rust changes only); `up <space-copy> [port]` / `down` / `logs` run it on a **copy** of a space. It publishes with `-p`, so the container cannot reach a sidecar on the host; for sidecar tests use `./setup.sh` on a scratch copy with free ports and `COMPOSE_PROJECT_NAME=<something>` so it does not collide with a running instance.
- Run vitest / check / lint / memo-mcp tests inside a Node 24 container too (`docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp -v "$PWD":/src -w /src node:24-bookworm sh -c '…'`).

### Data safety
- Never point a test instance at a real notes folder; use copies (exclude `.git`). Don't edit one space from two servers at once.
- `.env`, `.env.*` (except `.env.example`), `.silverbullet.auth.json`, `space/` and `.memo-index/` are gitignored; keep it that way. A space's `CONFIG.md` holds the sidecar token, which is why memo-mcp never indexes it.
- Don't send private-space content to cloud AI; mark such spaces `:confidential` in `MEMO_SPACES`.

## Architecture (big picture)

- **Server** (`server/`, `server-common/`, `server-merge/`, `server-runtime-chrome/`, binaries in `bin/silverbullet`, `bin/sb`): Axum Rust workspace. Serves the SPA, the file API (`server/src/handlers/fs.rs`, per-file 3-way merge via `server-merge`), `/.events`, and `/.proxy/{host}/{path}` (`handlers/proxy.rs`) — the only way the browser reaches external HTTP (no CORS layer). Proxy to localhost is http-only and needs write permission. `docker-entrypoint.sh` resolves `/data`, drops to `PUID:PGID`, and runs `CONTAINER_BOOT.md` as root if present.
- **Client** (`client/`): CodeMirror 6 editor (`client/codemirror/`; extension list in `editor_state.ts` `buildPageExtensions`), space tree (`client/navigator/`), PlugOS runtime (`client/plugos/`), Space Lua interpreter (`client/space_lua/`). **Markdown on disk is the only source of truth**; every index is derived. A missing `CONFIG.md` means defaults (`client/boot.ts`); only the Configuration Manager creates it.
- **Plugs** (`plugs/`): each has `<name>.plug.yaml`, registered in `plugs/builtin_plugs.ts`. `plugs/index/` builds the object index (links are `relation` objects; backlinks are `relation` queries on `to == name`; rename in `plugs/index/refactor.ts`).
- **Libraries** (`libraries/Library/Std/...`): Space Lua/Markdown embedded at build time — new features here need no Rust change. Plug-facing API is `plug-api/`.
- **Fork additions** (details in README table and `dev-docs/phase*-design.md`): tree Mediator in `client/navigator/ui/mediator/`; block editor in `client/codemirror/block_editor/`; DB views in `plugs/db-view/` (```` ```db ```` blocks, registered in `libraries/Library/Std/Editor/DB View.md`); graph with semantic edges in `plugs/object-graph/` (`src/semantic.ts`, `src/sidecar.ts`); search UI in `libraries/Library/Std/Editor/Memo Search.md`.
- **Search / RAG sidecar** (`packages/memo-mcp/`): builds an in-memory SQLite (WASM) index per section (`##` heading) lazily on the first call and refreshes by mtime on every call; FTS5 trigram + local `multilingual-e5-small` embeddings fused with RRF; exposes MCP (stdio `src/stdio.mjs`, HTTP `src/http.mjs`) and REST `/api/search|related|graph`. Embeddings are cached per space name under `MEMO_INDEX_DIR` (derived, deletable); the model is downloaded on first semantic use and a failed download degrades to lexical with a `warning` (never 500). The app reaches it via `net.proxyFetch` → `/.proxy/127.0.0.1:<MEMO_PORT>/...`, configured per space with `config.set("memoSidecar", {url=…, token=…, space=…})`. Gotchas: memo-mcp only accepts `Host: 127.0.0.1:<its own port>`, so the published host port must equal `MEMO_MCP_PORT` (compose passes `MEMO_PORT` to both); `net.proxyFetch` returns outer 200 even on upstream 4xx — check `res.status`; the proxy connects from the server side, so inside a bridge-network container `127.0.0.1` is the container itself (hence `network_mode: service:app`). `CONFIG.md`, `Templates/`, `Library/`, `Images/` are never indexed.
- **Front door** (`deploy/tailnet-proxy/`): tailnet node → Caddy (Let's Encrypt DNS-01 via Cloudflare) → Python whois auth service → app. Caddy strips client-supplied `Tailscale-User-*` headers so the app can trust `Tailscale-User-Login`. The node's identity and certificates live in the `ts-state` / `caddy-data` volumes.

## Conventions

- Follow `STYLE.md` (relative imports with `.ts` extension, `import type`, `type` over `interface`, biome formatting). Run `make fmt` before committing.
- Tests sit beside sources as `*.test.ts` (vitest); Space Lua libraries are tested by evaluating them on a Lua stub (`client/space_lua/memo_search_lua.test.ts`). memo-mcp tests spawn the real servers on fixture spaces (`test/helpers/fixture.mjs`).
- User-facing help is `libraries/Library/Std/Docs/Fork Guide.md` (Japanese; opened by the header **?** and `Help: Fork Guide`); when adding/changing a command, shortcut or tree/page interaction, update it, add new commands to its `FORK_COMMANDS` list, and mirror the command in README's list.
- UI work follows the rules at the top of this file (components only render props and `emit` events).
- Licensing: upstream files stay MIT; additions are GPL-2.0-only (`NOTICE.md`), new files start with the SPDX header. Keep both notices.
- This is a public repo: no personal data, hostnames, paths or customer examples in committed files (including this one).
- Commit messages end with the Co-Authored-By line from the session's attribution instructions.
