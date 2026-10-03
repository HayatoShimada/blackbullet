# memo-mcp

An MCP server plus a read-only REST API (`/api/ask` is a POST that only reads) over Markdown spaces such as
[SilverBullet](https://silverbullet.md) / BlackBullet. It provides hybrid search
(SQLite FTS5 trigram + local multilingual embeddings, merged with Reciprocal Rank Fusion),
section-level reading, related notes, task / project / journal tools and a few safe write tools.
Everything runs locally. The sidecar never sends note text to an external service (it only downloads the embedding model once). `/api/ask` returns matching sections to the caller; BlackBullet's `Ask: Notes` sends them to the Anthropic API from the app, see `libraries/Library/Std/Editor/Memo Ask.md`.

(日本語: SilverBullet 系の Markdown スペースを MCP と読み取り専用 REST で公開するサーバー。FTS5 trigram とローカル埋め込みのハイブリッド検索を持ちます。)

License: GPL-2.0-only. Copyright (C) 2026 HayatoShimada.

## Architecture

| File | Role |
|---|---|
| `src/space.mjs` | Filesystem layer: `MEMO_SPACES` parsing, frontmatter / task / link parsing, path validation, conflict detection |
| `src/index.mjs` | Index. Built lazily in memory with SQLite (official WASM build) on the first call and refreshed by mtime on every call. Sections, FTS5 (trigram), links, tasks. PDF / Office documents go into the same tables with `kind` set (see below) |
| `src/extract.mjs` | Text extraction for documents: `.pdf` via `pdftotext` (poppler-utils), `.docx` / `.xlsx` / `.pptx` via `unzip` of the OOXML parts, `.odt` / `.ods` / `.odp` and `.html` / `.htm` via unzip / tag stripping, legacy `.doc` / `.xls` / `.ppt` reported as `unsupported`, `.txt` as-is, `.csv` as header-keyed rows, optional OCR for scans and images (`MEMO_OCR=on`, `tesseract`). No npm dependencies; failures yield an empty extraction and never stop indexing |
| `src/embed.mjs` | Local embeddings (`Xenova/multilingual-e5-small`, ONNX q8), cached per section hash in `$MEMO_INDEX_DIR/*.embeddings.json` |
| `src/search.mjs` | Hybrid search: BM25 and cosine merged with RRF, boosted by title match / active status / journal freshness |
| `src/resources.mjs` | MCP resources (`memo://<space>/<page>`) |
| `src/rest.mjs` | REST (`/api/search`, `/api/related`, `/api/graph` read-only GET; `/api/ask` POST) reusing the same index and embeddings |
| `src/tools.mjs` | MCP tool definitions (read tools plus a few write tools) |
| `src/reindex.mjs` / `src/eval.mjs` | Rebuild the index and precompute embeddings / evaluate with a golden set |
| `src/stdio.mjs` | stdio transport (the MCP client launches the process, optionally over SSH) |
| `src/http.mjs` | Streamable HTTP transport (run it under a service manager) |

## Configuration (environment variables)

| Variable | Meaning |
|---|---|
| `MEMO_SPACES` | Required. Comma-separated `name=/abs/path` entries, each with an optional `:confidential` suffix. Example: `notes=/data/notes,work=/data/work:confidential`. There are no default spaces. |
| `MEMO_MCP_TOKEN` | Required by the HTTP server (`src/http.mjs`). Bearer token for `/mcp` and `/api/*`. The server refuses to start without it. |
| `MEMO_MCP_PUBLIC_HOST` | Optional `host[:port]` that clients use through a reverse proxy (e.g. `memo.example.net:443`). Added to the allowed Host / Origin list. Unset = only `127.0.0.1` / `localhost` are accepted. The root `compose.yaml` defaults it to `SITE_DOMAIN` when unset (and always adds `SITE_DOMAIN` and `SITE_DOMAIN:443` via `MEMO_MCP_EXTRA_HOSTS`, since proxies forward Host with or without the port). |
| `MEMO_MCP_EXTRA_HOSTS` | Optional comma-separated extra allowed Host values (e.g. `host.docker.internal:3010`). |
| `MEMO_MCP_PORT` / `MEMO_MCP_HOST` | Listen port (default `3010`) and address (default `127.0.0.1`). |
| `MEMO_INDEX_DIR` | Where embeddings and the model cache live. Default `~/.cache/memo-mcp`. Derived data: safe to delete and rebuild. |
| `MEMO_EMBED` | `off` disables embeddings (lexical search only; the model is never loaded or downloaded). Default `on`. |
| `MEMO_EMBED_MODEL` | Embedding model id. Default `Xenova/multilingual-e5-small`. |
| `MEMO_EMBED_REMOTE_HOST` | Where the model is downloaded from on first use (a Hugging Face mirror). Default: the Hugging Face Hub. If the model cannot be fetched, search falls back to lexical with a `warning`, related notes to links only and the graph to no edges; the download is retried on the next request. |
| `MEMO_EXTRACT_TIMEOUT` | Milliseconds allowed per `pdftotext` / `unzip` run when extracting a document. Default `30000`. A document that exceeds it is not indexed now and is retried after a few minutes. |
| `MEMO_EXTRACT_MAX_BYTES` | Upper bound on the extractor's output per document, in bytes, and on the size of `.txt` / `.csv` files. A document over it is dropped (not truncated; see `MEMO_EXTRACT_MAX_CHARS` for truncation). Default `8388608` (8 MiB). |
| `MEMO_EXTRACT_MAX_CHARS` | Characters kept per document after extraction. Default `400000`; longer text is cut. |
| `MEMO_EXTRACT_BUDGET` | Milliseconds one index refresh may spend extracting documents. Default `60000`. The rest is deferred to the next call, so a first run over many documents catches up over several calls. |
| `MEMO_OCR` | `on` enables OCR: PDFs with (almost) no text layer are rasterised (`pdftoppm -r 200`) and read with `tesseract`, and `.png` / `.jpg` / `.jpeg` / `.webp` / `.tif` / `.tiff` / `.bmp` files are indexed (unit label `ocr`; PDF pages keep `p.N`). Default off. Needs `tesseract` on the `PATH`; without it these files report `tool_missing` and are retried. |
| `MEMO_OCR_LANG` | Tesseract languages. Default `jpn+eng`. |
| `MEMO_OCR_PAGES` | Maximum pages OCR'd per PDF; later pages are not indexed. Default `20`. |
| `MEMO_OCR_BUDGET` | Total OCR time per PDF in ms (default `120000`); pages finished before the deadline are kept. Images larger than `MEMO_EXTRACT_MAX_BYTES` are `too_large`. Only PDFs with almost no text layer are OCR'd (mixed text/scan PDFs are not). |
| `MEMO_TESSERACT` | Path of the `tesseract` binary. Default `tesseract`. |
| `MEMO_TZ` | IANA time zone (e.g. `Asia/Tokyo`) used for the dates `add_inbox` / `complete_task` write (`completed:`). Default: the process time zone, which is UTC in Docker. Pass it through compose to the sidecar so names match the app. |
| `MEMO_EXTRACT_KINDS` | Optional comma-separated list restricting which kinds are indexed (`pdf,docx,xlsx,pptx,odf,html,legacy,text,image`; `legacy` reports old `.doc`/`.xls`/`.ppt` as `unsupported`; `.html`/`.htm` are indexed by default, decoded per their `<meta charset>`, or extensions; `image` covers OCR'd pictures). Default: all. Use `pdf,docx,xlsx,pptx` to keep `.txt` / `.csv` out. |
| `MEMO_DOC_EXCLUDE` | Optional regular expression; document pages whose name matches are not indexed (e.g. `^Private/`). |

A space marked `:confidential` gets `confidential: true` in tool and REST results, a notice in
`search_notes`, and a marker comment in resources, so clients know not to quote it in public material.

### Document indexing (PDF / Office)

Besides `.md` pages, the index picks up `.pdf`, `.docx`, `.xlsx`, `.pptx`, `.odt`/`.ods`/`.odp`, `.html`, `.txt` and `.csv` files anywhere in a
space except `Templates/` and `Library/` (documents under `Images/`, SilverBullet's attachment folder, are indexed). Files whose name contains `token`, `secret`,
`password` or `credential` are never indexed.
Extraction needs `pdftotext` (poppler-utils) and `unzip` on the `PATH`; the Docker image installs both. Without them
the documents are skipped and `.md` indexing is unaffected.

- Document pages keep their extension in the page name (`Images/report.pdf`), so they never collide with `.md`
  pages and the name can be used directly in a `![[...]]` attachment link.
- Each page / slide / sheet becomes a section whose heading path is `<file> p.3` / `<file> slide.2` (long units are
  split with a `(2)` suffix, like Markdown sections). Sections have no line numbers (`line_start` / `line_end` are `0`).
- `read_section`, `read_note` and the `memo://` resource return the extracted text held in the index, with
  `kind` (`pdf`, `docx`, `xlsx`, `pptx`, `text`; `md` for Markdown pages). `list_spaces` reports `docs` (indexable
  document files) next to `pages`, and `index.docs` counts the documents that produced text.
- Extraction is re-run only when the file's mtime changes; a document that yields no text (scanned PDF, broken
  file, output over the byte cap) is remembered by mtime and not retried until it changes. A transient failure
  (timeout, `pdftotext` / `unzip` missing) is not remembered and is retried after about five minutes.
- Extraction is serial and runs inside the index refresh, so the first call over many large documents is slow
  (up to `MEMO_EXTRACT_TIMEOUT` each on a Pi). `MEMO_EXTRACT_BUDGET` caps one refresh; the remainder is picked up by
  later calls. A Markdown page with the same name as a document (`foo.txt.md` vs `foo.txt`) wins.
- Status: `doc_status` lists every document with `ok` / `empty` (no text, e.g. image-only PDF) / `too_large` / `unsupported` (legacy .doc/.xls/.ppt) /
  `error` (broken or encrypted) / `timeout` / `tool_missing` (retry pending) / `pending` (deferred by the refresh
  budget). `list_spaces` carries `index.docs_pending`, `index.docs_unreadable` and the first 20 unreadable files.
- Reindex: `reindex_docs` (optionally one `space` + `page`) discards what the index knows and re-extracts, e.g. after
  installing poppler or changing `MEMO_EXTRACT_*`, without waiting for the retry timer or restarting. The extractor
  version and extraction settings are also part of the cache key, so changing them re-extracts on its own.
- Writes: edits to the same file are serialized in-process (concurrent appends / inserts / task completions no longer
  lose each other's update; the lock is per real path and covers this process only, so `expected_modified` still guards
  against SilverBullet or other writers), and the directory is fsynced after the atomic rename.

## Search design (RAG)

The unit of search is a **section** (one per `##` heading). Each section is prefixed with
`[space / page > heading path] tags: ... area: ... status: ...` before indexing and embedding
(contextual retrieval; deterministic, no LLM involved).

- lexical: SQLite FTS5 `trigram` (substring and BM25 without a morphological analyzer, good for Japanese). Terms shorter than 3 characters fall back to LIKE. Japanese particles split a phrase into more terms.
- semantic: `multilingual-e5-small` on the CPU (`passage:` / `query:` prefixes, 384 dims). The model loads only when semantic search is first requested.
- fusion: RRF (k=60) plus boosts; at most 2 sections per page.
- The index is derived data. If it breaks, delete `MEMO_INDEX_DIR` and run `npm run reindex:embed`.

`npm run eval` prints recall@1 / recall@5 / MRR for lexical, semantic and hybrid. With no argument it runs
`test/eval/golden.json` against a temporary fixture space. To evaluate your own notes, copy that file, set
`"space"` and write your own `{q, expect:[pages]}` cases, then run
`MEMO_SPACES=... node src/eval.mjs my-golden.json`.

## REST API

Same port, bearer token and Host / Origin checks as `/mcp`. All endpoints are `GET` except `/api/ask` (`POST`), return JSON and require `space=<name>` (for `/api/ask` it may be in the JSON body or the query string).
Errors are `{error}` (400 bad arguments / 401 auth / 403 Host/Origin not allowed / 404 unknown space or page / 405 wrong method / 500; `/api/ask` also 413 for a body over 4 MiB). Every response carries `confidential` (true or false).

| Endpoint | Arguments | Response |
|---|---|---|
| `/api/search` | `q` (required), `limit=10` (1-50), `mode=hybrid\|lexical\|semantic`, `prefix` (page-name prefix, e.g. `Projects/`), `kind` (`md\|pdf\|docx\|...\|doc`) | `{mode, scope?, warning?, confidential, results:[{page, heading_path:[...], heading_line, line_start, line_end, snippet, score, ranks:{lexical, semantic}, kind?, unit?, unit_no?}]}` |
| `/api/related` | `page` (required), `limit=10`, `include_journal=1` | `{results:[{page, score, via:"semantic"\|"link"\|"both"}]}` |
| `/api/graph` | `k=3` (1-20), `threshold=0.80`, `page`, `include_journal=1` | `{nodes:[{id, title, tags}], edges:[{from, to, kind:"semantic", score}]}` |
| `/api/ask` (POST) | JSON body `{space, q (max 500 chars), k=8 (1-20), mode, expand (boolean), tag, area, status, since (YYYY-MM-DD or ISO), prefix, kind}` | `{question, scope?, mode, warning?, confidential, sections:[{page, heading_path:[...], heading_line, line_start, line_end, ref:"Page@L12", text, score \| context:true, kind?, unit?, unit_no?}]}`: the matching sections with full text, as grounding for an answer written elsewhere |

- `ranks` are 1-based (`null` when that method did not hit). `heading_path` is split on `" > "`.
- `/api/related` is the union of semantic neighbours and `[[wiki links]]` (outgoing and backlinks). Journal pages are excluded by default.
- `/api/graph` similarity between pages is the maximum cosine over section pairs. Each page keeps its top `k` neighbours at or above `threshold`; A-B and B-A collapse into one edge. `Journal/` is excluded by default. e5 cosines are high across the board, so raise `threshold` (0.92-0.95) to thin the graph.
- With `MEMO_EMBED=off`: search is lexical only (`mode=semantic` returns empty plus `warning`), related returns links only plus `warning`, graph returns `edges: []` plus `warning`.
- `CONFIG.md` is never indexed or embedded (it may hold tokens). Markdown under `Templates/`, `Library/` and `Images/` is skipped too; documents are skipped only under `Templates/` and `Library/`.

```bash
curl -H "Authorization: Bearer $MEMO_MCP_TOKEN" "http://127.0.0.1:3010/api/search?space=notes&q=inventory&limit=5"
```

## Run

```bash
npm install
export MEMO_SPACES="notes=/data/notes,work=/data/work:confidential"
export MEMO_MCP_TOKEN="$(openssl rand -hex 32)"
npm run start:http          # HTTP: /mcp and /api/*
npm start                   # stdio MCP (the client launches it, e.g. over: ssh user@your-host /path/to/memo-mcp/src/stdio.mjs)
npm run reindex:embed       # optional: precompute embeddings
```

In the BlackBullet repository, `./setup.sh` starts this server as the `memo-mcp` compose service next to the app (see the root `compose.yaml`); the settings above are then taken from the root `.env`.

### Connect an MCP client

HTTP (the server is running, e.g. via `./setup.sh`):

```bash
claude mcp add --transport http memo http://127.0.0.1:3010/mcp \
  --header "Authorization: Bearer $MEMO_MCP_TOKEN"
```

```json
{
  "mcpServers": {
    "memo": {
      "type": "http",
      "url": "http://127.0.0.1:3010/mcp",
      "headers": { "Authorization": "Bearer <MEMO_MCP_TOKEN>" }
    }
  }
}
```

stdio (the client starts the process itself; nothing needs to be running):

```json
{
  "mcpServers": {
    "memo": {
      "command": "node",
      "args": ["/path/to/packages/memo-mcp/src/stdio.mjs"],
      "env": { "MEMO_SPACES": "notes=/path/to/your/notes" }
    }
  }
}
```

Through a reverse proxy on another host, set `MEMO_MCP_PUBLIC_HOST` to the name clients use (for example `memo.example.net:443`) and use `https://<that name>/mcp`.

## Tests

```bash
npm test        # node --test test/*.mjs
npm run eval    # recall / MRR on the bundled fixture
```

All tests build a small fixture space in a temp directory (`test/helpers/fixture.mjs`) and run with
`MEMO_EMBED=off`; nothing touches real notes and no model is downloaded. The semantic REST tests run only
if an embedding model cache already exists (`MEMO_TEST_MODELS`, default `~/.cache/memo-mcp/models`).
The document-indexing tests (`test/extract.mjs`) are skipped when `pdftotext` or `unzip` is not on the `PATH`.

## Security notes

- Every request needs `Authorization: Bearer $MEMO_MCP_TOKEN` (constant-time comparison). The HTTP server will not start without a token.
- Host and Origin headers are validated (DNS-rebinding protection). Only loopback, `MEMO_MCP_PUBLIC_HOST` and `MEMO_MCP_EXTRA_HOSTS` are accepted.
- The server listens on `127.0.0.1` by default. Expose it only on a private network (for example a VPN or tailnet via a reverse proxy); do not put it on the public internet.
- Mark sensitive spaces `:confidential`. The flag is advisory metadata for clients; it does not restrict access.
- Page paths that escape the space root are rejected.
- Write tools take the `modified` value returned by `read_note` as `expected_modified` and abort if the file changed in the meantime (avoids overwriting edits made in an open editor).
- The SDK in use supports MCP protocol up to 2025-11-25.

## Document structure in the index

- **xlsx / csv**: one text line per row, `r12: Region: East | Revenue: 1200` (first non-empty row is the header; numbers
  and formula results are kept), grouped 20 rows per unit labelled `Sheet1 r2-21` (CSV: `r2-21`).
- **pptx**: speaker notes are appended to the slide unit as `notes: ...`.
- **docx**: one unit per heading (`Heading1`-`3`, label `Pricing > Tiers`), plus `footnotes`, `endnotes`, `comments`,
  `header` and `footer` units.
- **docx / xlsx / pptx / pdf**: title and author become an `info` unit.
- **odt / ods / odp**: read from `content.xml` via `unzip` (odp: one unit per slide, ods: one per sheet; title/author from `meta.xml`).
- **html / htm**: tags stripped (script/style/comments dropped), `<title>` becomes the `info` unit.
- **doc / xls / ppt** (legacy binary): not readable; reported by `doc_status` with status `unsupported` instead of being silently ignored.

Extraction results are persisted in `MEMO_INDEX_DIR/extract/<space>/` (keyed by path, mtime, size and the extractor/settings signature),
so a restart does not re-extract unchanged documents. `reindex_docs` bypasses the saved results. Transient failures (timeout, missing tool) are never saved.

**Tasks are one page per task.** A todo page lives in `Tasks/<title>` with frontmatter `tags: [todo]`, `status: inbox | next | waiting | someday | done`, `due`, `project: "[[Projects/X]]"`, `area`, `completed`. Projects are `Projects/` pages with `tags: project` and `status: active | someday | done`.

- `list_tasks` returns todo pages (`kind: "page"`: `page, title, status, done, due, project, area, completed`) and checkbox lines in other pages (`kind: "line"`, as before). Filters: `done`, `tag`, `status`, `project`, `due_before`, `limit`, `space`. Sorted by due date, undated last. Todo pages come from the index (`pages` table), not from re-reading files.
- `complete_task` with only `page` sets `status: done` and `completed: <today, MEMO_TZ>` on a todo page (refused if the page has no `todo` tag); with `line` it ticks a checkbox line. Both use the atomic write, per-file lock and `expected_modified` check.
- `add_inbox` creates `Tasks/<title>` (title derived from the text: `[[a/b]]` becomes `b`, `[key: value]`, `#tags` and `/ # @ | < > $ \` [ ]` removed, about 40 characters, ` 2`, ` 3` on collision) with `status: inbox` (or `next` / `someday` / `waiting` from a `#tag`), other `#tags` in `tags`, `due` from `[due: ...]` or the argument, and the full text as the body. `mode: "append"` appends a checkbox line to `Inbox.md` instead.
- `list_projects` excludes `status: done` by default (`status: "all"` lists everything); `open_tasks` counts todo pages whose `project` points at the project plus open checkbox lines inside it.

The image ships without tesseract to stay lean. Build with OCR support:
`docker build --build-arg WITH_OCR=1 packages/memo-mcp` (adds `tesseract-ocr` with Japanese and English data), then set
`MEMO_OCR=on`. With compose, add `build: { args: { WITH_OCR: "1" } }` to the memo-mcp service (compose.yaml is edited outside this package).
Oversized sheets/members are read up to `MEMO_EXTRACT_MAX_BYTES` and the rest is dropped. Changing the extractor or OCR settings re-extracts known documents on the next refresh.
