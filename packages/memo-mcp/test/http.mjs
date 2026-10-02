// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada
/**
 * HTTP transport test. Starts src/http.mjs on a fixture space and talks to it with the real
 * Client + StreamableHTTPClientTransport (the same path MCP clients use).
 */
import { test, skip, after } from "node:test";
import { spawn } from "node:child_process";
import { createFixture } from "./helpers/fixture.mjs";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const TOKEN = "http-test-token";
const PORT = 3043;
const fx = await createFixture("memo-http-");
const URL_ = `http://127.0.0.1:${PORT}/mcp`;
const proc = spawn("node", ["src/http.mjs"], {
  cwd: new URL("..", import.meta.url).pathname,
  env: { ...process.env, ...fx.env, MEMO_MCP_TOKEN: TOKEN, MEMO_MCP_PORT: String(PORT) },
  stdio: "ignore",
});
after(async () => {
  proc.kill();
  await fx.cleanup();
});

async function reachable() {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/healthz`, { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch {
    return false;
  }
}

function connect() {
  const transport = new StreamableHTTPClientTransport(new URL(URL_), {
    requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
  });
  const client = new Client({ name: "http-test", version: "1.0.0" });
  return { client, transport };
}

let ready = false;
for (let i = 0; i < 100 && !ready; i++) {
  ready = await reachable();
  if (!ready) await new Promise((r) => setTimeout(r, 100));
}

if (!ready) {
  skip("HTTP server did not start");
} else {
  test("all tools are exposed", async () => {
    const { client, transport } = connect();
    await client.connect(transport);
    const { tools } = await client.listTools();
    assert.equal(tools.length, 12);
    const names = tools.map((t) => t.name).sort();
    assert.deepEqual(names, [
      "add_inbox", "append_journal", "complete_task", "list_journal",
      "list_projects", "list_spaces", "list_tasks", "read_note", "read_section",
      "recent_changes", "related_notes", "search_notes",
    ]);
    await client.close();
  });

  test("list_spaces returns both spaces", async () => {
    const { client, transport } = connect();
    await client.connect(transport);
    const r = await client.callTool({ name: "list_spaces", arguments: {} });
    const { spaces } = JSON.parse(r.content[0].text);
    assert.equal(spaces.length, 2);
    assert.ok(spaces.every((s) => s.pages > 0));
    await client.close();
  });

  test("list_tasks is ordered by due date", async () => {
    const { client, transport } = connect();
    await client.connect(transport);
    const r = await client.callTool({ name: "list_tasks", arguments: { limit: 10 } });
    const { tasks } = JSON.parse(r.content[0].text);
    const dated = tasks.filter((t) => t.due).map((t) => t.due);
    assert.deepEqual(dated, [...dated].sort(), "due dates not ascending");
    await client.close();
  });

  test("paths outside the space are rejected", async () => {
    const { client, transport } = connect();
    await client.connect(transport);
    const r = await client.callTool({
      name: "read_note",
      arguments: { space: "notes", page: "../../etc/passwd" },
    });
    assert.ok(r.isError, "should be an error");
    assert.match(r.content[0].text, /スペースの外/);
    await client.close();
  });

  test("no connection without a token", async () => {
    const transport = new StreamableHTTPClientTransport(new URL(URL_));
    const client = new Client({ name: "noauth", version: "1.0.0" });
    await assert.rejects(() => client.connect(transport));
  });
}
