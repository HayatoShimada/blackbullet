// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada
// Smoke test: start the stdio MCP server on a fixture space and call each kind of tool
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createFixture } from "./helpers/fixture.mjs";

test("tools list and basic calls work", async () => {
  const fx = await createFixture("memo-smoke-");
  await fs.writeFile(`${fx.notes}/Projects/Finished.md`, "---\ntags: project\nstatus: done\n---\n\n# Finished\n\nwrapped up.\n");
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
    assert.equal(tools.length, 14);

    const spaces = JSON.parse((await call("list_spaces")).text);
    assert.equal(spaces.spaces.length, 2);

    const pj = JSON.parse((await call("list_projects", {})).text);
    assert.ok(pj.count >= 2);
    assert.ok(!pj.projects.some((p) => p.page === "Projects/Finished"), "done project is excluded by default");
    const demo = pj.projects.find((p) => p.page === "Projects/Demo");
    assert.equal(demo.open_tasks, 3, "2 open lines + 1 open todo page");
    assert.equal(demo.done_tasks, 2, "1 done line + 1 done todo page");
    const all = JSON.parse((await call("list_projects", { status: "all" })).text);
    assert.ok(all.projects.some((p) => p.page === "Projects/Finished"));

    // list_tasks: todo pages + checkbox lines
    const open = JSON.parse((await call("list_tasks", { space: "notes" })).text).tasks;
    const pages = open.filter((t) => t.kind === "page");
    assert.deepEqual(pages.map((t) => t.page).sort(), ["Tasks/Book venue", "Tasks/Buy stamps"]);
    const venue = pages.find((t) => t.page === "Tasks/Book venue");
    assert.equal(venue.title, "Book venue");
    assert.equal(venue.status, "next");
    assert.equal(venue.done, false);
    assert.equal(venue.due, "2026-09-18");
    assert.equal(venue.project, "Projects/Demo");
    assert.equal(venue.area, "Areas/Operations");
    assert.equal(venue.completed, null);
    assert.ok(open.some((t) => t.kind === "line" && t.text.includes("Prepare the images")));
    assert.equal(open[0].page, "Tasks/Book venue", "earliest due first");
    const doneP = JSON.parse((await call("list_tasks", { space: "notes", done: true })).text).tasks.filter((t) => t.kind === "page");
    assert.deepEqual(doneP.map((t) => [t.page, t.done, t.completed]), [["Tasks/Send invoice", true, "2026-09-09"]]);
    const inbox = JSON.parse((await call("list_tasks", { space: "notes", status: "inbox" })).text).tasks;
    assert.deepEqual(inbox.map((t) => t.page), ["Tasks/Buy stamps"]);
    const byProj = JSON.parse((await call("list_tasks", { space: "notes", project: "Projects/Demo" })).text).tasks;
    assert.deepEqual(byProj.filter((t) => t.kind === "page").map((t) => t.page), ["Tasks/Book venue"]);
    const byTag = JSON.parse((await call("list_tasks", { space: "notes", tag: "event" })).text).tasks;
    assert.deepEqual(byTag.map((t) => t.page), ["Tasks/Book venue"]);
    const dueB = JSON.parse((await call("list_tasks", { space: "notes", due_before: "2026-09-18" })).text).tasks;
    assert.ok(dueB.every((t) => t.due && t.due <= "2026-09-18"));

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
