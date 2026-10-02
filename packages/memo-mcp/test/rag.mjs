// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada
// MCP client end-to-end over stdio against a fixture space: search -> read_section -> related -> resources
import { fileURLToPath } from "node:url";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createFixture } from "./helpers/fixture.mjs";

const fx = await createFixture("memo-rag-");
const transport = new StdioClientTransport({
  command: "node",
  args: [fileURLToPath(new URL("../src/stdio.mjs", import.meta.url))],
  env: { ...process.env, ...fx.env },
  stderr: "ignore",
});
const client = new Client({ name: "rag-test", version: "0" });
await client.connect(transport);
const call = async (name, args) => JSON.parse((await client.callTool({ name, arguments: args })).content[0].text);
after(async () => {
  await client.close();
  await fx.cleanup();
});

test("search_notes -> read_section line numbers match", async () => {
  const r = await call("search_notes", { query: "demo launch campaign", space: "notes", limit: 3 });
  assert.ok(r.count >= 1);
  const top = r.results[0];
  assert.match(top.page, /Demo/);
  assert.ok(top.why.includes("lexical"));
  const sec = await call("read_section", { space: "notes", page: top.page, line_start: top.line_start });
  assert.equal(sec.line_start, top.line_start);
  assert.match(sec.text.split("\n")[0], new RegExp(`^${top.line_start}: `));
  assert.ok(sec.modified);
});

test("results from a confidential space carry the flag and a notice", async () => {
  const r = await call("search_notes", { query: "会議", space: "work", limit: 2 });
  assert.ok(r.count >= 1);
  assert.ok(r.results.every((x) => x.confidential === true));
  assert.ok(r.note && r.note.includes("confidential"));
  const n = await call("search_notes", { query: "newsletter", space: "notes", limit: 2 });
  assert.ok(n.results.every((x) => x.confidential === false));
});

test("related_notes returns backlinks", async () => {
  const r = await call("related_notes", { space: "notes", page: "Areas/Operations" });
  assert.ok(r.backlinks.length >= 2, `backlinks=${r.backlinks.length}`);
  assert.ok(Array.isArray(r.similar));
});

test("recent_changes / list_tasks / list_projects come from the index", async () => {
  const rc = await call("recent_changes", { space: "notes", days: 365, limit: 3 });
  assert.ok(rc.count >= 3 && rc.pages[0].modified >= rc.pages[1].modified);
  const lt = await call("list_tasks", { space: "notes", limit: 5 });
  assert.ok(lt.tasks.every((t) => t.done === undefined || t.done === false));
  const lp = await call("list_projects", { space: "notes" });
  assert.ok(lp.projects.every((p) => p.status === "active"));
  assert.ok(lp.projects.some((p) => typeof p.open_tasks === "number"));
});

test("resources list pages and read returns the body", async () => {
  const list = await client.listResources();
  const one = list.resources.find((r) => r.uri.startsWith("memo://notes/Projects/"));
  assert.ok(one, "no project resource in notes");
  const got = await client.readResource({ uri: one.uri });
  assert.match(got.contents[0].text, /## Outcome/);
});

test("list_spaces reports index stats and the embedding model", async () => {
  const r = await call("list_spaces", {});
  assert.ok(r.spaces[0].index.sections >= 5);
  assert.ok(r.embedding);
  assert.equal(r.spaces.find((s) => s.space === "work").confidential, true);
});
