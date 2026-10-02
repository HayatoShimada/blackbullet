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
editor = {
  navigate = function(ref) table.insert(navigated, ref) end,
  getCurrentPage = function() return "Areas/Current Page" end,
  prompt = function(message, default) return promptAnswer end,
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
      assert(type(api.opts.body.system) == "string" and #api.opts.body.system > 0)
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
});

test("the library page has the shape the embedded build expects", () => {
  expect(librarySource).toContain('name = "memo.ask"');
  expect(librarySource).toContain('name = "Memo: Ask"');
});
