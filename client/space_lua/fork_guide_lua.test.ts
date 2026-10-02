// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeAll, describe, expect, test } from "vitest";
import { extractSpaceLuaFromPageText } from "../boot_config.ts";
import { evalStatement } from "./eval.ts";
import { parseBlock } from "./parse.ts";
import { LuaEnv, LuaStackFrame } from "./runtime.ts";
import { luaBuildStandardEnv } from "./stdlib.ts";

// The guide's Lua is stubbed like the Memo libraries': what it calls outside the standard library
// is a Lua table here, and each case is one chunk.
const PRELUDE = `
commands = {}
command = { define = function(spec) commands[spec.name] = spec end }
listeners = {}
event = { listen = function(spec) listeners[spec.name] = spec end }

currentPage = "index"
mode = "rw"
uiOptions = { forcedROMode = false }
rebuilds = 0
navigated = {}
editor = {
  navigate = function(ref) currentPage = string.gsub(ref, "@.*$", ""); table.insert(navigated, ref) end,
  getCurrentPage = function() return currentPage end,
  getUiOption = function(name) return uiOptions[name] end,
  setUiOption = function(name, value) uiOptions[name] = value end,
  rebuildEditorState = function() rebuilds = rebuilds + 1 end,
}
system = {
  getMode = function() return mode end,
  listCommands = function() return registered end,
}
registered = {}
scrollTop = 99
js = { window = { setTimeout = function(fn) fn() end, document = { querySelector = function() return setmetatable({}, { __newindex = function(_, k, v) if k == "scrollTop" then scrollTop = v end end }) end } } }
`;

let pageSource = "";
let librarySource = "";

beforeAll(async () => {
  pageSource = await readFile(
    new URL("../../libraries/Library/Std/Docs/Fork Guide.md", import.meta.url),
    "utf8",
  );
  librarySource = extractSpaceLuaFromPageText(pageSource);
});

async function runLua(testBody: string) {
  const env = new LuaEnv(luaBuildStandardEnv());
  const block = parseBlock(`${PRELUDE}\n${librarySource}\n${testBody}`);
  const frame = LuaStackFrame.createWithGlobalEnv(env, block.ctx);
  try {
    await evalStatement(block, env, frame);
  } catch (e: any) {
    throw new Error(String(e?.message ?? e));
  }
}

describe("Fork Guide page", () => {
  test("frontmatter comes first, and the command opens the page on its first body line", () => {
    expect(pageSource.startsWith("---\ntags: meta\n")).toBe(true);
    const lines = pageSource.split("\n");
    expect(lines[3]).toBe("---");
    // `@L6` is the guide's first line of text: a cursor outside the frontmatter keeps it folded
    expect(lines[4]).toBe("");
    expect(lines[5]).toMatch(/^BlackBullet/);
    expect(pageSource).toContain('GUIDE .. "@L6"');
  });

  test("speaks the chrome's words and none of the retired ones", () => {
    expect(pageSource).not.toMatch(/Shift-f/i);
    expect(pageSource).not.toContain("Memo:");
    expect(pageSource).not.toContain("Restore From Trash");
    expect(pageSource).not.toContain('"Memo');
    // the internal names stay out of the prose; only the config keys and the page links may carry them
    const prose = pageSource
      .replace(/memoSidecar|memoAsk/g, "")
      .replace(/Library\/Std\/Editor\/Memo (Search|Ask)/g, "");
    expect(prose).not.toMatch(/memo(?!ry)|sidecar/i);
    // the keys of this round
    for (const key of ["Ctrl-q s", "Ctrl-q a", "Ctrl-q r", "Ctrl-Alt-n"]) {
      expect(pageSource).toContain(key);
    }
  });

  test("the glossary's English column is the chrome's labels", () => {
    const table = pageSource.split("# 用語")[1].split("# キー")[0];
    const english = new Map(
      table
        .split("\n")
        .filter((line) => line.startsWith("| ") && !line.startsWith("| ---"))
        .map((line) => line.split("|").map((cell) => cell.trim()))
        .map((cells) => [cells[1], cells[2]]),
    );
    // Product vocabulary, as shown in the palette, the tree and the views.
    const expected: Record<string, string> = {
      ページ: "Page",
      フォルダ: "Folder",
      タグ: "Tag",
      データベース: "Database",
      プロパティ: "Property",
      行: "Row",
      ビュー: "View(Table · Board · Calendar)",
      タスク: "Task",
      ジャーナル: "Journal: Today",
      "クイックノート / 受信箱": "Quick note / Inbox",
      テンプレート: "Template",
      検索: "Search: Notes",
      関連ノート: "Related notes(Search: Related Notes)",
      グラフ: "Graph",
      質問: "Ask: Notes",
      文書: "Document",
      ゴミ箱: "Move to trash · Trash: Restore · Trash: Empty",
      ホーム: "Home",
      パネル: "Panel",
    };
    for (const [japanese, label] of Object.entries(expected)) {
      expect(english.get(japanese), japanese).toBe(label);
    }
  });

  test("the sections for New, Trash and the phone exist", () => {
    for (const heading of [
      "# 作る(New)",
      "# ゴミ箱",
      "# スマホで使う",
      "# 検索(Search)",
      "# 質問(Ask)",
    ]) {
      expect(pageSource).toContain(`\n${heading}\n`);
    }
    expect(pageSource).toContain("Trash: Restore");
    expect(pageSource).toContain("Trash: Empty");
    expect(pageSource).toContain("Move to trash");
    expect(pageSource).toMatch(/Search.*\n.*\+ New.*\n.*Journal/);
  });
});

