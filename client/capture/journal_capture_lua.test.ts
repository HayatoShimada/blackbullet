// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada
import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";
import { extractSpaceLuaFromPageText } from "../boot_config.ts";
import { evalStatement } from "../space_lua/eval.ts";
import { parseBlock } from "../space_lua/parse.ts";
import { jsToLuaValue, LuaEnv, LuaStackFrame } from "../space_lua/runtime.ts";
import { luaBuildStandardEnv } from "../space_lua/stdlib.ts";

type Service = {
  selector: string;
  match: (data: unknown) => Promise<{ name: string } | null>;
  run: (data: unknown) => Promise<void>;
};

async function load(pages: Map<string, string>, settings = {}) {
  const source = await readFile(
    new URL("../../libraries/Library/Std/APIs/Capture.md", import.meta.url),
    "utf8",
  );
  const env = new LuaEnv(luaBuildStandardEnv());
  const services: Service[] = [];
  const navigated: string[] = [];
  const values: Record<string, unknown> = {
    "journal.prefix": "Journal/",
    "journal.tag": "journal",
    ...settings,
  };
  env.set(
    "service",
    jsToLuaValue({ define: (s: Service) => services.push(s) }),
  );
  env.set(
    "config",
    jsToLuaValue({
      defineCategory: () => undefined,
      define: () => undefined,
      get: (key: string, fallback: unknown) =>
        key in values ? values[key] : fallback,
    }),
  );
  env.set("date", jsToLuaValue({ today: () => "2026-11-05" }));
  env.set(
    "space",
    jsToLuaValue({
      pageExists: (name: string) => pages.has(name),
      readPage: (name: string) => pages.get(name),
      writePage: (name: string, content: string) => {
        pages.set(name, content);
      },
    }),
  );
  env.set(
    "editor",
    jsToLuaValue({ navigate: (page: string) => navigated.push(page) }),
  );
  const block = parseBlock(extractSpaceLuaFromPageText(source));
  await evalStatement(
    block,
    env,
    LuaStackFrame.createWithGlobalEnv(env, block.ctx),
  );
  const journal = services.find(
    (s) => s.selector === "capture" && s !== services[0],
  )!;
  return { journal, navigated };
}

const at = new Date(2026, 10, 5, 9, 12).getTime();
const draft = (over = {}) => ({
  id: "x",
  receivedAt: at,
  title: "",
  text: "Buy rice\nand miso",
  url: "",
  files: [],
  ...over,
});

test("a capture becomes one timed item at the end of today's journal", async () => {
  const pages = new Map([
    ["Journal/2026-11-05", "---\ntags: journal\n---\n* morning"],
  ]);
  const { journal, navigated } = await load(pages);
  expect((await journal.match(draft()))?.name).toBe("Add to today's journal");
  await journal.run(draft());
  expect(pages.get("Journal/2026-11-05")).toBe(
    "---\ntags: journal\n---\n* morning\n* 09:12 Buy rice\n  and miso\n",
  );
  expect(navigated).toEqual(["Journal/2026-11-05"]);
});

test("a missing journal page is created as a journal page", async () => {
  const pages = new Map<string, string>();
  const { journal } = await load(pages);
  await journal.run(draft({ title: "Idea", text: "", url: "https://x.test" }));
  expect(pages.get("Journal/2026-11-05")).toBe(
    "---\ntags: journal\ndate: 2026-11-05\n---\n* 09:12 Idea — https://x.test\n",
  );
});

test("not offered with files or when turned off; an empty capture is refused", async () => {
  const pages = new Map<string, string>();
  const { journal } = await load(pages);
  expect(
    await journal.match(
      draft({ files: [{ handle: "h", name: "a", size: 1 }] }),
    ),
  ).toBeFalsy();
  await expect(journal.run(draft({ text: "" }))).rejects.toThrow(/empty/);
  expect(pages.size).toBe(0);
  const off = await load(new Map(), { "capture.journal": false });
  expect(await off.journal.match(draft())).toBeFalsy();
});
