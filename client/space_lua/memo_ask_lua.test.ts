// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada
import { readFile } from "node:fs/promises";
import { beforeAll, describe, expect, test } from "vitest";
import { extractSpaceLuaFromPageText } from "../boot_config.ts";
import { evalStatement } from "./eval.ts";
import { parseBlock } from "./parse.ts";
import { LuaEnv, LuaStackFrame } from "./runtime.ts";
import { luaBuildStandardEnv } from "./stdlib.ts";

// Same shape as memo_search_lua.test.ts: everything outside the standard library is a Lua
// stub, and net.proxyFetch answers from a queue (the sidecar reply, then the API reply).
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
function setConfig(key, v) configValues[key] = v end

views = {}
opened = {}
view = {
  define = function(spec) views[spec.name] = spec end,
  open = function(name, opts) table.insert(opened, name) return true end,
}

commands = {}
command = { define = function(spec) commands[spec.name] = spec end }

navigated = {}
notifications = {}
promptAnswer = nil
promptQueue = {}
prompts = {}
reloaded = 0
pages = {}
pickIndex = 1
writtenPages = {}
space = {
  pageExists = function(name) return writtenPages[name] ~= nil or pages[name] ~= nil end,
  readPage = function(name) return writtenPages[name] or pages[name] end,
  writePage = function(name, text) writtenPages[name] = text end,
}
editor = {
  navigate = function(ref) table.insert(navigated, ref) end,
  getCurrentPage = function() return "Areas/Current Page" end,
  prompt = function(message, default) table.insert(prompts, { message = message, default = default })
    if #promptQueue > 0 then return table.remove(promptQueue, 1) end
    return promptAnswer
  end,
  reloadConfigAndCommands = function() reloaded = reloaded + 1 end,
  filterBox = function(title, options) return options[pickIndex] end,
  flashNotification = function(message, kind) table.insert(notifications, { message = message, kind = kind }) end,
}

fetches = {}
queue = {}
nextResponse = { ok = true, status = 200, headers = {}, body = { results = {} } }
net = {
  proxyFetch = function(url, opts)
    table.insert(fetches, { url = url, opts = opts })
    local r = nextResponse
    if #queue > 0 then r = table.remove(queue, 1) end
    if r == "throw" then error("connection refused") end
    return r
  end,
}

function errorMessages()
  local out = {}
  for _, n in ipairs(notifications) do
    if n.kind == "error" then table.insert(out, n.message) end
  end
  return out
end

SIDECAR = { ok = true, status = 200, headers = {}, body = {
  question = "when is the launch", mode = "lexical", confidential = false,
  sections = {
    { page = "Projects/Demo", heading_path = { "Demo", "Outcome" }, heading_line = 5,
      line_start = 6, line_end = 8, ref = "Projects/Demo@L5",
      text = "Ship the demo launch campaign by the end of September." },
    { page = "Journal/2026-09-20", heading_path = { "2026-09-20", "Done" }, heading_line = 3,
      line_start = 4, line_end = 4, ref = "Journal/2026-09-20@L3",
      text = "Wrote the newsletter for the demo launch." },
  },
} }

API = { ok = true, status = 200, headers = {}, body = {
  id = "msg_1", type = "message", role = "assistant", model = "claude-opus-5-5",
  stop_reason = "end_turn", stop_details = nil,
  content = {
    { type = "thinking", thinking = "" },
    { type = "text", text = "By the end of September [1]. The newsletter is written [2]." },
  },
  usage = { input_tokens = 100, output_tokens = 20 },
} }

function configureAll()
  setConfig("memoSidecar", { url = "127.0.0.1:3010", token = "secret", space = "notes" })
  setConfig("memoAsk", { apiKey = "sk-ant-test" })
