#meta

Section-level search and related notes, backed by the memo search sidecar (`memo-mcp`: FTS5 + local embeddings, fused with RRF). The sidecar is optional: with no configuration, or with the sidecar down, the views below show a message and the editor keeps working.

# Configuration
Put this in your `CONFIG` page (use `space-lua` instead of `lua` in your actual page):

```lua
config.set("memoSidecar", {
  url = "127.0.0.1:3010",   -- host:port of the sidecar; "/.proxy/127.0.0.1:3010" is accepted too
  token = "…",              -- the sidecar's bearer token
  space = "notes",         -- which space of the sidecar to query
})
```
All requests go through SilverBullet's own `/.proxy/` route (`net.proxyFetch`), so the browser never talks to the sidecar directly and the sidecar only has to be reachable from the SilverBullet server.

# Commands
* ${widgets.commandButton("Memo: Search")} (`Ctrl-Shift-f`, `Cmd-Shift-f` on macOS): a modal search over all sections. Type to search, `Up`/`Down` to move, `Enter` or a click to jump to the section. The `Details` segment adds a badge per result with the lexical rank, the semantic rank and the RRF score.
* ${widgets.commandButton("Memo: Related Notes")}: toggles the _Related notes_ panel at the bottom of the current page (semantic neighbours and linked pages). It is closed until you open it and only queries the sidecar while it is open; fold it with its title bar.

# Implementation

