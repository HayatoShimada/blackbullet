// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada
// Checks that the `line` returned by list_tasks matches the real file line, for every task in the fixture
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import fs from "node:fs/promises";
import { createFixture } from "./helpers/fixture.mjs";

test("task line numbers match the files", async () => {
  const fx = await createFixture("memo-lineno-");
  const roots = { notes: fx.notes, work: fx.work };
  const transport = new StdioClientTransport({
    command: "node",
    args: [fileURLToPath(new URL("../src/stdio.mjs", import.meta.url))],
    env: { ...process.env, ...fx.env },
    stderr: "ignore",
  });
  const client = new Client({ name: "lt", version: "1.0.0" });
  await client.connect(transport);
  try {
    const call = async (n, a = {}) => JSON.parse((await client.callTool({ name: n, arguments: a })).content[0].text);
    let checked = 0;
    for (const done of [false, true]) {
      const { tasks } = await call("list_tasks", { done, limit: 200 });
      for (const t of tasks) {
        const lines = (await fs.readFile(`${roots[t.space]}/${t.page}.md`, "utf-8")).split(/\r?\n/);
        assert.match(lines[t.line - 1] ?? "", /^\s*\*\s\[[ xX]\]/, `${t.space}/${t.page}:${t.line}`);
        checked++;
      }
    }
    assert.ok(checked >= 4, `checked=${checked}`);
  } finally {
    await client.close();
    await fx.cleanup();
  }
});
