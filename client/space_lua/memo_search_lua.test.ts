import { readFile } from "node:fs/promises";
import { beforeAll, describe, expect, test } from "vitest";
import { extractSpaceLuaFromPageText } from "../boot_config.ts";
import { evalStatement } from "./eval.ts";
import { parseBlock } from "./parse.ts";
import { LuaEnv, LuaStackFrame } from "./runtime.ts";
import { luaBuildStandardEnv } from "./stdlib.ts";

// Everything the library touches outside the standard library is stubbed in Lua, so each
// case below is one Lua chunk: stubs, then the library, then the assertions.
const PRELUDE = `
local configValues = {}
config = {
  define = function() end,
  get = function(key, default)
    local v = configValues[key]
    if v == nil then return default end
    return v
  end,
}
function setConfig(v) configValues.memoSidecar = v end

views = {}
view = { define = function(spec) views[spec.name] = spec end }

navigated = {}
editor = {
  navigate = function(ref) table.insert(navigated, ref) end,
  getCurrentPage = function() return "Areas/Current Page" end,
}

fetches = {}
nextResponse = { ok = true, status = 200, headers = {}, body = { results = {} } }
net = {
  proxyFetch = function(url, opts)
    table.insert(fetches, { url = url, opts = opts })
    if nextResponse == "throw" then error("connection refused") end
    return nextResponse
  end,
}
`;

let librarySource = "";

beforeAll(async () => {
  const page = await readFile(
    new URL(
      "../../libraries/Library/Std/Editor/Memo Search.md",
      import.meta.url,
    ),
    "utf8",
  );
  librarySource = extractSpaceLuaFromPageText(page);
});

async function runLua(testBody: string) {
  const env = new LuaEnv(luaBuildStandardEnv());
  const block = parseBlock(`${PRELUDE}\n${librarySource}\n${testBody}`);
  const frame = LuaStackFrame.createWithGlobalEnv(env, block.ctx);
  await evalStatement(block, env, frame);
}

