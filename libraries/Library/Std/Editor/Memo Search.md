#meta

Search and related notes, backed by the search service that `./setup.sh` starts next to the app (`memo-mcp`: keyword search plus local embeddings). The service is optional: with no configuration, or with it down, the views below say what is off and what to do, and the editor keeps working.

# Configuration
Put this in your `CONFIG` page (use `space-lua` instead of `lua` in your actual page):

```lua
config.set("memoSidecar", {
  url = "127.0.0.1:3010",   -- host:port of the service; "/.proxy/127.0.0.1:3010" is accepted too
  token = "…",              -- its bearer token
  space = "notes",          -- which space of the service to query
  -- debug = true,          -- optional: show the ranking numbers on every result
})
```
All requests go through the app's own `/.proxy/` route (`net.proxyFetch`), so the browser never talks to the service directly and the service only has to be reachable from the app's server.

# Commands
* ${widgets.commandButton("Search: Notes")} (`Ctrl-q s`): a modal search over every section of every page. Type to search, `Up`/`Down` to move, `Enter` or a click to jump to the section.
  * The first line says how many sections matched ("9 sections for launch"); the list scrolls. Each result is `Page › Section`, then the sentence that matched, with the folder on the right.
  * Results are ranked by words and by meaning together. The ranking numbers are hidden; hover a result's chip for them, or set `debug = true` in `memoSidecar` to print them.
  * Hits that are documents (PDF, Word, slides, sheets indexed by the service) carry a chip such as `PDF p.3` or `PPTX slide.2`. Selecting one opens the file; set `pdfPages = true` in `memoSidecar` to open a PDF at the hit's page (`Page.pdf#page=3`), but only if your viewer understands `#page=N` (otherwise it opens the file as before).
  * Scope words at the start of the query, shown as a hint when you type one: `kind:pdf` (also `docx`, `xlsx`, `pptx`, `text`, `odf`, `html`, `legacy`, `md`; extensions like `csv`, `txt`, `odt`, `doc` map to their kind; `kind:doc` is every document), `in:Projects/` (or `folder:`). Example: `kind:pdf in:Receipts/ invoice`. The service's `/api/search` takes the same as `kind=` and `prefix=`.
  * With the service off, the modal still opens: it says so and offers _Open a page named …_ with what you typed.
* ${widgets.commandButton("Search: Related Notes")} (`Ctrl-q r`): toggles the _Related notes_ panel at the bottom of the current page. Its first line counts the pages; each one is marked _Similar_, _Linked_ or _Similar · Linked_. It is closed until you open it and only asks the service while it is open; fold it with its title bar.

# Implementation

