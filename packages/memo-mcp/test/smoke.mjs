// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada
// Smoke test: start the stdio MCP server on a fixture space and call each kind of tool
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createFixture } from "./helpers/fixture.mjs";

test("tools list and basic calls work", async () => {
  const fx = await createFixture("memo-smoke-");
  const transport = new StdioClientTransport({
    command: "node",
    args: [fileURLToPath(new URL("../src/stdio.mjs", import.meta.url))],
    env: { ...process.env, ...fx.env },
    stderr: "ignore",
  });
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(transport);
  const call = async (name, args = {}) => {
    const r = await client.callTool({ name, arguments: args });
    return { isError: r.isError ?? false, text: r.content?.[0]?.text ?? "" };
  };
  try {
    const { tools } = await client.listTools();
    assert.equal(tools.length, 12);

    const spaces = JSON.parse((await call("list_spaces")).text);
    assert.equal(spaces.spaces.length, 2);

    const pj = JSON.parse((await call("list_projects", {})).text);
    assert.ok(pj.count >= 2);

    const tj = JSON.parse((await call("list_tasks", { limit: 6 })).text);
    const dated = tj.tasks.filter((t) => t.due).map((t) => t.due);
    assert.deepEqual(dated, [...dated].sort());

    const sj = JSON.parse((await call("search_notes", { query: "newsletter", limit: 3 })).text);
    assert.ok(sj.count >= 1);

    const rj = JSON.parse((await call("read_note", { space: "notes", page: "Projects/Demo" })).text);
    assert.deepEqual(rj.tags, ["project"]);
    assert.match(rj.body, /## Outcome/);

    const out = await call("read_note", { space: "notes", page: "../../etc/passwd" });
    assert.ok(out.isError);
    const missing = await call("read_note", { space: "notes", page: "NoSuchPage" });
    assert.ok(missing.isError);
    // CONFIG（トークンや API キーの置き場）はどの表記でも読めない
    for (const page of ["CONFIG", "CONFIG.md", "config", "./CONFIG"]) {
      const cfg = await call("read_note", { space: "notes", page });
      assert.ok(cfg.isError, `read_note ${page} must fail`);
      assert.ok(!cfg.text.includes("SECRET-TOKEN"), `read_note ${page} must not leak the token`);
    }
  } finally {
    await client.close();
    await fx.cleanup();
  }
});