describe("Memo Search library", () => {
  test("the library defines both views, the command key and the helpers", async () => {
    await runLua(`
      assert(views["memo.search"], "search view")
      assert(views["memo.search"].key == "Ctrl-Shift-f", "key")
      assert(views["memo.search"].mac == "Cmd-Shift-f", "mac key")
      assert(views["memo.search"].search == "source", "server-side search")
      assert(views["memo.related"].dock == "page-bottom", "related dock")
      assert(views["memo.related"].defaultOpen == false, "related is closed until opened")
      assert(type(memo.searchRows) == "function")
    `);
  });

  test("normalizeBase accepts the documented spellings", async () => {
    await runLua(`
      assert(memo.normalizeBase("127.0.0.1:3010") == "127.0.0.1:3010")
      assert(memo.normalizeBase("/.proxy/127.0.0.1:3010") == "127.0.0.1:3010")
      assert(memo.normalizeBase("http://127.0.0.1:3010/") == "127.0.0.1:3010")
      assert(memo.normalizeBase("  https://memo.example.ts.net// ") == "memo.example.ts.net")
    `);
  });

  test("buildUrl encodes the query and puts space first", async () => {
    await runLua(`
      local url = memo.buildUrl({ base = "127.0.0.1:3010", space = "85memo" },
        "search", { { "q", "スウェット & a=b" }, { "limit", 20 }, { "skip", nil } })
      assert(url == "127.0.0.1:3010/api/search?space=85memo&q=" ..
        "%E3%82%B9%E3%82%A6%E3%82%A7%E3%83%83%E3%83%88%20%26%20a%3Db&limit=20", url)
    `);
  });

  test("sidecarConfig reports a helpful message when unset or incomplete", async () => {
    await runLua(`
      local cfg, err = memo.sidecarConfig()
      assert(cfg == nil and string.find(err, "memoSidecar", 1, true), err)
      setConfig({ url = "127.0.0.1:3010", token = "t" })
      cfg, err = memo.sidecarConfig()
      assert(cfg == nil and string.find(err, "space", 1, true), err)
      setConfig({ url = "/.proxy/127.0.0.1:3010", token = "t", space = "85memo" })
      cfg = memo.sidecarConfig()
      assert(cfg.base == "127.0.0.1:3010" and cfg.space == "85memo")
    `);
  });

  test("request sends the bearer token and returns the body", async () => {
    await runLua(`
      setConfig({ url = "127.0.0.1:3010", token = "secret", space = "85memo" })
      nextResponse = { ok = true, status = 200, headers = {}, body = { results = {} } }
      local body, err = memo.request("related", { { "page", "A/B" } })
      assert(body and not err, err)
      assert(fetches[1].url == "127.0.0.1:3010/api/related?space=85memo&page=A%2FB", fetches[1].url)
      assert(fetches[1].opts.headers.Authorization == "Bearer secret")
    `);
  });

  test("request turns proxy, HTTP and network failures into messages instead of errors", async () => {
    await runLua(`
      setConfig({ url = "127.0.0.1:3010", token = "secret", space = "85memo" })
      -- the proxy answers 200 and carries the upstream status in 'status'
      nextResponse = { ok = true, status = 401, headers = {}, body = { error = "unauthorized" } }
      local body, err = memo.request("search", { { "q", "x" } })
      assert(body == nil and string.find(err, "token", 1, true), err)
      nextResponse = { ok = true, status = 404, headers = {}, body = { error = "unknown space" } }
      body, err = memo.request("search", { { "q", "x" } })
      assert(body == nil and string.find(err, "unknown space", 1, true), err)
      -- proxy itself failed (sidecar down): outer 500 with a text body
      nextResponse = { ok = false, status = 500, headers = {}, body = "error sending request" }
      body, err = memo.request("search", { { "q", "x" } })
      assert(body == nil and string.find(err, "HTTP 500", 1, true), err)
      nextResponse = "throw"
      body, err = memo.request("search", { { "q", "x" } })
      assert(body == nil and string.find(err, "unreachable", 1, true), err)
    `);
  });

  test("searchRows maps hits to rows, strips the context header and optionally adds the badge", async () => {
    await runLua(`
      local body = { results = {
        { page = "Archive/キャンペーン", heading_path = { "Archive/キャンペーン", "結果" },
          line_start = 12, line_end = 20, score = 0.032787,
          ranks = { lexical = 2, semantic = 1 },
          snippet = "[85memo / Archive/キャンペーン > 結果] summary: x\\n本文  です" },
        { page = "Inbox/メモ", heading_path = {}, line_start = 3, line_end = 4, score = 0.01,
          ranks = { lexical = nil, semantic = 7 }, snippet = "plain" },
      } }
      local rows = memo.searchRows(body, false)
      assert(#rows == 2)
      assert(rows[1].ref == "Archive/キャンペーン@L12", rows[1].ref)
      assert(rows[1].title == "Archive/キャンペーン › 結果", rows[1].title)
      assert(rows[1].snippet == "summary: x 本文 です", rows[1].snippet)
      assert(rows[1].badge == nil)
      assert(rows[2].title == "Inbox/メモ")
      assert(memo.headingLabel({ page = "A/B", heading_path = { "B", "x", "B" } }) == "A/B › x › B")
      -- cut inside the header: nothing but the header, so no excerpt
      assert(memo.cleanSnippet("[85memo / Archive/スウェットキャン…") == "")
      assert(memo.cleanSnippet("…e/スウェット|キャン…") == "…e/スウェット|キャン…")
      rows = memo.searchRows(body, true)
      assert(rows[1].badge == "L2 S1 · 0.0328", rows[1].badge)
      assert(rows[2].badge == "L- S7 · 0.0100", rows[2].badge)
      assert(string.find(rows[1].badgeTitle, "RRF score 0.0328", 1, true), rows[1].badgeTitle)
    `);
  });

  test("messageRow splits a message into title and detail", async () => {
    await runLua(`
      local row = memo.messageRow("Title here\\nsecond line", true)
      assert(row.title == "Title here" and row.detail == "second line" and row.isError)
      row = memo.messageRow("single")
      assert(row.title == "single" and row.detail == nil and not row.isError)
    `);
  });

  test("navRef falls back to the bare page without a line", async () => {
    await runLua(`
      assert(memo.navRef({ page = "A", line_start = 1 }) == "A@L1")
      assert(memo.navRef({ page = "A" }) == "A")
    `);
  });

  test("navRef targets the heading line, not the first body line", async () => {
    await runLua(`
      -- sidecar: line_start is the line after the heading
      assert(memo.navRef({ page = "A", line_start = 14, heading_line = 13 }) == "A@L13")
      -- no heading line (preamble / continuation part): fall back to line_start
      assert(memo.navRef({ page = "A", line_start = 8, heading_line = nil }) == "A@L8")
      assert(memo.navRef({ page = "A", line_start = 8, heading_line = 0 }) == "A@L8")
    `);
  });

  test("relatedRows labels how a page is related", async () => {
    await runLua(`
      local rows = memo.relatedRows({ results = {
        { page = "A", score = 0.931, via = "both" },
        { page = "B", score = 0, via = "link" },
        { page = "C", score = 0.9, via = "semantic" },
      } })
      assert(rows[1].badge == "similar + linked · 0.93", rows[1].badge)
      assert(rows[2].badge == "linked", rows[2].badge)
      assert(rows[3].badge == "similar · 0.90", rows[3].badge)
      assert(rows[3].ref == "C")
    `);
  });

  test("the search view source degrades to message rows and caches repeated queries", async () => {
    await runLua(`
      local src = views["memo.search"].source
      -- unset
      local rows = src({ phrase = "abc" })
      assert(#rows == 1 and rows[1].kind == "message" and rows[1].isError)
      setConfig({ url = "127.0.0.1:3010", token = "t", space = "85memo" })
      -- empty phrase: hint, no request
      rows = src({ phrase = "  " })
      assert(rows[1].kind == "message" and not rows[1].isError and #fetches == 0)
      nextResponse = { ok = true, status = 200, headers = {}, body = { results = {
        { page = "P", heading_path = { "P" }, line_start = 1, line_end = 2, score = 0.02,
          ranks = { lexical = 1, semantic = 1 }, snippet = "hit" } } } }
      rows = src({ phrase = "query", segment = "Compact" })
      assert(rows[1].kind == "hit" and rows[1].badge == nil)
      rows = src({ phrase = "query", segment = "Details" })
      assert(rows[1].badge != nil)
      assert(#fetches == 1, "Details toggle must not re-query: " .. #fetches)
      -- errors never throw
      nextResponse = "throw"
      rows = src({ phrase = "another" })
      assert(rows[1].kind == "message" and rows[1].isError)
      -- selecting
      views["memo.search"].onSelect(rows[1])
      assert(#navigated == 0)
      local hit = memo.searchRows({ results = { { page = "P", heading_path = {}, line_start = 5, heading_line = 4 } } }, false)[1]
      views["memo.search"].onSelect(hit)
      assert(navigated[1] == "P@L4", navigated[1])
    `);
  });

  test("the related view asks for the current page", async () => {
    await runLua(`
      setConfig({ url = "127.0.0.1:3010", token = "t", space = "85memo" })
      nextResponse = { ok = true, status = 200, headers = {}, body = { results = {
        { page = "Other", score = 0.9, via = "semantic" } } } }
      local rows = views["memo.related"].source({ dock = "page-bottom" })
      assert(rows[1].ref == "Other")
      assert(string.find(fetches[1].url, "page=Areas%2FCurrent%20Page", 1, true), fetches[1].url)
    `);
  });
});

test("the library page has the shape the embedded build expects", () => {
  expect(librarySource).toContain('name = "memo.search"');
});