## Helpers
```space-lua
-- priority: 10
memo = memo or {}

config.define("memoSidecar", {
  description = "Connection to the search service (memo-mcp) used by Search: Notes, Related Notes and Ask: Notes",
  type = "object",
  properties = {
    url = { type = "string", description = "host:port of the service (the app's server proxies the calls)" },
    token = { type = "string", description = "Bearer token of the service" },
    space = { type = "string", description = "Space of the service to query, e.g. notes" },
    pdfPages = { type = "boolean", description = "Open a PDF hit at its page (Page.pdf#page=N); only for a viewer that understands #page=N" },
    debug = { type = "boolean", description = "Show the ranking numbers on every search result" },
  },
  additionalProperties = false,
})

-- Every message is final text for the reader: what is the case, then what to do.
-- A failure is (nil, message, kind): kind "off" when the service is not there (not set up,
-- or not running), "error" when it answered with a failure.
memo.OFF = "Search by meaning is off. Start it with ./setup.sh or set memoSidecar in CONFIG."
memo.RELATED_OFF = "Related notes need Search by meaning. Start it with ./setup.sh."
memo.NO_SPACE = 'memoSidecar.space is not set. Add the name of the space, for example "notes".'

-- Accepts "127.0.0.1:3010", "http://127.0.0.1:3010/" and "/.proxy/127.0.0.1:3010";
-- net.proxyFetch wants the scheme-less form and adds /.proxy/ itself.
function memo.normalizeBase(url)
  url = string.gsub(url, "^%s+", "")
  url = string.gsub(url, "%s+$", "")
  url = string.gsub(url, "^/?%.proxy/", "")
  url = string.gsub(url, "^https?://", "")
  url = string.gsub(url, "/+$", "")
  return url
end

-- Returns the usable settings, or nil plus a message and its kind.
function memo.sidecarConfig()
  local cfg = config.get("memoSidecar", nil)
  if type(cfg) != "table" or type(cfg.url) != "string" or cfg.url == "" then
    return nil, memo.OFF, "off"
  end
  local base = memo.normalizeBase(cfg.url)
  if base == "" then
    return nil, memo.OFF, "off"
  end
  if type(cfg.space) != "string" or cfg.space == "" then
    return nil, memo.NO_SPACE, "error"
  end
  return { base = base, token = cfg.token, space = cfg.space, debug = cfg.debug == true }
end

function memo.urlEncode(s)
  return js.window.encodeURIComponent(tostring(s))
end

-- params is an ordered list of {key, value} pairs; nil values are skipped.
function memo.queryString(params)
  local parts = {}
  for _, p in ipairs(params) do
    if p[2] != nil then
      table.insert(parts, memo.urlEncode(p[1]) .. "=" .. memo.urlEncode(p[2]))
    end
  end
  return table.concat(parts, "&")
end

function memo.buildUrl(cfg, endpoint, params)
  local all = { { "space", cfg.space } }
  for _, p in ipairs(params) do
    table.insert(all, p)
  end
  return cfg.base .. "/api/" .. endpoint .. "?" .. memo.queryString(all)
end

-- The proxy answers 200 with the upstream status in `status`, so `ok` alone is not enough.
function memo.describeFailure(res)
  local detail
  if type(res.body) == "table" and type(res.body.error) == "string" then
    detail = res.body.error
  elseif type(res.body) == "string" and res.body != "" then
    detail = string.sub(res.body, 1, 120)
  end
  if res.status == 401 then
    return "Search rejected the token. Check memoSidecar.token in CONFIG."
  elseif res.status == 404 then
    return "Search could not find that space" .. (detail and (" (" .. detail .. ")") or "") ..
      ". Check memoSidecar.space in CONFIG."
  end
  return "Search failed (HTTP " .. tostring(res.status) .. (detail and (": " .. detail) or "") ..
    "). Try again in a moment."
end

-- The result of a pcall(net.proxyFetch, …) -> decoded body, or nil plus a message and its kind.
function memo.decodeResponse(ok, res)
  -- the proxy could not connect (or answered 5xx itself): nothing is listening
  if not ok or (not res.ok and (tonumber(res.status) or 0) >= 500) then
    return nil, memo.OFF, "off"
  end
  if not res.ok or res.status < 200 or res.status >= 300 then
    return nil, memo.describeFailure(res), "error"
  end
  if type(res.body) != "table" then
    return nil, "Search returned an unexpected answer. Try again in a moment.", "error"
  end
  return res.body
end

-- Returns the decoded body, or nil plus a message and its kind. Never throws: a service that is
-- down must only cost the search views, not the editor.
function memo.request(endpoint, params)
  local cfg, err, kind = memo.sidecarConfig()
  if not cfg then
    return nil, err, kind
  end
  local headers = {}
  if cfg.token and cfg.token != "" then
    headers.Authorization = "Bearer " .. cfg.token
  end
  local body, failure, failKind = memo.decodeResponse(pcall(net.proxyFetch, memo.buildUrl(cfg, endpoint, params), { headers = headers }))
  if not body then
    return nil, failure, failKind
  end
  return body, nil, cfg
end

-- POST variant of memo.request for the endpoints that take a JSON body (/api/ask). The
-- space goes into the body; net.proxyFetch JSON-encodes a table body itself.
function memo.requestJson(endpoint, fields)
  local cfg, err, kind = memo.sidecarConfig()
  if not cfg then
    return nil, err, kind
  end
  local headers = { ["content-type"] = "application/json" }
  if cfg.token and cfg.token != "" then
    headers.Authorization = "Bearer " .. cfg.token
  end
  local payload = { space = cfg.space }
  for k, v in pairs(fields or {}) do
    payload[k] = v
  end
  local body, failure, failKind = memo.decodeResponse(pcall(net.proxyFetch, cfg.base .. "/api/" .. endpoint,
    { method = "POST", headers = headers, body = payload }))
  if not body then
    return nil, failure, failKind
  end
  return body, nil, cfg
end

-- The service's excerpt starts with the section's context header, "[notes / Page > Heading] ...".
-- When the excerpt is cut inside that header (no closing bracket) there is no body text to show.
-- This is only the fallback for a hit whose page cannot be read (see memo.sectionLines).
-- A header cut from the left ("…path > Heading…") is dropped too.
function memo.cleanSnippet(snippet, maxLen)
  local s = tostring(snippet or "")
  s = string.gsub(s, "^%[[^%]\n]*%]%s*", "")
  if string.find(s, "^%[[^%]]* / ") then
    s = ""
  end
  s = string.gsub(s, "%s+", " ")
  s = string.gsub(s, "^ ", "")
  -- An excerpt cut from the left inside the header: "…pdf > Heading…" is debris, not text.
  if string.find(s, "^…") and string.find(string.sub(s, 1, 60), " > ", 1, true) then
    s = ""
  end
  maxLen = maxLen or 180
  if #s > maxLen then
    s = string.sub(s, 1, maxLen) .. "…"
  end
  return s
end

-- A rank is nil/null when that ranker did not return the section.
local function rankLabel(prefix, rank)
  if type(rank) == "number" then
    return prefix .. rank
  end
  return prefix .. "-"
end

-- Ranking numbers: shown only with memoSidecar.debug, and as a tooltip.
function memo.scoreBadge(hit)
  local ranks = hit.ranks or {}
  local score = type(hit.score) == "number" and string.format("%.4f", hit.score) or "-"
  return rankLabel("L", ranks.lexical) .. " " .. rankLabel("S", ranks.semantic) .. " · " .. score
end

function memo.scoreTitle(hit)
  local ranks = hit.ranks or {}
  local function r(v)
    return type(v) == "number" and ("#" .. v) or "no match"
  end
  return "Words " .. r(ranks.lexical) .. ", meaning " .. r(ranks.semantic) ..
    ", score " .. (type(hit.score) == "number" and string.format("%.4f", hit.score) or "-")
end

-- Where a result opens: the section's heading line (`heading_line`, from the service).
-- The service's `line_start` is the first line of the section's text, i.e. the line AFTER the
-- heading, so it is only the fallback (older services, or sections that have no heading line).
-- Line refs (`Page@L<n>`) are 1-based, like both of these.
function memo.navRef(hit)
  if hit.kind == "pdf" and type(hit.unit_no) == "number" and hit.unit_no >= 1 then
    local cfg = config.get("memoSidecar", nil)
    if type(cfg) == "table" and cfg.pdfPages == true then
      return hit.page .. "#page=" .. string.format("%d", hit.unit_no)
    end
  end
  local line = hit.heading_line
  if type(line) != "number" or line < 1 then
    line = hit.line_start
  end
  if type(line) == "number" and line >= 1 then
    return hit.page .. "@L" .. string.format("%d", line)
  end
  return hit.page
end

-- "PDF p.3", "PPTX slide.2": what kind of file a hit is, or nil for a note.
function memo.docLabel(hit)
  if type(hit.kind) != "string" or hit.kind == "" or hit.kind == "md" then
    return nil
  end
  local label = string.upper(hit.kind)
  if type(hit.unit) == "string" and hit.unit != "" then
    label = label .. " " .. hit.unit
  end
  return label
end

local function lastSegment(page)
  return string.match(page, "([^/]+)$") or page
end

function memo.folderOf(page)
  return string.match(page, "^(.*)/[^/]+$")
end

-- "Page › Heading › Subheading". The service's first heading is usually the page's own title,
-- which the page name already says. `short` names the page by its last segment (the folder is
-- shown apart) and leaves the kind of file to a chip.
function memo.headingLabel(hit, short)
  local path = hit.heading_path
  local pageLabel = short and lastSegment(hit.page) or hit.page
  if type(path) != "table" then
    return pageLabel
  end
  local base = lastSegment(hit.page)
  local parts = { pageLabel }
  for i, h in ipairs(path) do
    -- a document's only heading is "<file> p.3": the label says that already
    local unitHeading = type(hit.unit) == "string" and h == base .. " " .. hit.unit
    if not (i == 1 and (h == hit.page or h == base)) and not unitHeading then
      table.insert(parts, h)
    end
  end
  local label = not short and memo.docLabel(hit)
  if label then
    return table.concat(parts, " › ") .. " [" .. label .. "]"
  end
  return table.concat(parts, " › ")
end

-- Search scope words at the start of the phrase -> query, scope {prefix =, kind =}.
-- `kind:pdf` (or docx, md, ... or `kind:doc` for every document), `in:Projects/` or `folder:Projects/`.
-- A word with no value yet (`kind:`) stays in the query so typing it does not search.
function memo.searchParseScope(input)
  local scope = {}
  local rest = string.gsub(tostring(input or ""), "^%s+", "")
  while true do
    local _, e, k, v = string.find(rest, '^(%a+):"([^"]*)"%s*')
    if not e then
      _, e, k, v = string.find(rest, "^(%a+):(%S+)%s*")
    end
    if not e then
      break
    end
    k = string.lower(k)
    if k == "kind" then
      scope.kind = string.lower(v)
    elseif k == "in" or k == "folder" then
      scope.prefix = string.find(v, "/$") and v or (v .. "/")
    else
      break
    end
    rest = string.sub(rest, e + 1)
  end
  rest = string.gsub(rest, "%s+$", "")
  return rest, scope
end

-- ---- Result text: the matched sentence of the section's own body ----
local SNIPPET_MAX = 160

-- The lines of a note hit's section as the page has them (line_start..line_end, 1-based),
-- without a leading frontmatter block, heading lines or blanks; nil when the page cannot be
-- read or the hit is a document. `pages` caches the lines of each page for one search.
function memo.sectionLines(hit, pages)
  if type(hit.kind) == "string" and hit.kind != "md" then
    return nil
  end
  if type(hit.line_start) != "number" or hit.line_start < 1 then
    return nil
  end
  local lines = pages[hit.page]
  if lines == nil then
    lines = false
    local ok, text = pcall(function()
      return space.readPage(hit.page)
    end)
    if ok and type(text) == "string" then
      lines = {}
      local pos = 1
      while true do
        local nl = string.find(text, "\n", pos, true)
        if not nl then
          table.insert(lines, string.sub(text, pos))
          break
        end
        table.insert(lines, string.sub(text, pos, nl - 1))
        pos = nl + 1
      end
    end
    pages[hit.page] = lines
  end
  if not lines then
    return nil
  end
  local first = hit.line_start
  local last = type(hit.line_end) == "number" and hit.line_end or first
  if first == 1 and lines[1] != nil and string.find(lines[1], "^%-%-%-%s*$") then
    for j = 2, #lines do
      if string.find(lines[j], "^%-%-%-%s*$") then
        first = j + 1
        break
      end
    end
  end
  local out = {}
  for j = first, math.min(last, #lines) do
    local line = lines[j]
    if not string.find(line, "^%s*#+%s") then
      line = string.gsub(line, "\r$", "")
      line = string.gsub(line, "^%s*[%*%-%+]%s+", "")
      line = string.gsub(line, "^%d+%.%s+", "")
      line = string.gsub(line, "^%[[ xX]%]%s*", "")
      line = string.gsub(line, "%[%[([^%]|]*)|([^%]]*)%]%]", "%2")
      line = string.gsub(line, "%[%[([^%]]*)%]%]", "%1")
      line = string.gsub(line, "%*%*", "")
      line = string.gsub(line, "`", "")
      line = string.gsub(line, "%s+", " ")
      line = string.gsub(line, "^ ", "")
      line = string.gsub(line, " $", "")
      if line != "" then
        table.insert(out, line)
      end
    end
  end
  return out
