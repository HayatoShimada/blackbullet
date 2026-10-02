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
opened = {}
defineCalls = 0
view = {
  define = function(spec) defineCalls = defineCalls + 1; views[spec.name] = spec end,
  open = function(name, opts) table.insert(opened, { name = name, opts = opts }) return true end,
}

pages = {}
space = {
  readPage = function(name)
    if pages[name] == nil then error("not found: " .. name) end
    return pages[name]
  end,
}

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
let pageSource = "";

beforeAll(async () => {
  const page = await readFile(
    new URL(
      "../../libraries/Library/Std/Editor/Memo Search.md",
      import.meta.url,
    ),
    "utf8",
  );
  pageSource = page;
  librarySource = extractSpaceLuaFromPageText(page);
});

async function runLua(testBody: string) {
  const env = new LuaEnv(luaBuildStandardEnv());
  const block = parseBlock(`${PRELUDE}\n${librarySource}\n${testBody}`);
  const frame = LuaStackFrame.createWithGlobalEnv(env, block.ctx);
  try {
    await evalStatement(block, env, frame);
  } catch (e: any) {
    // A Lua error carries its stack frame, which vitest cannot serialise: report the text.
    throw new Error(String(e?.message ?? e));
  }
}

describe("Search library", () => {
  test("the commands and views are defined on first evaluation, without any network call", async () => {
    await runLua(`
      assert(defineCalls == 2, "two views: " .. defineCalls)
      assert(#fetches == 0, "no sidecar probing while registering")
      assert(views["memo.search"], "search view")
      assert(views["memo.search"].command == "Search: Notes", views["memo.search"].command)
      assert(views["memo.search"].key == "Ctrl-q s", "key")
      assert(views["memo.search"].mac == nil, "Cmd-q quits the browser: no mac key")
      assert(views["memo.search"].title == "Search" and views["memo.search"].placeholder == "Search your notes…")
      assert(views["memo.search"].search == "source", "server-side search")
      assert(views["memo.search"].segments == nil, "no Compact/Details segments")
      assert(views["memo.related"].command == "Search: Related Notes")
      assert(views["memo.related"].key == "Ctrl-q r" and views["memo.related"].mac == nil)
      assert(views["memo.related"].title == "Related notes")
      assert(views["memo.related"].dock == "page-bottom", "related dock")
      assert(views["memo.related"].defaultOpen == false, "related is closed until opened")
      assert(type(memo.searchRows) == "function")
    `);
  });

  test("the page registers early, speaks no 'Memo:' and binds no Ctrl-Shift-f", () => {
    expect(pageSource).not.toMatch(/Shift-f/i);
    expect(pageSource).not.toContain("Memo:");
    expect(pageSource).not.toContain("flashNotification");
    // registration runs before the user's CONFIG (priority 0) and after the helpers (10); the old -1
    // ran after the sidecar probing and made the commands appear seconds late
    const priorities = pageSource
      .split("```space-lua")
      .slice(1)
      .map((block) =>
        Number(block.split("\n")[1].replace("-- priority: ", "")),
      );
    expect(priorities).toEqual([10, 9, 9]);
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
      local url = memo.buildUrl({ base = "127.0.0.1:3010", space = "notes" },
        "search", { { "q", "在庫 & a=b" }, { "limit", 20 }, { "skip", nil } })
      assert(url == "127.0.0.1:3010/api/search?space=notes&q=" ..
        "%E5%9C%A8%E5%BA%AB%20%26%20a%3Db&limit=20", url)
    `);
  });

  test("sidecarConfig says what is off and what to do when unset or incomplete", async () => {
    await runLua(`
      local cfg, err, kind = memo.sidecarConfig()
      assert(cfg == nil and kind == "off", tostring(kind))
      assert(err == "Search by meaning is off. Start it with ./setup.sh or set memoSidecar in CONFIG.", err)
      setConfig({ url = "127.0.0.1:3010", token = "t" })
      cfg, err, kind = memo.sidecarConfig()
      assert(cfg == nil and kind == "error" and string.find(err, "memoSidecar.space", 1, true), err)
      setConfig({ url = "/.proxy/127.0.0.1:3010", token = "t", space = "notes" })
      cfg = memo.sidecarConfig()
      assert(cfg.base == "127.0.0.1:3010" and cfg.space == "notes" and cfg.debug == false)
      setConfig({ url = "127.0.0.1:3010", token = "t", space = "notes", debug = true })
      assert(memo.sidecarConfig().debug == true)
    `);
  });

  test("request sends the bearer token and returns the body", async () => {
    await runLua(`
      setConfig({ url = "127.0.0.1:3010", token = "secret", space = "notes" })
      nextResponse = { ok = true, status = 200, headers = {}, body = { results = {} } }
      local body, err = memo.request("related", { { "page", "A/B" } })
      assert(body and not err, err)
      assert(fetches[1].url == "127.0.0.1:3010/api/related?space=notes&page=A%2FB", fetches[1].url)
      assert(fetches[1].opts.headers.Authorization == "Bearer secret")
    `);
  });

  test("request turns proxy, HTTP and network failures into sentences instead of errors", async () => {
    await runLua(`
      setConfig({ url = "127.0.0.1:3010", token = "secret", space = "notes" })
      -- the proxy answers 200 and carries the upstream status in 'status'
      nextResponse = { ok = true, status = 401, headers = {}, body = { error = "unauthorized" } }
      local body, err, kind = memo.request("search", { { "q", "x" } })
      assert(body == nil and kind == "error" and string.find(err, "token", 1, true), err)
      nextResponse = { ok = true, status = 404, headers = {}, body = { error = "unknown space" } }
      body, err = memo.request("search", { { "q", "x" } })
      assert(body == nil and string.find(err, "unknown space", 1, true) and string.find(err, "memoSidecar.space", 1, true), err)
      nextResponse = { ok = true, status = 503, headers = {}, body = "busy" }
      body, err, kind = memo.request("search", { { "q", "x" } })
      assert(body == nil and kind == "error" and string.find(err, "HTTP 503", 1, true), err)
      -- proxy itself failed (nothing listens): outer 500 with a text body
      nextResponse = { ok = false, status = 500, headers = {}, body = "error sending request" }
      body, err, kind = memo.request("search", { { "q", "x" } })
      assert(body == nil and kind == "off" and err == memo.OFF, err)
      nextResponse = "throw"
      body, err, kind = memo.request("search", { { "q", "x" } })
      assert(body == nil and kind == "off" and err == memo.OFF, err)
    `);
  });

  test("searchRows maps hits to rows with the body text, not the path or frontmatter", async () => {
    await runLua(`
      pages["Projects/Spring Launch"] = table.concat({
        "---", "tags: project", "status: active", "---",
        "# Spring Launch", "", "The launch is on 2026-10-14. Everything else is a detail.",
        "", "## Next actions", "* [ ] Finish product photos", "* [ ] Email the [[Areas/Marketing|marketing]] list",
      }, "\\n")
      local body = { results = {
        { page = "Projects/Spring Launch", heading_path = { "Spring Launch" },
          line_start = 1, line_end = 7, heading_line = nil, score = 0.0328,
          ranks = { lexical = 2, semantic = 1 }, snippet = "…ts/Spring Launch tags: pro…" },
        { page = "Projects/Spring Launch", heading_path = { "Spring Launch", "Next actions" },
          line_start = 10, line_end = 11, heading_line = 9, score = 0.02,
          ranks = { lexical = nil, semantic = 7 }, snippet = "…tags: pro…" },
        { page = "Inbox/メモ", heading_path = {}, line_start = 3, line_end = 4, score = 0.01,
          ranks = { lexical = nil, semantic = 7 }, snippet = "[notes / Inbox/メモ > x] plain  text" },
      } }
      local rows = memo.searchRows(body, { phrase = "launch" })
      assert(#rows == 3)
      assert(rows[1].kind == "hit" and rows[1].ref == "Projects/Spring Launch@L1", rows[1].ref)
      -- Page › Section, the page by its last segment; the folder is apart
      assert(rows[1].title == "Spring Launch", rows[1].title)
      assert(rows[2].title == "Spring Launch › Next actions", rows[2].title)
      assert(rows[1].folder == "Projects" and rows[3].folder == "Inbox")
      -- the sentence with the first query term, no frontmatter, no heading
      assert(rows[1].snippet == "The launch is on 2026-10-14.", rows[1].snippet)
      assert(rows[1].highlights[1][1] == 4 and rows[1].highlights[1][2] == 10, rows[1].highlights[1][1])
      -- no matching sentence: the start of the section, list markers and link syntax removed
      assert(rows[2].snippet == "Finish product photos Email the marketing list", rows[2].snippet)
      -- the page cannot be read: the sidecar's excerpt, its header stripped
      assert(rows[3].snippet == "plain text", rows[3].snippet)
      assert(rows[1].badge == nil and rows[2].badge == nil, "no ranking numbers by default")
      assert(string.find(rows[1].tip, "score 0.0328", 1, true), rows[1].tip)
      rows = memo.searchRows(body, { phrase = "launch", debug = true })
      assert(rows[1].badge == "L2 S1 · 0.0328", rows[1].badge)
      assert(rows[3].badge == "L- S7 · 0.0100", rows[3].badge)
    `);
  });

  test("bodySnippet picks the sentence of the first term and ellipsises long text", async () => {
    await runLua(`
      local text, hl = memo.bodySnippet({ "Nothing here. The Budget is tight. Last one." }, "budget tight")
      assert(text == "The Budget is tight.", text)
      assert(#hl == 2 and hl[1][1] == 4 and hl[1][2] == 10 and hl[2][1] == 14 and hl[2][2] == 19, #hl)
      -- term order decides, not sentence order
      text = memo.bodySnippet({ "alpha beta. gamma delta." }, "delta alpha")
      assert(text == "gamma delta.", text)
      -- Japanese full stop
      text = memo.bodySnippet({ "在庫を数える。発注は金曜日。" }, "発注")
      assert(text == "発注は金曜日。", text)
      -- long sentence: cut around the match, with ellipses
      local long = string.rep("x ", 100) .. "needle " .. string.rep("y ", 100)
      text = memo.bodySnippet({ long }, "needle")
      assert(#text <= 162 and string.find(text, "needle", 1, true), #text)
      assert(string.sub(text, 1, 1) == "…" and string.sub(text, -1) == "…")
      -- fallback: first 160 characters
      text, hl = memo.bodySnippet({ string.rep("a", 300) }, "zzz")
      assert(#text == 161 and string.sub(text, -1) == "…" and #hl == 0, #text)
      assert(memo.bodySnippet({ "short" }, "") == "short")
    `);
  });

  test("sectionLines strips frontmatter and headings from the page itself", async () => {
    await runLua(`
      pages["A"] = "---\\ntags: x\\n---\\n# Title\\nbody one\\n\\n## Sub\\n* [x] done task\\n1. numbered"
      local cache = {}
      local lines = memo.sectionLines({ page = "A", line_start = 1, line_end = 10 }, cache)
      assert(table.concat(lines, "|") == "body one|done task|numbered", table.concat(lines, "|"))
      pages["B"] = "Open **Projects** with \`Ctrl-q s\`."
      assert(memo.sectionLines({ page = "B", line_start = 1, line_end = 1 }, cache)[1] == "Open Projects with Ctrl-q s.")
      assert(memo.sectionLines({ page = "Missing", line_start = 1, line_end = 2 }, cache) == nil)
      assert(cache["Missing"] == false, "a failed read is remembered for this search")
      assert(memo.sectionLines({ page = "A", kind = "pdf", line_start = 0 }, cache) == nil)
    `);
  });

  test("messageRow and countRow are passive", async () => {
    await runLua(`
      local row = memo.messageRow("A sentence.", true)
      assert(row.title == "A sentence." and row.isError and row.passive == true and row.kind == "message")
      row = memo.countRow("3 sections for x")
      assert(row.passive == true and row.cssClass == "sb-nav-count" and row.kind == "count")
      local src = views["memo.search"].presentation.row
      assert(src.passive({ passive = true }) == true and src.passive({ kind = "hit" }) == false)
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

  test("document hits carry a kind chip and open the PDF page only when pdfPages is on", async () => {
    await runLua(`
      local pdf = { page = "Images/report.pdf", kind = "pdf", unit = "p.3", unit_no = 3, heading_path = { "report.pdf p.3" }, line_start = 0, heading_line = nil }
      assert(memo.docLabel(pdf) == "PDF p.3")
      assert(memo.docLabel({ page = "A", kind = "md" }) == nil and memo.docLabel({ page = "A" }) == nil)
      assert(memo.docLabel({ kind = "docx" }) == "DOCX")
      assert(memo.headingLabel(pdf) == "Images/report.pdf [PDF p.3]", memo.headingLabel(pdf))
      -- a row names the file; the kind is its own chip
      assert(memo.headingLabel(pdf, true) == "report.pdf", memo.headingLabel(pdf, true))
      -- slide with a note-like heading kept
      local sl = { page = "D/x.pptx", kind = "pptx", unit = "slide.2", unit_no = 2, heading_path = { "x.pptx slide.2" } }
      assert(memo.headingLabel(sl) == "D/x.pptx [PPTX slide.2]", memo.headingLabel(sl))
      assert(memo.headingLabel({ page = "A", heading_path = { "A", "H" } }) == "A › H")
      assert(memo.headingLabel({ page = "A/B", heading_path = { "B", "x", "B" } }) == "A/B › x › B")
      -- default: the bare file (a viewer may not understand #page=N)
      setConfig({ url = "127.0.0.1:3010", token = "t", space = "notes" })
      assert(memo.navRef(pdf) == "Images/report.pdf", memo.navRef(pdf))
      setConfig({ url = "127.0.0.1:3010", token = "t", space = "notes", pdfPages = true })
      assert(memo.navRef(pdf) == "Images/report.pdf#page=3", memo.navRef(pdf))
      -- slides and notes never get a page fragment
      assert(memo.navRef(sl) == "D/x.pptx")
      assert(memo.navRef({ page = "A", line_start = 2, heading_line = 1 }) == "A@L1")
      local row = memo.searchRows({ results = { pdf } }, {})[1]
      assert(row.docLabel == "PDF p.3" and row.ref == "Images/report.pdf#page=3", row.ref)
      assert(memo.cleanSnippet("[notes / Archive/在庫キャン…") == "")
      assert(memo.cleanSnippet("…e/在庫|キャン…") == "…e/在庫|キャン…")
    `);
  });

  test("searchParseScope reads kind:, in: and folder: words and leaves the rest", async () => {
    await runLua(`
      local q, sc = memo.searchParseScope('kind:PDF in:Receipts invoice 2026')
      assert(q == "invoice 2026" and sc.kind == "pdf" and sc.prefix == "Receipts/", q)
      q, sc = memo.searchParseScope('folder:"My Notes/" kind:doc')
      assert(q == "" and sc.kind == "doc" and sc.prefix == "My Notes/")
      q, sc = memo.searchParseScope("plain words kind:pdf")
      assert(q == "plain words kind:pdf" and next(sc) == nil, q)
      q, sc = memo.searchParseScope("note: x")
      assert(q == "note: x" and next(sc) == nil)
      q, sc = memo.searchParseScope(nil)
      assert(q == "" and next(sc) == nil)
    `);
  });

  test("the search view sends kind and prefix and keys its cache on them", async () => {
    await runLua(`
      setConfig({ url = "127.0.0.1:3010", token = "t", space = "notes" })
      nextResponse = { ok = true, status = 200, headers = {}, body = { results = {
        { page = "R/a.pdf", kind = "pdf", unit = "p.1", unit_no = 1, heading_path = { "a.pdf p.1" }, line_start = 0, snippet = "x",
          ranks = { lexical = 1 } } } } }
      local src = views["memo.search"].source
      local rows = src({ phrase = "kind:pdf in:R invoice" })
      local url = fetches[#fetches].url
      assert(string.find(url, "q=invoice", 1, true) and string.find(url, "kind=pdf", 1, true) and string.find(url, "prefix=R%2F", 1, true), url)
      assert(rows[1].kind == "count" and rows[1].title == "1 section for invoice", rows[1].title)
      assert(rows[2].title == "a.pdf" and rows[2].docLabel == "PDF p.1", rows[2].title)
      local n = #fetches
      src({ phrase = "invoice" })
      assert(#fetches == n + 1, "a different scope must not reuse the cache")
      src({ phrase = "invoice" })
      assert(#fetches == n + 1, "the same query is served from the cache")
      -- scope words alone: a hint that names them, no request
      rows = src({ phrase = "kind:pdf" })
      assert(#fetches == n + 1 and rows[1].kind == "message" and not rows[1].isError)
      assert(string.find(rows[2].title, "in:Folder/", 1, true), rows[2].title)
    `);
  });

  test("an empty phrase is a quiet hint; the scope hint shows only for scope words or ?", async () => {
    await runLua(`
      setConfig({ url = "127.0.0.1:3010", token = "t", space = "notes" })
      local src = views["memo.search"].source
      local rows = src({ phrase = "  " })
      assert(#rows == 1 and rows[1].passive == true and #fetches == 0)
      rows = src({ phrase = "?" })
      assert(#rows == 2 and #fetches == 0, #rows)
      rows = src({ phrase = "in:Projects/" })
      assert(#rows == 2)
      -- a scope word still being typed is not searched for
      rows = src({ phrase = "in:" })
      assert(#rows == 2 and #fetches == 0 and rows[2].passive == true, #rows)
      rows = src({ phrase = "kind:" })
      assert(#rows == 2 and #fetches == 0)
    `);
  });

  test("results start with a passive count; the first selectable row is the first hit", async () => {
    await runLua(`
      setConfig({ url = "127.0.0.1:3010", token = "t", space = "notes" })
      nextResponse = { ok = true, status = 200, headers = {}, body = { results = {
        { page = "P", heading_path = { "P" }, line_start = 1, line_end = 2, score = 0.02,
          ranks = { lexical = 1, semantic = 1 }, snippet = "hit" },
        { page = "Q", heading_path = { "Q" }, line_start = 1, line_end = 2, score = 0.01,
          ranks = { lexical = 2, semantic = 2 }, snippet = "hit" } } } }
      local rows = views["memo.search"].source({ phrase = "query" })
      assert(rows[1].title == "2 sections for query" and rows[1].passive == true)
      assert(rows[1].cssClass == "sb-nav-count")
      assert(rows[2].kind == "hit" and rows[2].passive == nil)
      local presentation = views["memo.search"].presentation.row
      assert(presentation.passive(rows[1]) == true and presentation.passive(rows[2]) == false)
      -- a word-only answer says so, after the results
      nextResponse.body.warning = "意味検索が今は使えません"
      rows = views["memo.search"].source({ phrase = "another" })
      local last = rows[#rows]
      assert(last.passive == true and not string.find(last.title, "意味", 1, true), last.title)
      -- nothing holds the words, only the meaning is near: say that
      nextResponse = { ok = true, status = 200, headers = {}, body = { results = {
        { page = "P", heading_path = { "P" }, line_start = 1, line_end = 2, score = 0.01,
          ranks = { lexical = nil, semantic = 3 }, snippet = "hit" } } } }
      rows = views["memo.search"].source({ phrase = "worries" })
      assert(rows[1].title == "Closest by meaning to worries", rows[1].title)
      -- a meaning-only answer is capped at a few rows, not twenty that look like matches
      local many = {}
      for i = 1, 8 do
        table.insert(many, { page = "P" .. i, heading_path = { "P" }, line_start = 1, line_end = 2, score = 0.01,
          ranks = { semantic = i }, snippet = "hit" })
      end
      nextResponse = { ok = true, status = 200, headers = {}, body = { results = many } }
      rows = views["memo.search"].source({ phrase = "zzzqqq" })
      assert(#rows == 6 and rows[1].title == "Closest by meaning to zzzqqq", #rows)
      -- no hits
      nextResponse = { ok = true, status = 200, headers = {}, body = { results = {} } }
      rows = views["memo.search"].source({ phrase = "zzz" })
      assert(#rows == 1 and rows[1].passive == true and rows[1].title ==
        "No sections match zzz. Try fewer words, or in:Folder/ to narrow.", rows[1].title)
    `);
  });

  test("the row shows the matched text, the folder and the kind, and no scores unless debug is on", async () => {
    await runLua(`
      local row = memo.searchRows({ results = { { page = "Projects/A", heading_path = { "A", "B" }, line_start = 3,
        line_end = 4, heading_line = 2, score = 0.02, ranks = { lexical = 1, semantic = 3 }, snippet = "x" } } }, {})[1]
      local p = views["memo.search"].presentation.row
      local d = p.decorations(row)
      assert(#d == 1 and d[1].text == "Projects" and string.find(d[1].title, "Projects/A", 1, true), #d)
      assert(string.find(d[1].title, "score 0.0200", 1, true), d[1].title)
      row = memo.searchRows({ results = { { page = "Projects/A", heading_path = { "A" }, line_start = 3,
        line_end = 4, score = 0.02, ranks = { lexical = 1, semantic = 3 }, snippet = "x" } } }, { debug = true })[1]
      d = p.decorations(row)
      assert(#d == 2 and d[1].text == "L1 S3 · 0.0200", d[1].text)
      local desc = p.description(row)
      assert(desc.text == "x", desc.text)
    `);
  });

  test("with the sidecar off the search view says so and offers to open a page by that name", async () => {
    await runLua(`
      local src = views["memo.search"].source
      local rows = src({ phrase = "launch" })
      assert(#rows == 2 and #fetches == 0)
      assert(rows[1].passive == true and rows[1].title == memo.OFF, rows[1].title)
      assert(rows[2].kind == "openpage" and rows[2].passive == nil and rows[2].phrase == "launch")
      assert(rows[2].title == "Open a page named “launch” instead", rows[2].title)
      -- choosing it runs the page picker with the phrase
      assert(views["memo.search"].onSelect(rows[2]) == false)
      assert(opened[1].name == "std.pages" and opened[1].opts.phrase == "launch")
      -- nothing typed: just the sentence
      rows = src({ phrase = "" })
      assert(#rows == 1 and rows[1].title == memo.OFF)
      -- a sidecar that answers badly: the sentence, plus the same way forward; errors never throw
      setConfig({ url = "127.0.0.1:3010", token = "t", space = "notes" })
      nextResponse = "throw"
      rows = src({ phrase = "another" })
      assert(rows[1].passive == true and rows[1].title == memo.OFF and rows[2].kind == "openpage")
      nextResponse = { ok = true, status = 401, headers = {}, body = { error = "unauthorized" } }
      rows = src({ phrase = "third" })
      assert(rows[1].isError == true and string.find(rows[1].title, "token", 1, true), rows[1].title)
      -- selecting a hit navigates; selecting a sentence does nothing
      views["memo.search"].onSelect(rows[1])
      assert(#navigated == 0)
      local hit = memo.searchRows({ results = { { page = "P", heading_path = {}, line_start = 5, heading_line = 4 } } }, {})[1]
      views["memo.search"].onSelect(hit)
      assert(navigated[1] == "P@L4", navigated[1])
    `);
  });

  test("relatedRows count the pages and say Similar, Linked or both, with the number only in the tooltip", async () => {
    await runLua(`
      local rows = memo.relatedRows({ results = {
        { page = "A", score = 0.931, via = "both" },
        { page = "B", score = 0, via = "link" },
        { page = "C", score = 0.9, via = "semantic" },
      } })
      assert(#rows == 4)
      assert(rows[1].kind == "count" and rows[1].passive == true and rows[1].title == "3 related pages", rows[1].title)
      assert(rows[2].badge == "Similar · Linked" and rows[2].tip == "Similarity 0.93", rows[2].badge)
      assert(rows[3].badge == "Linked" and rows[3].tip == nil, rows[3].badge)
      assert(rows[4].badge == "Similar" and rows[4].ref == "C")
      for _, r in ipairs(rows) do
        assert(not string.find(r.badge or "", "%d"), "no digits in a badge: " .. tostring(r.badge))
      end
      assert(memo.relatedRows({ results = { { page = "A", via = "link" } } })[1].title == "1 related page")
      -- nothing related: a passive sentence
      rows = memo.relatedRows({ results = {} })
      assert(#rows == 1 and rows[1].passive == true and rows[1].title ==
        "Nothing related yet. Links from this page will show here.", rows[1].title)
    `);
  });

  test("related rows are named by the page (last segment) with the folder as a dim crumb", async () => {
    await runLua(`
      local rows = memo.relatedRows({ results = {
        { page = "Projects/Plans/Spring Launch", score = 0.8, via = "semantic" },
        { page = "Index", via = "link" },
      } })
      assert(rows[2].title == "Spring Launch", rows[2].title)
      assert(rows[2].folder == "Projects/Plans" and rows[2].ref == "Projects/Plans/Spring Launch")
      assert(rows[3].title == "Index" and rows[3].folder == nil, tostring(rows[3].folder))
      local deco = views["memo.related"].presentation.row.decorations(rows[2])
      assert(#deco == 2, #deco)
      assert(deco[1].cssClass == "sb-nav-crumb" and deco[1].text == "Projects/Plans" and deco[1].title == "Projects/Plans/Spring Launch")
      assert(deco[2].text == "Similar", deco[2].text)
      deco = views["memo.related"].presentation.row.decorations(rows[3])
      assert(#deco == 1 and deco[1].text == "Linked")
      for _, r in ipairs(rows) do
        assert(not string.find(r.title, "/", 1, true), "no path in a title: " .. r.title)
      end
    `);
  });

  test("the related view asks for the current page and says when search is off", async () => {
    await runLua(`
      local rows = views["memo.related"].source({ dock = "page-bottom" })
      assert(#rows == 1 and rows[1].passive == true and rows[1].title ==
        "Related notes need Search by meaning. Start it with ./setup.sh.", rows[1].title)
      setConfig({ url = "127.0.0.1:3010", token = "t", space = "notes" })
      nextResponse = { ok = true, status = 200, headers = {}, body = { results = {
        { page = "Other", score = 0.9, via = "semantic" } } } }
      rows = views["memo.related"].source({ dock = "page-bottom" })
      assert(rows[1].kind == "count" and rows[2].ref == "Other")
      assert(string.find(fetches[1].url, "page=Areas%2FCurrent%20Page", 1, true), fetches[1].url)
      local deco = views["memo.related"].presentation.row.decorations(rows[2])
      assert(deco[1].text == "Similar" and deco[1].title == "Similarity 0.90")
      -- selecting
      assert(views["memo.related"].onSelect(rows[1]) == false)
      views["memo.related"].onSelect(rows[2])
      assert(navigated[1] == "Other")
    `);
  });
});

test("the library page has the shape the embedded build expects", () => {
  expect(librarySource).toContain('name = "memo.search"');
});