## Helpers
```space-lua
-- priority: 10
memo = memo or {}

config.define("memoSidecar", {
  description = "Connection to the memo search sidecar (memo-mcp) used by Memo: Search and Related Notes",
  type = "object",
  properties = {
    url = { type = "string", description = "host:port of the sidecar (the SilverBullet server proxies the calls)" },
    token = { type = "string", description = "Bearer token of the sidecar" },
    space = { type = "string", description = "Sidecar space to query, e.g. notes" },
  },
  additionalProperties = false,
})

-- A message is "title\ndetail"; the detail is the second line of a message row.
local NOT_CONFIGURED = 'Memo sidecar is not configured\n' ..
  'Set memoSidecar {url, token, space} in CONFIG'

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

-- Returns the usable settings, or nil plus a message for the user.
function memo.sidecarConfig()
  local cfg = config.get("memoSidecar", nil)
  if type(cfg) != "table" or type(cfg.url) != "string" or cfg.url == "" then
    return nil, NOT_CONFIGURED
  end
  local base = memo.normalizeBase(cfg.url)
  if base == "" then
    return nil, NOT_CONFIGURED
  end
  if type(cfg.space) != "string" or cfg.space == "" then
    return nil, 'memoSidecar.space is not set\ne.g. "notes"'
  end
  return { base = base, token = cfg.token, space = cfg.space }
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
  local msg
  if res.status == 401 then
    msg = "Memo sidecar rejected the token (HTTP 401)\nCheck memoSidecar.token"
  elseif res.status == 404 then
    msg = "Memo sidecar: not found (HTTP 404)"
  else
    msg = "Memo sidecar request failed (HTTP " .. tostring(res.status) .. ")"
  end
  if detail and res.status != 401 then
    msg = msg .. "\n" .. detail
  end
  return msg
end

-- The result of a pcall(net.proxyFetch, …) -> decoded body, or nil plus a message.
function memo.decodeResponse(ok, res)
  if not ok then
    return nil, "Memo sidecar is unreachable\nIs it running? " .. tostring(res)
  end
  if not res.ok or res.status < 200 or res.status >= 300 then
    return nil, memo.describeFailure(res)
  end
  if type(res.body) != "table" then
    return nil, "Memo sidecar returned an unexpected response"
  end
  return res.body
end

-- Returns the decoded body, or nil plus a message. Never throws: a sidecar that is down
-- must only cost the memo views, not the editor.
function memo.request(endpoint, params)
  local cfg, err = memo.sidecarConfig()
  if not cfg then
    return nil, err
  end
  local headers = {}
  if cfg.token and cfg.token != "" then
    headers.Authorization = "Bearer " .. cfg.token
  end
  local body, failure = memo.decodeResponse(pcall(net.proxyFetch, memo.buildUrl(cfg, endpoint, params), { headers = headers }))
  if not body then
    return nil, failure
  end
  return body, nil, cfg
end

-- POST variant of memo.request for the endpoints that take a JSON body (/api/ask). The
-- sidecar space goes into the body; net.proxyFetch JSON-encodes a table body itself.
function memo.requestJson(endpoint, fields)
  local cfg, err = memo.sidecarConfig()
  if not cfg then
    return nil, err
  end
  local headers = { ["content-type"] = "application/json" }
  if cfg.token and cfg.token != "" then
    headers.Authorization = "Bearer " .. cfg.token
  end
  local payload = { space = cfg.space }
  for k, v in pairs(fields or {}) do
    payload[k] = v
  end
  local body, failure = memo.decodeResponse(pcall(net.proxyFetch, cfg.base .. "/api/" .. endpoint,
    { method = "POST", headers = headers, body = payload }))
  if not body then
    return nil, failure
  end
  return body, nil, cfg
end

-- FTS snippets start with the section's context header, "[notes / Page > Heading] ...".
-- When the sidecar's excerpt is cut inside that header (no closing bracket) there is no
-- body text to show at all.
function memo.cleanSnippet(snippet, maxLen)
  local s = tostring(snippet or "")
  s = string.gsub(s, "^%[[^%]\n]*%]%s*", "")
  if string.find(s, "^%[[^%]]* / ") then
    s = ""
  end
  s = string.gsub(s, "%s+", " ")
  s = string.gsub(s, "^ ", "")
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
  return "Lexical " .. r(ranks.lexical) .. ", semantic " .. r(ranks.semantic) ..
    ", RRF score " .. (type(hit.score) == "number" and string.format("%.4f", hit.score) or "-")
end

-- Where a result opens: the section's heading line (`heading_line`, from the sidecar).
-- The sidecar's `line_start` is the first line of the section's text, i.e. the line AFTER the
-- heading, so it is only the fallback (older sidecars, or sections that have no heading line).
-- SilverBullet line refs (`Page@L<n>`) are 1-based, like both of these.
function memo.navRef(hit)
  local line = hit.heading_line
  if type(line) != "number" or line < 1 then
    line = hit.line_start
  end
  if type(line) == "number" and line >= 1 then
    return hit.page .. "@L" .. string.format("%d", line)
  end
  return hit.page
end

-- "Page › Heading › Subheading". The sidecar's first heading is usually the page's own title,
-- which the page name already says.
function memo.headingLabel(hit)
  local path = hit.heading_path
  if type(path) != "table" then
    return hit.page
  end
  local base = string.match(hit.page, "([^/]+)$") or hit.page
  local parts = { hit.page }
  for i, h in ipairs(path) do
    if not (i == 1 and (h == hit.page or h == base)) then
      table.insert(parts, h)
    end
  end
  return table.concat(parts, " › ")
end

-- /api/search body -> view rows. `details` adds the score badge.
function memo.searchRows(body, details)
  local rows = {}
  for _, hit in ipairs(body.results or {}) do
    table.insert(rows, {
      name = hit.page .. "@" .. tostring(hit.line_start),
      kind = "hit",
      page = hit.page,
      ref = memo.navRef(hit),
      title = memo.headingLabel(hit),
      snippet = memo.cleanSnippet(hit.snippet),
      badge = details and memo.scoreBadge(hit) or nil,
      badgeTitle = details and memo.scoreTitle(hit) or nil,
    })
  end
  return rows
end

local VIA_LABEL = { semantic = "similar", link = "linked", both = "similar + linked" }

-- /api/related body -> view rows.
function memo.relatedRows(body)
  local rows = {}
  for _, r in ipairs(body.results or {}) do
    local score = type(r.score) == "number" and r.score > 0 and string.format("%.2f", r.score) or nil
    table.insert(rows, {
      name = r.page,
      kind = "related",
      page = r.page,
      ref = r.page,
      title = r.page,
      badge = (VIA_LABEL[r.via] or tostring(r.via)) .. (score and (" · " .. score) or ""),
    })
  end
  return rows
end

function memo.messageRow(text, isError)
  local title, detail = string.match(text, "^([^\n]*)\n(.*)$")
  return {
    name = "memo-message",
    kind = "message",
    title = title or text,
    detail = detail,
    isError = isError or false,
  }
end
```