describe("Fork Guide commands", () => {
  test("lists the renamed commands and not the retired ones", async () => {
    await runLua(`
      registered = {
        ["Search: Notes"] = { key = "Ctrl-q s" },
        ["Ask: Notes"] = { key = "Ctrl-q a" },
        ["Memo: Search"] = { key = "Ctrl-Shift-f" },
        ["Database: Restore From Trash"] = {},
        ["Trash: Restore"] = {},
        ["Trash: Empty"] = {},
        ["New"] = { key = "Ctrl-Alt-n" },
      }
      local rows = forkGuide.commandTable()
      local names = {}
      for _, r in ipairs(rows) do names[r.Command] = r end
      assert(names["Search: Notes"].Key == "Ctrl-q s" and names["Search: Notes"].Mac == "")
      assert(names["Ask: Notes"] and names["Trash: Restore"] and names["Trash: Empty"] and names["New"])
      assert(names["Memo: Search"] == nil and names["Database: Restore From Trash"] == nil)
    `);
  });

  test("Help: Fork Guide opens the guide read-only, and the next page gives the editor back", async () => {
    await runLua(`
      commands["Help: Fork Guide"].run()
      assert(navigated[1] == "Library/Std/Docs/Fork Guide@L6", navigated[1])
      assert(scrollTop == 0, "the guide opens at its top")
      assert(uiOptions.forcedROMode == true and rebuilds == 1, "read-only while the guide is open")
      -- a reload of the guide itself keeps it read-only
      listeners["editor:pageLoaded"].run()
      assert(uiOptions.forcedROMode == true and rebuilds == 1)
      -- any other page: the editor is writable again
      currentPage = "Projects/Spring Launch"
      listeners["editor:pageLoaded"].run()
      assert(uiOptions.forcedROMode == false and rebuilds == 2)
      -- and a later visit elsewhere changes nothing
      listeners["editor:pageLoaded"].run()
      assert(rebuilds == 2)
    `);
  });

  test("someone already read-only, or a read-only client, is left alone", async () => {
    await runLua(`
      uiOptions.forcedROMode = true
      commands["Help: Fork Guide"].run()
      currentPage = "index"
      listeners["editor:pageLoaded"].run()
      assert(uiOptions.forcedROMode == true and rebuilds == 0, "their read-only mode stays")
      uiOptions.forcedROMode = false
      mode = "ro"
      commands["Help: Fork Guide"].run()
      assert(uiOptions.forcedROMode == false and rebuilds == 0)
    `);
  });
});

