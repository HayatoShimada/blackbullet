// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada
import { readFile } from "node:fs/promises";
import { beforeAll, describe, expect, test } from "vitest";
import { extractSpaceLuaFromPageText } from "../boot_config.ts";
import { evalStatement } from "./eval.ts";
import { parseBlock } from "./parse.ts";
import { LuaEnv, LuaStackFrame } from "./runtime.ts";
import { luaBuildStandardEnv } from "./stdlib.ts";

// Same shape as the other library tests: what the page calls outside the standard library is a
// stub, and each case is one Lua chunk.
const PRELUDE = `
function string.startsWith(s, prefix) return string.sub(s, 1, #prefix) == prefix end

commands = {}
command = { define = function(spec) commands[spec.name] = spec end }
views = {}
view = { define = function(spec) views[spec.name] = spec end }

currentPage = "Projects/Spring Launch"
decoration = {}
editor = {
  getCurrentPage = function() return currentPage end,
  getText = function() return "" end,
}
index = {
  extractFrontmatter = function() return { frontmatter = { pageDecoration = decoration } } end,
}
`;

let pageSource = "";
let librarySource = "";

beforeAll(async () => {
  pageSource = await readFile(
    new URL(
      "../../libraries/Library/Std/Editor/Page Header.md",
      import.meta.url,
    ),
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

describe("Page Header crumb", () => {
  test("the crumb names the folders of the page, and nothing for a top-level page", async () => {
    await runLua(`
      assert(pageHeader.crumb("Projects/Spring Launch") == "Projects ›")
      assert(pageHeader.crumb("Projects/Plans/Spring Launch") == "Projects › Plans ›")
      assert(pageHeader.crumb("index") == nil)
      -- a quick note: the day, as the top bar does (its title is "Quick note · 11:17")
      assert(pageHeader.crumb("Inbox/2026-10-02/11-17-18") == "2026-10-02 ›", pageHeader.crumb("Inbox/2026-10-02/11-17-18"))
      assert(pageHeader.crumb("Inbox/2026-10-02/notes") == "Inbox › 2026-10-02 ›")
      assert(pageHeader.crumb(nil) == nil)
    `);
  });

  test("the crumb is always written above a cover or an icon; the style hides it on a wide screen", async () => {
    await runLua(`
      decoration = { icon = "🌸" }
      local md = pageHeader.markdown()
      assert(string.find(md, '<span class="sb-page-crumb">Projects ›</span>', 1, true), md)
      assert(string.find(md, "# 🌸", 1, true), md)
      decoration = { cover = "Images/desk.jpg" }
      md = pageHeader.markdown()
      assert(string.find(md, "sb-page-crumb", 1, true) and string.find(md, "![cover](Images/desk.jpg)", 1, true), md)
      -- crumb before the cover, cover before the icon
      decoration = { cover = "/Images/desk.jpg", icon = "🌸" }
      md = pageHeader.markdown()
      local crumb, cover, icon = string.find(md, "sb-page-crumb", 1, true), string.find(md, "![cover]", 1, true), string.find(md, "# 🌸", 1, true)
      assert(crumb < cover and cover < icon, md)
      assert(string.find(md, "![cover](Images/desk.jpg)", 1, true), "leading slash dropped: " .. md)
    `);
  });

  test("a top-level page has no crumb; a folder page with nothing else is the crumb alone, at any width", async () => {
    await runLua(`
      currentPage = "index"
      decoration = { icon = "📚" }
      local md = pageHeader.markdown()
      assert(not string.find(md, "sb-page-crumb", 1, true), md)
      currentPage = "Projects/Spring Launch"
      decoration = {}
      assert(pageHeader.markdown() == '<span class="sb-page-crumb">Projects ›</span>')
      currentPage = "index"
      assert(pageHeader.markdown() == nil)
    `);
  });

  test("the library no longer asks the screen's width", () => {
    expect(librarySource).not.toMatch(/matchMedia|isPhone/);
  });
});

describe("Page Header style", () => {
  test("cover 180 px (120 on a phone), icon 64 px on the cover's edge, crumb dim and phone-only", () => {
    expect(pageSource).toMatch(/height: 180px/);
    expect(pageSource).toMatch(
      /@media \(max-width: 600px\)[\s\S]*height: 120px/,
    );
    expect(pageSource).toMatch(/font-size: 64px/);
    expect(pageSource).toMatch(/margin-top: -24px/);
    expect(pageSource).toMatch(
      /\.sb-page-crumb \{[^}]*font-size: 12\.5px;[^}]*var\(--sb-ink-2/,
    );
    expect(pageSource).toMatch(
      /@media \(min-width: 601px\)[\s\S]*sb-page-crumb[\s\S]*display: none/,
    );
    // a header that is only the crumb has no frame on a wide screen
    expect(pageSource).toMatch(/:not\(:has\(img\[alt="cover"\], h1\)\)/);
  });
});