## Search
```space-lua
-- priority: -1
-- The Compact/Details segment only changes how rows are drawn, so repeating the same
-- query within a few seconds reuses the last answer instead of asking the sidecar again.
local lastSearch = nil
local CACHE_SECONDS = 15

local function searchRowsFor(phrase, details)
  local q = string.gsub(phrase or "", "^%s+", "")
  q = string.gsub(q, "%s+$", "")
  local cfg, err = memo.sidecarConfig()
  if not cfg then
    return { memo.messageRow(err, true) }
  end
  if q == "" then
    return { memo.messageRow("Type to search " .. cfg.space .. " by section (keywords or meaning)") }
  end
  local key = cfg.base .. "|" .. cfg.space .. "|" .. q
  local body
  if lastSearch and lastSearch.key == key and os.time() - lastSearch.at < CACHE_SECONDS then
    body = lastSearch.body
  else
    local res, failure = memo.request("search", { { "q", q }, { "limit", 20 } })
    if not res then
      return { memo.messageRow(failure, true) }
    end
    body = res
    lastSearch = { key = key, at = os.time(), body = body }
  end
  local rows = memo.searchRows(body, details)
  if #rows == 0 then
    return { memo.messageRow("No results for “" .. q .. "”") }
  end
  if body.warning then
    table.insert(rows, memo.messageRow(body.warning))
  end
  return rows
end

view.define {
  name = "memo.search",
  title = "Memo Search",
  placeholder = "Search sections…",
  command = "Memo: Search",
  key = "Ctrl-Shift-f",
  mac = "Cmd-Shift-f",
  dock = "modal",
  search = "source",
  segments = {
    { label = "Compact", default = true },
    { label = "Details" },
  },
  source = function(ctx)
    return searchRowsFor(ctx.phrase, ctx.segment == "Details")
  end,
  presentation = {
    row = {
      primary = "title",
      description = function(obj)
        if obj.kind == "hit" and obj.snippet != "" then
          return { text = obj.snippet }
        end
        return obj.detail
      end,
      decorations = function(obj)
        if obj.badge then
          return { { text = obj.badge, position = "right", title = obj.badgeTitle, cssClass = "sb-nav-chip-hint" } }
        end
      end,
      icon = function(obj)
        if obj.kind == "message" then
          return obj.isError and "alert-circle" or "search"
        end
        return "file-text"
      end,
    },
  },
  onSelect = function(obj)
    if obj.kind != "hit" then
      return false
    end
    editor.navigate(obj.ref)
  end,
}
```

## Related notes
```space-lua
-- priority: -1
local function relatedRowsFor()
  local page = editor.getCurrentPage()
  if not page or page == "" then
    return {}
  end
  local body, err = memo.request("related", { { "page", page }, { "limit", 8 } })
  if not body then
    return { memo.messageRow(err, true) }
  end
  local rows = memo.relatedRows(body)
  if #rows == 0 then
    return { memo.messageRow("No related notes found") }
  end
  return rows
end

view.define {
  name = "memo.related",
  title = "Related notes",
  command = "Memo: Related Notes",
  dock = "page-bottom",
  supportedDocks = { "page-bottom", "page-top", "rhs", "lhs", "bhs" },
  defaultOpen = false,
  refreshOn = { "editor:pageLoaded" },
  refreshOnOpen = true,
  source = relatedRowsFor,
  presentation = {
    row = {
      primary = "title",
      description = "detail",
      decorations = function(obj)
        if obj.badge then
          return { { text = obj.badge, position = "right", cssClass = "sb-nav-chip-hint" } }
        end
      end,
      icon = function(obj)
        if obj.kind == "message" then
          return obj.isError and "alert-circle" or "info"
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