// Every command name the sources register, found the way a reader would grep for them:
// `command.define { name = ... }` in the libraries, a `command = "..."` of a view or a plug
// manifest, and the navigator's `registerCommand({ name: ... })`.
const ROOT = new URL("../../", import.meta.url).pathname;

async function walk(dir: string, out: string[] = []): Promise<string[]> {
  for (const entry of await readdir(join(ROOT, dir), { withFileTypes: true })) {
    const rel = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") await walk(rel, out);
    } else out.push(rel);
  }
  return out;
}

async function registeredCommands(): Promise<Set<string>> {
  const names = new Set<string>();
  const files = [
    ...(await walk("libraries/Library/Std")).filter((f) => f.endsWith(".md")),
    ...(await walk("plugs/object-graph")).filter((f) => f.endsWith(".yaml")),
    "client/navigator/commands.ts",
  ];
  for (const file of files) {
    const text = await readFile(join(ROOT, file), "utf8");
    for (const m of text.matchAll(
      /command\.define\s*\{[^}]*?name\s*=\s*"([^"]+)"/g,
    )) {
      names.add(m[1]);
    }
    for (const m of text.matchAll(/^\s*command\s*=\s*"([^"]+)"/gm)) {
      names.add(m[1]);
    }
    for (const m of text.matchAll(/^\s*name:\s*"([^"]+)"/gm)) names.add(m[1]);
    for (const m of text.matchAll(/^\s*name:\s*"([A-Z][^"]*)",$/gm)) {
      names.add(m[1]);
    }
  }
  return names;
}

describe("the command lists match what is registered", () => {
  const PLANNED = ["Database: New Database"];

  test("the guide's command buttons and the README's list name only commands that exist", async () => {
    const registered = await registeredCommands();
    // sanity: the scan finds the commands this round is about
    for (const name of [
      "New",
      "Trash: Restore",
      "Trash: Empty",
      "Search: Notes",
      "Search: Related Notes",
      "Ask: Notes",
      "Graph: Explore",
    ]) {
      expect(registered.has(name), name).toBe(true);
    }
    const buttons = [...pageSource.matchAll(/commandButton\("([^"]+)"\)/g)].map(
      (m) => m[1],
    );
    for (const name of buttons) {
      if (PLANNED.includes(name)) continue;
      expect(registered.has(name), `guide button ${name}`).toBe(true);
    }
    const readme = await readFile(join(ROOT, "README.md"), "utf8");
    const line = readme
      .split("\n")
      .find((l) => l.startsWith("Commands added by BlackBullet"))!;
    const listed = [...line.matchAll(/`([A-Z][A-Za-z]*(?:: [A-Za-z -]+)?)`/g)]
      .map((m) => m[1])
      .filter((n) => n === "New" || n.includes(": "));
    expect(listed.length).toBeGreaterThan(15);
    for (const name of listed) {
      expect(registered.has(name), `README lists ${name}`).toBe(true);
      expect(name).not.toMatch(/^Memo:/);
    }
    // and every command the guide's table is built from is in the README, once it exists
    const forkList = librarySource.slice(
      librarySource.indexOf("local FORK_COMMANDS = {"),
      librarySource.indexOf(
        "\n}",
        librarySource.indexOf("local FORK_COMMANDS"),
      ),
    );
    for (const m of forkList.matchAll(/^\s*"([^"]+)",$/gm)) {
      const name = m[1];
      if (!registered.has(name)) continue;
      expect(listed, `README misses ${name}`).toContain(name);
    }
  });

  test("the guide shows whichever name makes a database, never a dead button", async () => {
    await runLua(`
      widgets = { commandButton = function(name) return "[" .. name .. "]" end }
      registered = { ["Database: Define in CONFIG"] = {} }
      assert(forkGuide.newDatabaseButton() == "[Database: Define in CONFIG]")
      registered = { ["Database: New Database"] = {} }
      assert(forkGuide.newDatabaseButton() == "[Database: New Database]")
      registered = { ["Database: New Database"] = {}, ["Database: Define in CONFIG"] = {} }
      assert(forkGuide.newDatabaseButton() == "[Database: New Database]")
    `);
  });
});