end
`;

let librarySource = "";

beforeAll(async () => {
  const sources: string[] = [];
  for (const file of ["Memo Search.md", "Memo Ask.md"]) {
    const page = await readFile(
      new URL(`../../libraries/Library/Std/Editor/${file}`, import.meta.url),
      "utf8",
    );
    sources.push(extractSpaceLuaFromPageText(page));
  }
  librarySource = sources.join("\n");
});

async function runLua(testBody: string) {
  const env = new LuaEnv(luaBuildStandardEnv());
  const block = parseBlock(`${PRELUDE}\n${librarySource}\n${testBody}`);
  const frame = LuaStackFrame.createWithGlobalEnv(env, block.ctx);
  await evalStatement(block, env, frame);
}

describe("Memo Ask library", () => {
  test("scope: kind and in: are parsed, lower-cased and sent as kind / prefix", async () => {
    await runLua(`
      local q, sc = memo.askParseScope("kind:PDF in:Receipts what is the total?")
      assert(q == "what is the total?" and sc.kind == "pdf" and sc.folder == "Receipts/", q)
      local f = memo.askScopeFields(sc)
      assert(f.kind == "pdf" and f.prefix == "Receipts/" and f.folder == nil)
      assert(memo.askScopeLabel(sc) == "folder:Receipts/ kind:pdf", memo.askScopeLabel(sc))
      assert(memo.askMergeScope({ kind = "doc" }, { folder = "A/" }).kind == "doc")
    `);
  });

  test("document sources show their kind and cite the file (page link only with pdfPages)", async () => {
    await runLua(`
      local pdf = { page = "Images/report.pdf", kind = "pdf", unit = "p.3", unit_no = 3, ref = "Images/report.pdf",
        heading_path = { "report.pdf p.3" }, line_start = 0, text = "total 42" }
      assert(memo.askRef(pdf) == "Images/report.pdf")
      assert(string.find(memo.askPrompt("q", { pdf }), "[1] Images/report.pdf [PDF p.3] (Images/report.pdf)", 1, true), memo.askPrompt("q", { pdf }))
      assert(string.find(memo.askBody("See [1].", { pdf }), "1. [[Images/report.pdf]] — Images/report.pdf [PDF p.3]", 1, true), memo.askBody("See [1].", { pdf }))
      setConfig("memoSidecar", { url = "127.0.0.1:3010", token = "secret", space = "notes", pdfPages = true })
      assert(memo.askRef(pdf) == "Images/report.pdf#page=3", memo.askRef(pdf))
    `);
  });

  test("defines the command, the modal view and the helpers", async () => {
    await runLua(`
      assert(commands["Memo: Ask"] and type(commands["Memo: Ask"].run) == "function", "command")
      assert(views["memo.ask"].dock == "modal", "modal")
      assert(type(views["memo.ask"].content) == "function", "content view")
      assert(string.find(views["memo.ask"].content({ dock = "modal" }), "Memo: Ask", 1, true), "empty state")
      assert(type(memo.requestJson) == "function" and type(memo.askConfig) == "function")
    `);
  });

  test("askConfig applies the defaults and clamps k", async () => {
    await runLua(`
      local cfg, err = memo.askConfig()
      assert(cfg == nil and string.find(err, "memoAsk", 1, true), err)
      setConfig("memoAsk", { apiKey = "" })
      cfg, err = memo.askConfig()
      assert(cfg == nil and string.find(err, "apiKey", 1, true), err)
      setConfig("memoAsk", { apiKey = "k" })
      cfg = memo.askConfig()
      assert(cfg.model == "claude-opus-5-5" and cfg.maxTokens == 4096 and cfg.k == 8, "defaults")
      assert(cfg.allowConfidential == false)
      setConfig("memoAsk", { apiKey = "k", model = "m", maxTokens = 100, k = 99, allowConfidential = true })
      cfg = memo.askConfig()
      assert(cfg.model == "m" and cfg.maxTokens == 100 and cfg.k == 20 and cfg.allowConfidential, "custom")
    `);
  });

  test("requestJson POSTs JSON with the token and the space in the body", async () => {
    await runLua(`
      configureAll()
      nextResponse = { ok = true, status = 200, headers = {}, body = { sections = {} } }
      local body, err = memo.requestJson("ask", { q = "x", k = 3 })
      assert(body and not err, err)
      local f = fetches[1]
      assert(f.url == "127.0.0.1:3010/api/ask", f.url)
      assert(f.opts.method == "POST")
      assert(f.opts.headers.Authorization == "Bearer secret")
      assert(f.opts.headers["content-type"] == "application/json")
      assert(f.opts.body.space == "notes" and f.opts.body.q == "x" and f.opts.body.k == 3)
      -- failures become messages, like memo.request
      nextResponse = { ok = true, status = 401, headers = {}, body = { error = "unauthorized" } }
      body, err = memo.requestJson("ask", { q = "x" })
      assert(body == nil and string.find(err, "token", 1, true), err)
      nextResponse = "throw"
      body, err = memo.requestJson("ask", { q = "x" })
      assert(body == nil and string.find(err, "unreachable", 1, true), err)
    `);
  });

  test("happy path: sidecar sections go to the API and the answer is shown with links", async () => {
    await runLua(`
      configureAll()
      promptAnswer = "  when is the launch "
      queue = { SIDECAR, API }
      commands["Memo: Ask"].run()
      assert(#fetches == 2, "sidecar then API: " .. #fetches)
      assert(fetches[1].opts.body.q == "when is the launch" and fetches[1].opts.body.k == 8)
      local api = fetches[2]
      assert(api.url == "api.anthropic.com/v1/messages", api.url)
      assert(api.opts.method == "POST")
      assert(api.opts.headers["x-api-key"] == "sk-ant-test")
      assert(api.opts.headers["anthropic-version"] == "2023-06-01")
      assert(api.opts.headers["content-type"] == "application/json")
      assert(api.opts.body.model == "claude-opus-5-5" and api.opts.body.max_tokens == 4096)
      assert(api.opts.body.thinking == nil, "no thinking parameter")
      local sys = api.opts.body.system
      assert(type(sys) == "table" and sys[1].type == "text" and #sys[1].text > 0, "system block")
      assert(sys[1].cache_control.type == "ephemeral", "system prompt is cached")
      local msg = api.opts.body.messages[1]
      assert(msg.role == "user")
      assert(string.find(msg.content, "[1] Projects/Demo › Outcome (Projects/Demo@L5)", 1, true), msg.content)
      assert(string.find(msg.content, "Ship the demo launch campaign by the end of September.", 1, true), msg.content)
      assert(string.find(msg.content, "<question>when is the launch</question>", 1, true), msg.content)
      assert(#errorMessages() == 0, table.concat(errorMessages(), "; "))
      assert(opened[1] == "memo.ask", "view opened")
      local md = views["memo.ask"].content({ dock = "modal" })
      assert(string.find(md, "By the end of September [[Projects/Demo@L5|1]]", 1, true), md)
      assert(string.find(md, "[[Journal/2026-09-20@L3]]", 1, true), md)
      assert(string.find(md, "when is the launch", 1, true), md)
      assert(string.find(md, "Sources", 1, true), md)
    `);
  });

  test("a confidential reply makes no API call unless allowConfidential is set", async () => {
    await runLua(`
      configureAll()
      promptAnswer = "secret stuff?"
      local confidential = { ok = true, status = 200, headers = {}, body = {
        confidential = true, sections = SIDECAR.body.sections } }
      queue = { confidential, API }
      commands["Memo: Ask"].run()
      assert(#fetches == 1, "no API call: " .. #fetches)
      assert(#opened == 0)
      local errs = errorMessages()
      assert(#errs == 1 and string.find(errs[1], "confidential", 1, true), errs[1])
      -- opted in: the API is called
      setConfig("memoAsk", { apiKey = "sk-ant-test", allowConfidential = true })
      queue = { confidential, API }
      commands["Memo: Ask"].run()
      assert(#fetches == 3, "API call after opting in: " .. #fetches)
      assert(opened[1] == "memo.ask")
    `);
  });

  test("prompt fences notes; markdown neutralises directives and ignores unknown markers", async () => {
    await runLua(`
      configureAll()
      promptAnswer = "q \${2+2}"
      queue = { SIDECAR, { ok = true, status = 200, headers = {}, body = {
        stop_reason = "end_turn",
        content = { { type = "text", text = "Run \${1+1} and ![[Secret]] see [0] [99] [2]" } } } } }
      commands["Memo: Ask"].run()
      local msg = fetches[2].opts.body.messages[1].content
      assert(string.find(msg, "<note>\\nShip the demo", 1, true), msg)
      assert(string.find(msg, "<question>q", 1, true), msg)
      local md = views["memo.ask"].content({})
      assert(not string.find(md, "\${", 1, true), md)
      assert(not string.find(md, "![[", 1, true), md)
      assert(string.find(md, "[0] [99] [[Journal/2026-09-20@L3|2]]", 1, true), md)
    `);
  });

  test("a reply without the confidential flag is treated as confidential", async () => {
    await runLua(`
      configureAll()
      promptAnswer = "q"
      queue = { { ok = true, status = 200, headers = {}, body = { sections = SIDECAR.body.sections } }, API }
      commands["Memo: Ask"].run()
      assert(#fetches == 1, "no API call: " .. #fetches)
      assert(#errorMessages() == 1 and string.find(errorMessages()[1], "confidential", 1, true))
    `);
  });

  test("a malformed sidecar reply, a section without ref and a 5xx string body", async () => {
    await runLua(`
      configureAll()
      promptAnswer = "q"
      queue = { { ok = true, status = 200, headers = {}, body = { confidential = false, sections = "x" } } }
      commands["Memo: Ask"].run()
      assert(#fetches == 1 and #errorMessages() == 1, errorMessages()[1])
      local noRef = { confidential = false, sections = { { page = "A/B", heading_path = { "B" },
        heading_line = 2, line_start = 3, line_end = 4, text = "t" } } }
      queue = { { ok = true, status = 200, headers = {}, body = noRef }, API }
      commands["Memo: Ask"].run()
      local md = views["memo.ask"].content({})
      assert(string.find(md, "[[" .. memo.navRef(noRef.sections[1]) .. "|1]]", 1, true), md)
      queue = { SIDECAR, { ok = false, status = 502, headers = {}, body = "Bad gateway" } }
      commands["Memo: Ask"].run()
      local errs = errorMessages()
      assert(string.find(errs[#errs], "502", 1, true) and string.find(errs[#errs], "Bad gateway", 1, true), errs[#errs])
    `);
  });

  test("a second run while one is in flight is refused", async () => {
    await runLua(`
      configureAll()
      promptAnswer = "q"
      local inner = false
      local realFetch = net.proxyFetch
      net.proxyFetch = function(url, opts)
        if url == memo.askApiUrl and not inner then
          inner = true
          commands["Memo: Ask"].run()
        end
        return realFetch(url, opts)
      end
      queue = { SIDECAR, API, SIDECAR, API }
      commands["Memo: Ask"].run()
      local refused = false
      for _, n in ipairs(notifications) do
        if string.find(n.message, "already running", 1, true) then refused = true end
      end
      assert(refused, "second run refused")
      assert(#fetches == 2, "one sidecar and one API call: " .. #fetches)
    `);
  });

  test("API 401 and a refusal produce messages, max_tokens appends a note", async () => {
    await runLua(`
      configureAll()
      promptAnswer = "q"
      queue = { SIDECAR, { ok = true, status = 401, headers = {}, body = {
        type = "error", error = { type = "authentication_error", message = "invalid x-api-key" } } } }
      commands["Memo: Ask"].run()
      local errs = errorMessages()
      assert(#errs == 1 and string.find(errs[1], "memoAsk.apiKey rejected", 1, true), errs[1])
      assert(#opened == 0)

      queue = { SIDECAR, { ok = true, status = 200, headers = {}, body = {
        stop_reason = "refusal", stop_details = { type = "refusal", category = "cyber", explanation = "Not this one" },
        content = {} } } }
      commands["Memo: Ask"].run()
      errs = errorMessages()
      assert(#errs == 2 and string.find(errs[2], "Not this one", 1, true), errs[2])
      assert(#opened == 0)

      queue = { SIDECAR, { ok = true, status = 429, headers = {}, body = { error = { message = "slow down" } } } }
      commands["Memo: Ask"].run()
      errs = errorMessages()
      assert(#errs == 3 and string.find(errs[3], "rate limited", 1, true), errs[3])

      queue = { SIDECAR, { ok = true, status = 500, headers = {}, body = { error = { message = "overloaded" } } } }
      commands["Memo: Ask"].run()
      errs = errorMessages()
      assert(#errs == 4 and string.find(errs[4], "overloaded", 1, true), errs[4])

      queue = { SIDECAR, { ok = true, status = 200, headers = {}, body = { stop_reason = "max_tokens",
        content = { { type = "text", text = "Partial" } }, usage = { output_tokens = 4096 } } } }
      commands["Memo: Ask"].run()
      assert(#errorMessages() == 4)
      local md = views["memo.ask"].content({})
      assert(string.find(md, "Partial", 1, true) and string.find(md, "cut off", 1, true), md)

      -- thinking alone can use up max_tokens: no text, but still a maxTokens hint
      queue = { SIDECAR, { ok = true, status = 200, headers = {}, body = { stop_reason = "max_tokens",
        content = { { type = "thinking", thinking = "" } }, usage = { output_tokens = 4096 } } } }
      commands["Memo: Ask"].run()
      errs = errorMessages()
      assert(#errs == 5 and string.find(errs[5], "maxTokens", 1, true), errs[5])
    `);
  });

  test("missing configuration or an empty question makes no calls", async () => {
    await runLua(`
      promptAnswer = "q"
      commands["Memo: Ask"].run()
      assert(#fetches == 0)
      local errs = errorMessages()
      assert(#errs == 1 and string.find(errs[1], "memoSidecar", 1, true), errs[1])
      setConfig("memoSidecar", { url = "127.0.0.1:3010", token = "t", space = "notes" })
      commands["Memo: Ask"].run()
      assert(#fetches == 0)
      errs = errorMessages()
      assert(#errs == 2 and string.find(errs[2], "memoAsk", 1, true), errs[2])
      setConfig("memoAsk", { apiKey = "k" })
      promptAnswer = nil
      commands["Memo: Ask"].run()
      promptAnswer = "   "
      commands["Memo: Ask"].run()
      assert(#fetches == 0 and #errorMessages() == 2, "dismissed / blank prompt")
      -- no matching notes: a message, no API call
      promptAnswer = "q"
      queue = { { ok = true, status = 200, headers = {}, body = { confidential = false, sections = {} } } }
      commands["Memo: Ask"].run()
      assert(#fetches == 1 and #errorMessages() == 3)
    `);
  });

  test("scope words: parsed, merged with defaultScope, sent to the sidecar and shown", async () => {
    await runLua(`
      local q, sc = memo.askParseScope('#project folder:Projects since:2026-09-01 area:"Work" what is due? note: x')
      assert(q == "what is due? note: x", q)
      assert(sc.tag == "project" and sc.folder == "Projects/" and sc.since == "2026-09-01" and sc.area == "Work")
      q, sc = memo.askParseScope('folder:"My Notes/" a')
      assert(q == "a" and sc.folder == "My Notes/", q)
      q, sc = memo.askParseScope("unknown:word and #not later")
      assert(q == "unknown:word and #not later" and next(sc) == nil, q)
      assert(memo.askScopeLabel({ tag = "t", folder = "F/" }) == "#t folder:F/")
      local merged = memo.askMergeScope({ folder = "A/", tag = "x" }, { tag = "y" })
      assert(merged.folder == "A/" and merged.tag == "y")

      configureAll()
      setConfig("memoAsk", { apiKey = "k", defaultScope = { folder = "Areas", status = "active" } })
      promptAnswer = "#journal since:2026-09-01 when is the launch"
      local scoped = { ok = true, status = 200, headers = {}, body = { confidential = false,
        scope = { tag = "journal" }, sections = SIDECAR.body.sections } }
      queue = { scoped, API }
      commands["Memo: Ask"].run()
      local sent = fetches[1].opts.body
      assert(sent.q == "when is the launch", sent.q)
      assert(sent.tag == "journal" and sent.since == "2026-09-01", "words")
      assert(sent.prefix == "Areas/" and sent.status == "active", "defaults")
      local md = views["memo.ask"].content({})
      assert(string.find(md, "**Scope:** #journal folder:Areas/ status:active since:2026-09-01", 1, true), md)
      -- the prompt text offers the words and the next prompt starts from the last input
      assert(string.find(prompts[1].message, "folder:", 1, true), prompts[1].message)
    `);
  });

  test("a sidecar that ignores scopes is refused; no scope needs no echo", async () => {
    await runLua(`
      configureAll()
      promptAnswer = "#journal q"
      queue = { SIDECAR, API }
      commands["Memo: Ask"].run()
      assert(#fetches == 1 and #opened == 0, "no API call")
      assert(string.find(errorMessages()[1], "scope", 1, true), errorMessages()[1])
      promptAnswer = "q"
      queue = { SIDECAR, API }
      commands["Memo: Ask"].run()
      assert(#fetches == 3 and opened[1] == "memo.ask")
      assert(fetches[2].opts.body.tag == nil and fetches[2].opts.body.prefix == nil)
      -- only scope words and no question: cancelled
      promptAnswer = "#journal"
      commands["Memo: Ask"].run()
      assert(#fetches == 3)
    `);
  });

  test("sources split into cited and not cited, with excerpts", async () => {
    await runLua(`
      configureAll()
      promptAnswer = "q"
      queue = { SIDECAR, API }
      commands["Memo: Ask"].run()
      local md = views["memo.ask"].content({})
      local cited = string.find(md, "**Sources cited**", 1, true)
      assert(cited and not string.find(md, "not cited", 1, true), md)
      assert(string.find(md, "> Ship the demo launch campaign by the end of September.", 1, true), md)
      -- only [1] cited: [2] moves to the second list
      local sections = SIDECAR.body.sections
      local body = memo.askBody("Only [1].", sections)
      local c = string.find(body, "**Sources cited**", 1, true)
      local o = string.find(body, "**Also sent to the model (not cited)**", 1, true)
      local s2 = string.find(body, "2. [[Journal/2026-09-20@L3]]", 1, true)
      assert(c and o and s2 and s2 > o, body)
      -- nothing cited: no "cited" list
      assert(not string.find(memo.askBody("none", sections), "Sources cited", 1, true))
      local jp = string.rep("あ", 200)
      local ex = memo.askExcerpt(jp, 150)
      assert(#ex == 151 and string.sub(ex, -1) == "…", #ex)
      assert(memo.askExcerpt("a\\n\\n  b", 150) == "a b")
      assert(string.find(memo.askBody("x", { { page = "P", heading_path = { "P" }, text = "\${1+1}" } }), "\${", 1, true) == nil)
    `);
  });

  test("token estimate counts Japanese per character; excerpts cannot link or tag", async () => {
    await runLua(`
      local jp = { { page = "P", heading_path = { "P" }, text = string.rep("あ", 3000) } }
      local en = { { page = "P", heading_path = { "P" }, text = string.rep("a", 3000) } }
      assert(memo.askEstimateTokens("q", jp) >= memo.askEstimateTokens("q", en) + 1900, "jp costs more")
      local body = memo.askBody("x", { { page = "P", heading_path = { "P" }, text = "see #x and [[y]]" } })
      assert(not string.find(body, "#x", 1, true) and not string.find(body, "[[y]]", 1, true), body)
    `);
  });

  test("size guard refuses above maxInputTokens; usage shows in the view", async () => {
    await runLua(`
      configureAll()
      local est = memo.askEstimateTokens("q", SIDECAR.body.sections)
      assert(est > 50 and est < 5000, est)
      setConfig("memoAsk", { apiKey = "k", maxInputTokens = est - 1 })
      promptAnswer = "q"
      queue = { SIDECAR, API }
      commands["Memo: Ask"].run()
      assert(#fetches == 1 and #opened == 0, "nothing sent")
      assert(string.find(errorMessages()[1], "maxInputTokens", 1, true), errorMessages()[1])
      assert(memo.askConfig().maxInputTokens == est - 1)
      -- at the limit: sent, with the estimate in the notice and both counts in the view
      setConfig("memoAsk", { apiKey = "k", maxInputTokens = est })
      queue = { SIDECAR, API }
      commands["Memo: Ask"].run()
      assert(#fetches == 3 and opened[1] == "memo.ask")
      local md = views["memo.ask"].content({})
      assert(string.find(md, "~" .. est .. " estimated", 1, true), md)
      assert(string.find(md, "100 in, 20 out", 1, true), md)
      local flash
      for _, n in ipairs(notifications) do
        if string.find(n.message, "asking", 1, true) then flash = n.message end
      end
      assert(flash and string.find(flash, "~" .. est .. " tokens", 1, true), flash)
      assert(memo.askConfig().maxInputTokens == est)
      setConfig("memoAsk", { apiKey = "k" })
      assert(memo.askConfig().maxInputTokens == 50000)
    `);
  });

  test("Save Answer writes an Ask/ page once, with a unique name", async () => {
    await runLua(`
      configureAll()
      commands["Memo: Ask - Save Answer"].run()
      assert(next(writtenPages) == nil and #notifications == 1 and notifications[1].kind == "error", "nothing to save")
      promptAnswer = "folder:Projects when is the launch? / [x]"
      queue = { { ok = true, status = 200, headers = {}, body = { confidential = false,
        scope = { prefix = "Projects/" }, sections = SIDECAR.body.sections } }, API }
      commands["Memo: Ask"].run()
      commands["Memo: Ask - Save Answer"].run()
      local name = "Ask/" .. os.date("%Y-%m-%d") .. " when is the launch x"
      local text = writtenPages[name]
      assert(text, "page written: " .. tostring(next(writtenPages)))
      assert(string.find(text, "^%-%-%-\\ntags: memo%-answer\\nasked: "), text)
      assert(string.find(text, "**Question:** when is the launch? / [x]", 1, true), text)
      assert(string.find(text, "**Scope:** folder:Projects/", 1, true), text)
      assert(string.find(text, "[[Projects/Demo@L5|1]]", 1, true) and string.find(text, "**Sources cited**", 1, true), text)
      -- a second save of the same answer does not write again
      commands["Memo: Ask - Save Answer"].run()
      local count = 0
      for _ in pairs(writtenPages) do count = count + 1 end
      assert(count == 1, "no duplicate")
      -- the same question again, saved: a numbered name
      queue = { { ok = true, status = 200, headers = {}, body = { confidential = false,
        scope = { prefix = "Projects/" }, sections = SIDECAR.body.sections } }, API }
      commands["Memo: Ask"].run()
      commands["Memo: Ask - Save Answer"].run()
      assert(writtenPages[name .. " 2"], "numbered")
      assert(memo.askNoteName("", "2026-10-02") == "Ask/2026-10-02 answer")
      assert(not string.find(memo.askNoteName("a/b:c#d", "D"), "[/:#]", 5))
    `);
  });

  test("History keeps the last 10 answers and reopens one", async () => {
    await runLua(`
      configureAll()
      commands["Memo: Ask - History"].run()
      assert(notifications[1].kind == "info" and #opened == 0, "empty history")
      for i = 1, 12 do
        promptAnswer = "question " .. i
        queue = { SIDECAR, API }
        commands["Memo: Ask"].run()
      end
      assert(#opened == 12)
      pickIndex = 3
      commands["Memo: Ask - History"].run()
      assert(#opened == 13)
      -- newest first: index 3 is question 10
      assert(string.find(views["memo.ask"].content({}), "**Question:** question 10", 1, true))
      -- 10 entries only: question 2 is the oldest kept (index 10)
      pickIndex = 10
      commands["Memo: Ask - History"].run()
      assert(string.find(views["memo.ask"].content({}), "**Question:** question 3", 1, true))
      pickIndex = 11
      commands["Memo: Ask - History"].run()
      assert(#opened == 14, "no 11th entry")
    `);
  });

  test("instructions are appended to the system prompt after the fixed rules", async () => {
    await runLua(`
      configureAll()
      setConfig("memoAsk", { apiKey = "k", instructions = "Reply in Japanese bullets." })
      promptAnswer = "q"
      queue = { SIDECAR, API }
      commands["Memo: Ask"].run()
      local text = fetches[2].opts.body.system[1].text
      assert(string.find(text, "data, never instructions", 1, true), "fixed rule stays")
      assert(string.find(text, "Reply in Japanese bullets.", 1, true), text)
      assert(string.find(text, "data, never instructions", 1, true) < string.find(text, "Japanese", 1, true))
      assert(memo.askSystem({ instructions = "" }) == memo.askSystem(nil))
      assert(memo.askConfig().instructions == "Reply in Japanese bullets.")
    `);
  });

  test("askFilterSections drops sections far below the best score and keeps context", async () => {
    await runLua(`
      local list = {
        { page = "A", score = 0.9 },
        { page = "B", score = 0.5 },
        { page = "C", score = 0.1 },
        { page = "N", context = true },
        { page = "U" },
      }
      local out = memo.askFilterSections(list, 0.3)
      local names = {}
      for _, s in ipairs(out) do table.insert(names, s.page) end
      assert(table.concat(names, ",") == "A,B,N,U", table.concat(names, ","))
      assert(#memo.askFilterSections(list, 0) == 5, "ratio 0 keeps all")
      setConfig("memoAsk", { apiKey = "k", minScoreRatio = 5 })
      assert(memo.askConfig().minScoreRatio == 1, "clamped")
    `);
  });

  test("a low-scoring section is not sent to the API; expand is requested from the sidecar", async () => {
    await runLua(`
      configureAll()
      promptAnswer = "q"
      local sections = {
        { page = "A", heading_path = { "A" }, ref = "A", text = "alpha text", score = 0.9 },
        { page = "B", heading_path = { "B" }, ref = "B", text = "beta text", score = 0.05 },
        { page = "A", heading_path = { "A", "Next" }, ref = "A@L9", text = "neighbour text", context = true },
      }
      queue = { { ok = true, status = 200, headers = {}, body = { confidential = false, sections = sections } }, API }
      commands["Memo: Ask"].run()
      assert(fetches[1].opts.body.expand == true, "expand asked")
      local msg = fetches[2].opts.body.messages[1].content
      assert(string.find(msg, "alpha text", 1, true) and string.find(msg, "neighbour text", 1, true), msg)
      assert(not string.find(msg, "beta text", 1, true), "weak section dropped")
      setConfig("memoAsk", { apiKey = "k", expand = false })
      queue = { { ok = true, status = 200, headers = {}, body = { confidential = false, sections = sections } }, API }
      commands["Memo: Ask"].run()
      assert(fetches[3].opts.body.expand == false)
    `);
  });

  test("a follow-up rewrites the query, keeps the earlier turns and shows the thread", async () => {
    await runLua(`
      configureAll()
      promptAnswer = "when is the launch"
      queue = { SIDECAR, API }
      commands["Memo: Ask"].run()
      assert(#fetches == 2)
      -- follow-up: rewrite call, sidecar, answer
      promptAnswer = "and the newsletter?"
      local rewrite = { ok = true, status = 200, headers = {}, body = { stop_reason = "end_turn",
        content = { { type = "text", text = " launch newsletter status " } } } }
      local api2 = { ok = true, status = 200, headers = {}, body = { stop_reason = "end_turn",
        content = { { type = "text", text = "It is written [2]." } }, usage = { input_tokens = 5, output_tokens = 2 } } }
      queue = { rewrite, SIDECAR, api2 }
      commands["Memo: Ask - Follow-up"].run()
      assert(#fetches == 5, "rewrite + sidecar + answer: " .. #fetches)
      local rw = fetches[3].opts.body
      assert(rw.max_tokens == 400 and rw.thinking.type == "disabled" and string.find(rw.messages[1].content, "when is the launch", 1, true), "rewrite request")
      assert(fetches[4].opts.body.q == "launch newsletter status", fetches[4].opts.body.q)
      local msgs = fetches[5].opts.body.messages
      assert(#msgs == 3, "user, assistant, user: " .. #msgs)
      assert(msgs[1].role == "user" and msgs[1].content == "when is the launch")
      assert(msgs[2].role == "assistant" and string.find(msgs[2].content[1].text, "end of September", 1, true))
      assert(msgs[2].content[1].cache_control.type == "ephemeral", "thread prefix is cached")
      assert(msgs[3].role == "user" and string.find(msgs[3].content, "<question>and the newsletter?</question>", 1, true))
      assert(not string.find(msgs[3].content, "when is the launch", 1, true), "earlier notes are not repeated")
      local md = views["memo.ask"].content({})
      assert(string.find(md, "**Question:** when is the launch", 1, true), md)
      assert(string.find(md, "**Question:** and the newsletter?", 1, true), md)
      assert(string.find(md, "**Searched for:** launch newsletter status", 1, true), md)
      -- a third turn carries both earlier turns
      promptAnswer = "thanks, shorter"
      queue = { rewrite, SIDECAR, api2 }
      commands["Memo: Ask - Follow-up"].run()
      assert(#fetches[8].opts.body.messages == 5, "two earlier turns")
      -- a plain Memo: Ask starts over
      queue = { SIDECAR, API }
      commands["Memo: Ask"].run()
      assert(#fetches[10].opts.body.messages == 1, "new conversation")
    `);
  });

  test("filter ratio works on realistic rank-fusion scores", async () => {
    await runLua(`
      local list = { { page = "both", score = 0.0328 }, { page = "one", score = 0.0164 },
        { page = "tail", score = 0.0101 } }
      local out = memo.askFilterSections(list, 0.4)
      assert(#out == 2 and out[2].page == "one", "weak single-list tail dropped")
      assert(memo.askCleanKey("sk-\`\`\`x") == nil and memo.askCleanKey(" sk-ok ") == "sk-ok", "backticks rejected")
    `);
  });

  test("a rewrite cut off at max_tokens is not used as the query, and the thread keeps the raw answer", async () => {
    await runLua(`
      configureAll()
      promptAnswer = "when is the launch"
      local cut = { ok = true, status = 200, headers = {}, body = { stop_reason = "max_tokens",
        content = { { type = "text", text = "It ends in September" } }, usage = { output_tokens = 9 } } }
      queue = { SIDECAR, cut }
      commands["Memo: Ask"].run()
      assert(string.find(views["memo.ask"].content({}), "cut off", 1, true), "reader sees the note")
      promptAnswer = "and the newsletter?"
      local badRewrite = { ok = true, status = 200, headers = {}, body = { stop_reason = "max_tokens",
        content = { { type = "text", text = "launch news" } }, usage = { output_tokens = 400 } } }
      queue = { badRewrite, SIDECAR, API }
      commands["Memo: Ask - Follow-up"].run()
      assert(not string.find(fetches[4].opts.body.q, "cut off", 1, true), fetches[4].opts.body.q)
      local prior = fetches[5].opts.body.messages[2].content[1].text
      assert(prior == "It ends in September", prior)
    `);
  });

  test("a failed rewrite falls back to the earlier question plus the follow-up", async () => {
    await runLua(`
      configureAll()
      promptAnswer = "when is the launch"
      queue = { SIDECAR, API }
      commands["Memo: Ask"].run()
      promptAnswer = "and the newsletter?"
      queue = { "throw", SIDECAR, API }
      commands["Memo: Ask - Follow-up"].run()
      assert(fetches[4].opts.body.q == "when is the launch and the newsletter?", fetches[4].opts.body.q)
      assert(#errorMessages() == 0, table.concat(errorMessages(), "; "))
      assert(memo.askSearchQuery(nil, { { question = "a", answer = "b" } }, string.rep("x", 600)) ~= nil)
      assert(#memo.askSearchQuery("  ", { { question = "a", answer = "b" } }, string.rep("x", 600)) == 500)
    `);
  });

  test("a follow-up without an answer on screen, and New Conversation", async () => {
    await runLua(`
      configureAll()
      promptAnswer = "q"
      commands["Memo: Ask - Follow-up"].run()
      local errs = errorMessages()
      assert(#errs == 1 and string.find(errs[1], "conversation", 1, true), errs[1])
      assert(#fetches == 0 and #prompts == 0)
      queue = { SIDECAR, API }
      commands["Memo: Ask"].run()
      commands["Memo: Ask - New Conversation"].run()
      commands["Memo: Ask - Follow-up"].run()
      assert(#errorMessages() == 2 and #fetches == 2, "no conversation to continue")
      -- the earlier answer can be reopened from the history and continued
      pickIndex = 1
      commands["Memo: Ask - History"].run()
      queue = { { ok = true, status = 200, headers = {}, body = { content = { { type = "text", text = "q2" } } } }, SIDECAR, API }
      commands["Memo: Ask - Follow-up"].run()
      assert(#fetches == 5 and #fetches[5].opts.body.messages == 3)
    `);
  });

  test("the thread keeps at most maxTurns earlier turns", async () => {
    await runLua(`
      local thread = {}
      for i = 1, 5 do table.insert(thread, { question = "q" .. i, answer = "a" .. i }) end
      local m = memo.askThreadMessages(thread, 2)
      assert(#m == 4 and m[1].content == "q4" and m[4].content == "a5", #m)
      assert(#memo.askThreadMessages(nil, 2) == 0)
    `);
  });

  test("Set up Ask writes the memoAsk block into CONFIG and tells how when not configured", async () => {
    await runLua(`
      -- not configured: the message points at the command
      local cfg, err = memo.askConfig()
      assert(cfg == nil and string.find(err, "Memo: Set up Ask", 1, true), err)
      -- no key: nothing is written
      promptQueue = { "   " }
      commands["Memo: Set up Ask"].run()
      assert(writtenPages["CONFIG"] == nil and #errorMessages() == 1)
      -- key + model are written after the existing CONFIG text
      pages["CONFIG"] = "# Config\\n\\nsome text"
      promptQueue = { " sk-ant-abc123 ", "claude-sonnet-5-5" }
      commands["Memo: Set up Ask"].run()
      local text = writtenPages["CONFIG"]
      assert(string.find(text, "# Config\\n\\nsome text\\n\\n\`\`\`space-lua\\n-- memo-ask-setup", 1, true), text)
      assert(string.find(text, 'ask.apiKey = "sk-ant-abc123"', 1, true), text)
      assert(string.find(text, 'ask.model = "claude-sonnet-5-5"', 1, true), text)
      assert(reloaded == 1, "config reloaded")
      -- running it again replaces the block instead of adding another one
      pages["CONFIG"] = text .. "\\nafter"
      writtenPages["CONFIG"] = nil
      promptQueue = { "sk-ant-new", "" }
      commands["Memo: Set up Ask"].run()
      local again = writtenPages["CONFIG"]
      assert(not string.find(again, "abc123", 1, true) and string.find(again, 'ask.apiKey = "sk-ant-new"', 1, true), again)
      assert(string.find(again, 'ask.model = "claude-opus-5-5"', 1, true), again)
      assert(string.find(again, "\\nafter", 1, true) and select(2, string.gsub(again, "memo%-ask%-setup", "")) == 1, again)
    `);
  });

  test("the setup block escapes the key and rejects whitespace", async () => {
    await runLua(`
      assert(memo.askLuaString('a"b\\\\c') == '"a\\\\"b\\\\\\\\c"', memo.askLuaString('a"b\\\\c'))
      assert(memo.askCleanKey("a b") == nil and memo.askCleanKey(nil) == nil and memo.askCleanKey(" k ") == "k")
      local block = memo.askSetupBlock("k", "m")
      assert(string.find(block, 'config.set("memoAsk", ask)', 1, true))
      assert(string.find(block, 'for key, value in pairs(config.get("memoAsk", {})) do ask[key] = value end', 1, true), "merges")
      assert(string.find(block, 'ask.apiKey = "k"', 1, true) and string.find(block, 'ask.model = "m"', 1, true))
    `);
  });
});

test("the library page has the shape the embedded build expects", () => {
  expect(librarySource).toContain('name = "memo.ask"');
  expect(librarySource).toContain('name = "Memo: Ask"');
});