end

-- The words of a phrase, lower-cased.
function memo.queryTerms(q)
  local terms = {}
  for word in string.gmatch(string.lower(tostring(q or "")), "%S+") do
    table.insert(terms, word)
  end
  return terms
end

-- One line cut into sentences (a full stop plus a space, or a Japanese 。！？).
local function sentences(line)
  local out = {}
  local pos = 1
  while pos <= #line do
    local a, b = string.find(line, "[%.%!%?]%s+", pos)
    local c, d = string.find(line, "[。！？]", pos)
    if a and (not c or a < c) then
      table.insert(out, string.sub(line, pos, a))
      pos = b + 1
    elseif c then
      table.insert(out, string.sub(line, pos, c))
      pos = d + 1
    else
      table.insert(out, string.sub(line, pos))
      break
    end
  end
  return out
end

-- At most SNIPPET_MAX characters of `text`, around `at`, with an ellipsis on a cut side.
local function clip(text, at)
  if #text <= SNIPPET_MAX then
    return text
  end
  local from = math.max(1, math.min(at - 40, #text - SNIPPET_MAX + 1))
  local out = string.sub(text, from, from + SNIPPET_MAX - 1)
  if from > 1 then
    out = "…" .. out
  end
  if from + SNIPPET_MAX - 1 < #text then
    out = out .. "…"
  end
  return out
end

-- The sentence that holds the first term of the phrase found in the section (term order, then
-- sentence order); with no match, the start of the section. Returns the text and the highlight
-- ranges [start, end) of every term in it.
function memo.bodySnippet(lines, q)
  local terms = memo.queryTerms(q)
  local picked
  for _, term in ipairs(terms) do
    for _, line in ipairs(lines) do
      for _, sentence in ipairs(sentences(line)) do
        local at = string.find(string.lower(sentence), term, 1, true)
        if at then
          picked = clip(sentence, at)
          break
        end
      end
      if picked then break end
    end
    if picked then break end
  end
  if not picked then
    picked = clip(table.concat(lines, " "), 1)
  end
  local highlights = {}
  local lower = string.lower(picked)
  if #lower == #picked then
    for _, term in ipairs(terms) do
      local pos = 1
      while true do
        local s, e = string.find(lower, term, pos, true)
        if not s then break end
        table.insert(highlights, { s - 1, e })
        pos = e + 1
      end
    end
  end
  return picked, highlights
end

-- /api/search body -> view rows. opts = { phrase = the phrase, debug = show the ranking numbers }.
function memo.searchRows(body, opts)
  if type(opts) != "table" then
    opts = {}
  end
  local pages = {}
  local rows = {}
  for i, hit in ipairs(body.results or {}) do
    local snippet, highlights
    local lines = memo.sectionLines(hit, pages)
    if lines and #lines > 0 then
      snippet, highlights = memo.bodySnippet(lines, opts.phrase)
    else
      snippet, highlights = memo.cleanSnippet(hit.snippet), {}
    end
    table.insert(rows, {
      name = hit.page .. "@" .. tostring(hit.line_start) .. "#" .. i,
      kind = "hit",
      page = hit.page,
      folder = memo.folderOf(hit.page),
      ref = memo.navRef(hit),
      title = memo.headingLabel(hit, true),
      docLabel = memo.docLabel(hit),
      snippet = snippet,
      highlights = highlights,
      tip = memo.scoreTitle(hit),
      badge = opts.debug and memo.scoreBadge(hit) or nil,
    })
  end
  return rows
end

local VIA_LABEL = { semantic = "Similar", link = "Linked", both = "Similar · Linked" }

function memo.plural(n, one, many)
  return tostring(n) .. " " .. (n == 1 and one or many)
end

-- A sentence or a count: something to read, not to act on.
function memo.messageRow(text, isError)
  return {
    name = "memo-message:" .. text,
    kind = "message",
    title = text,
    isError = isError or false,
    passive = true,
    cssClass = "sb-nav-sentence",
  }
end

function memo.countRow(text)
  return { name = "memo-count", kind = "count", title = text, passive = true, cssClass = "sb-nav-count" }
end

-- /api/related body -> view rows: how many, then one row per page marked Similar / Linked.
function memo.relatedRows(body)
  local results = body.results or {}
  if #results == 0 then
    return { memo.messageRow("Nothing related yet. Links from this page will show here.") }
  end
  local rows = { memo.countRow(memo.plural(#results, "related page", "related pages")) }
  for _, r in ipairs(results) do
    local score = type(r.score) == "number" and r.score > 0 and string.format("%.2f", r.score) or nil
    table.insert(rows, {
      name = r.page,
      kind = "related",
      page = r.page,
      folder = memo.folderOf(r.page),
      ref = r.page,
      -- the page's name is its last segment; the folder is the dim crumb beside it
      title = lastSegment(r.page),
      badge = VIA_LABEL[r.via] or "Related",
      tip = score and ("Similarity " .. score) or nil,
    })
  end
  return rows
end

-- The rows for a failure: the sentence, then (for a search) a way forward that needs no service.
function memo.failureRows(message, kind, phrase)
  local rows = { memo.messageRow(message, kind == "error") }
  if phrase and phrase != "" then
    table.insert(rows, {
      name = "memo-open-page",
      kind = "openpage",
      title = "Open a page named “" .. phrase .. "” instead",
      phrase = phrase,
    })
  end
  return rows
end
```

## Search
```space-lua
-- priority: 9
-- 9 and not -1: the commands and views exist as soon as the scripts load (before the user's CONFIG,
-- nothing here reads config while registering), yet after the helpers above (10): scripts of
-- one priority run in order of their position in the page, as text.
-- Repeating the same query within a few seconds reuses the last answer instead of asking the
-- service again.
local lastSearch = nil
local CACHE_SECONDS = 15
local RESULT_LIMIT = 20
local NEAREST_LIMIT = 5

local function searchRowsFor(phrase)
  local q, scope = memo.searchParseScope(phrase)
  local cfg, err, kind = memo.sidecarConfig()
  if not cfg then
    return memo.failureRows(err, kind, q)
  end
  -- a scope word with no value yet ("in:", "kind:") is not a search either
  local lowerQ = string.lower(q)
  local bareScope = lowerQ == "in:" or lowerQ == "kind:" or lowerQ == "folder:"
  if q == "" or q == "?" or bareScope then
    local rows = { memo.messageRow("Type to search your notes by keywords or meaning.") }
    if q == "?" or bareScope or string.find(tostring(phrase), "^%s*[%a]+:") then
      table.insert(rows, memo.messageRow("Narrow with kind:pdf, kind:doc (all documents) or in:Folder/."))
    end
    return rows
  end
  local key = cfg.base .. "|" .. cfg.space .. "|" .. q .. "|" .. tostring(scope.kind) .. "|" .. tostring(scope.prefix) ..
    "|" .. tostring(cfg.debug)
  if lastSearch and lastSearch.key == key and os.time() - lastSearch.at < CACHE_SECONDS then
    return lastSearch.rows
  end
  local body, failure, failKind = memo.request("search",
    { { "q", q }, { "limit", RESULT_LIMIT }, { "kind", scope.kind }, { "prefix", scope.prefix } })
  if not body then
    return memo.failureRows(failure, failKind, q)
  end
  local hits = memo.searchRows(body, { phrase = q, debug = cfg.debug })
  local rows
  if #hits == 0 then
    rows = { memo.messageRow("No sections match " .. q .. ". Try fewer words, or in:Folder/ to narrow.") }
  else
    -- Search by meaning always finds the nearest sections, so a nonsense phrase never comes back
    -- empty. When no result holds the words themselves, say so and show only the nearest few,
    -- rather than a full list that looks like matches.
    local byWords = false
    for _, r in ipairs(body.results) do
      if type(r.ranks) == "table" and type(r.ranks.lexical) == "number" then
        byWords = true
      end
    end
    local title
    if byWords then
      local n = #hits >= RESULT_LIMIT and (RESULT_LIMIT .. "+") or tostring(#hits)
      title = n .. " " .. (#hits == 1 and "section" or "sections") .. " for " .. q
    else
      title = "Closest by meaning to " .. q
      while #hits > NEAREST_LIMIT do
        table.remove(hits)
      end
    end
    rows = { memo.countRow(title) }
    for _, hit in ipairs(hits) do
      table.insert(rows, hit)
    end
    if body.warning then
      table.insert(rows, memo.messageRow("Search by meaning is not available right now. These results match words only."))
    end
  end
  lastSearch = { key = key, at = os.time(), rows = rows }
  return rows
end

view.define {
  name = "memo.search",
  title = "Search",
  placeholder = "Search your notes…",
  command = "Search: Notes",
  key = "Ctrl-q s",
  dock = "modal",
  search = "source",
  source = function(ctx)
    return searchRowsFor(ctx.phrase)
  end,
  presentation = {
    row = {
      primary = "title",
      passive = function(obj)
        return obj.passive == true
      end,
      cssClass = function(obj)
        return obj.cssClass
      end,
      description = function(obj)
        if obj.kind == "hit" and obj.snippet != "" then
          return { text = obj.snippet, highlights = obj.highlights }
        end
      end,
      decorations = function(obj)
        if obj.kind != "hit" then
          return nil
        end
        local out = {}
        if obj.docLabel then
          table.insert(out, { text = obj.docLabel, position = "right", cssClass = "sb-nav-chip-hint", title = obj.tip })
        end
        if obj.badge then
          table.insert(out, { text = obj.badge, position = "right", cssClass = "sb-nav-chip-hint", title = obj.tip })
        end
        if obj.folder then
          table.insert(out, { text = obj.folder, position = "right", cssClass = "sb-nav-crumb", title = obj.page .. "\n" .. obj.tip })
        end
        return out
      end,
      icon = function(obj)
        if obj.kind == "message" then
          return obj.isError and "alert-circle" or "info"
        elseif obj.kind == "openpage" then
          return "arrow-right"
        elseif obj.kind == "count" then
          return nil
        end
        return obj.docLabel and "file" or "file-text"
      end,
    },
  },
  onSelect = function(obj)
    if obj.kind == "openpage" then
      view.open("std.pages", { phrase = obj.phrase })
      return false
    end
    if obj.kind != "hit" then
      return false
    end
    editor.navigate(obj.ref)
  end,
}
```

## Related notes
```space-lua
-- priority: 9
local function relatedRowsFor()
  local page = editor.getCurrentPage()
  if not page or page == "" then
    return {}
  end
  local body, err, kind = memo.request("related", { { "page", page }, { "limit", 8 } })
  if not body then
    return { memo.messageRow(kind == "off" and memo.RELATED_OFF or err, kind == "error") }
  end
  return memo.relatedRows(body)
end

view.define {
  name = "memo.related",
  title = "Related notes",
  command = "Search: Related Notes",
  key = "Ctrl-q r",
  dock = "page-bottom",
  supportedDocks = { "page-bottom", "page-top", "rhs", "lhs", "bhs" },
  defaultOpen = false,
  refreshOn = { "editor:pageLoaded" },
  refreshOnOpen = true,
  source = relatedRowsFor,
  presentation = {
    row = {
      primary = "title",
      passive = function(obj)
        return obj.passive == true
      end,
      cssClass = function(obj)
        return obj.cssClass
      end,
      decorations = function(obj)
        local out = {}
        if obj.folder then
          table.insert(out, { text = obj.folder, position = "right", cssClass = "sb-nav-crumb", title = obj.page })
        end
        if obj.badge then
          table.insert(out, { text = obj.badge, position = "right", cssClass = "sb-nav-via", title = obj.tip })
        end
        return out
      end,
      icon = function(obj)
        if obj.kind == "message" then
          return obj.isError and "alert-circle" or "info"
        elseif obj.kind == "count" then
          return nil
        end
        return "file-text"
      end,
    },
  },
  onSelect = function(obj)
    if obj.kind != "related" then
      return false
    end
    editor.navigate(obj.ref)
  end,
}
```

## Style
Where a result's folder and the Similar / Linked marks sit: quiet text, not a coloured pill.

```space-style
.sb-nav-chip.sb-nav-crumb,
.sb-nav-selected .sb-nav-chip.sb-nav-crumb:not(.sb-hashtag) {
  margin-left: auto;
  padding: 0;
  background: none;
  color: var(--sb-ink-2, var(--subtle-color));
  font-size: var(--sb-text-xs, 12px);
  max-width: 40%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* The Related notes panel is a page widget: a count or a sentence there is plain text, not a
   link. The widget leaves such a row out of the tab order (`row.passive`); this is the look. */
.sb-page-widget-body .sb-page-widget-row:is(.sb-nav-count, .sb-nav-sentence) {
  pointer-events: none;
  cursor: default;
  background: none;
  font-size: var(--sb-text-sm, 12.5px);
}

.sb-page-widget-body .sb-page-widget-row:is(.sb-nav-count, .sb-nav-sentence) .sb-nav-primary {
  color: var(--sb-ink-2, var(--subtle-color));
}

.sb-nav-chip.sb-nav-via {
  margin-left: auto;
  padding: 1px 8px;
  border-radius: var(--sb-radius-1, 4px);
  background: var(--sb-bg-2, color-mix(in srgb, currentColor 8%, transparent));
  color: var(--sb-ink-2, var(--subtle-color));
  font-size: var(--sb-text-xs, 12px);
  white-space: nowrap;
}

/* the folder takes the free space; the Similar / Linked mark follows it */
.sb-nav-chip.sb-nav-crumb + .sb-nav-chip.sb-nav-via {
  margin-left: 8px;
}
```
