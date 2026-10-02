// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada
// REST API（/api/*）の検証。一時スペースに対して http.mjs を別プロセスで起動して叩く。実データは使わない。
// 意味検索の部分は埋め込みモデルのキャッシュ（MEMO_TEST_MODELS、既定 ~/.cache/memo-mcp/models）が読めるときだけ走らせる。
import http from "node:http";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createFixture } from "./helpers/fixture.mjs";

const TOKEN = "rest-test-token";
// Optional: a local embedding model cache. Semantic tests run only if it exists (never downloads).
const MODELS = process.env.MEMO_TEST_MODELS ?? path.join(os.homedir(), ".cache", "memo-mcp", "models");
const haveModel = await fs.access(MODELS).then(() => true, () => false);

const fx = await createFixture("memo-rest-");
const tmp = fx.tmp;

async function start(port, env) {
  const proc = spawn("node", ["src/http.mjs"], {
    cwd: new URL("..", import.meta.url).pathname,
    env: {
      ...process.env,
      MEMO_MCP_TOKEN: TOKEN,
      MEMO_MCP_PORT: String(port),
      MEMO_SPACES: fx.spacesEnv,
      ...env,
    },
    stdio: "ignore",
  });
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/healthz`)).ok) return proc;
    } catch { /* まだ */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  proc.kill();
  throw new Error("サーバーが起動しない");
}

// body（文字列ならそのまま、それ以外は JSON）を付けると POST になる
const api = (port) => async (p, { token = TOKEN, body, method = body === undefined ? "GET" : "POST" } = {}) => {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const init = { method, headers };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = typeof body === "string" ? body : JSON.stringify(body);
  }
  const r = await fetch(`http://127.0.0.1:${port}/api/${p}`, init);
  return { status: r.status, body: await r.json(), headers: r.headers };
};

// Host ヘッダを指定して /api を叩く（fetch では Host を差し替えにくい）
const withHost = (port, host) =>
  new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path: "/api/search?space=notes&q=test", headers: { Host: host, Authorization: `Bearer ${TOKEN}` } }, (res) => {
      res.resume();
      res.on("end", () => resolve(res.statusCode));
    }).on("error", reject);
  });

const OFF_PORT = 3041;
const ON_PORT = 3042;
// 埋め込みは有効だがモデルが取得できない（オフライン / 初回ダウンロード失敗）状況。配布元を閉じたポートに向ける
const FAIL_PORT = 3043;
let off, on, fail;

before(async () => {
  await fs.mkdir(path.join(tmp, "idx-off"));
  off = await start(OFF_PORT, { MEMO_EMBED: "off", MEMO_INDEX_DIR: path.join(tmp, "idx-off"), MEMO_MCP_EXTRA_HOSTS: "host.docker.internal:3010" });
  await fs.mkdir(path.join(tmp, "idx-fail"));
  fail = await start(FAIL_PORT, {
    MEMO_EMBED: "on",
    MEMO_EMBED_MODEL: "nobody/no-such-model",
    MEMO_EMBED_REMOTE_HOST: "http://127.0.0.1:1/",
    MEMO_INDEX_DIR: path.join(tmp, "idx-fail"),
  });
  if (haveModel) {
    await fs.mkdir(path.join(tmp, "idx-on"));
    await fs.symlink(MODELS, path.join(tmp, "idx-on", "models"));
    on = await start(ON_PORT, { MEMO_EMBED: "on", MEMO_INDEX_DIR: path.join(tmp, "idx-on") });
  }
});
after(async () => {
  off?.kill();
  on?.kill();
  fail?.kill();
  await fs.rm(tmp, { recursive: true, force: true });
});

test("モデルが取得できないとき: search は語彙検索 + warning、related はリンクのみ、graph は辺なし（500 にしない）", async () => {
  const a = api(FAIL_PORT);
  const s = await a("search?space=notes&q=" + encodeURIComponent("demo launch campaign") + "&limit=3");
  assert.equal(s.status, 200);
  assert.equal(s.body.mode, "lexical");
  assert.ok(s.body.results.length >= 1);
  assert.match(s.body.warning, /意味検索が今は使えません/);
  // 2 回目も同じ（失敗を覚え込んで以後ずっと落ちる、にならない）
  assert.equal((await a("search?space=notes&q=demo")).status, 200);
  const r = await a("related?space=notes&page=" + encodeURIComponent("Projects/Demo"));
  assert.equal(r.status, 200);
  assert.ok(r.body.results.every((x) => x.via === "link"));
  const g = await a("graph?space=notes");
  assert.equal(g.status, 200);
  assert.deepEqual(g.body.edges, []);
});

test("認証なし / 違うトークンは 401", async () => {
  const a = api(OFF_PORT);
  assert.equal((await a("search?space=notes&q=x", { token: null })).status, 401);
  assert.equal((await a("search?space=notes&q=x", { token: "bad" })).status, 401);
});

test("対応しないメソッドは 405 + Allow、未知のパスは 404", async () => {
  const a = api(OFF_PORT);
  const post = await a("search?space=notes&q=x", { method: "POST" });
  assert.equal(post.status, 405);
  assert.equal(post.headers.get("allow"), "GET");
  const get = await a("ask?space=notes&q=x");
  assert.equal(get.status, 405);
  assert.equal(get.headers.get("allow"), "POST");
  assert.equal((await a("nothing?space=notes")).status, 404);
});

test("ask: 質問に関係する節が本文と ref つきで返る", async () => {
  const { status, body } = await api(OFF_PORT)("ask", { body: { space: "notes", q: "demo launch campaign", k: 3 } });
  assert.equal(status, 200);
  assert.equal(body.question, "demo launch campaign");
  assert.equal(body.mode, "lexical");
  assert.equal(body.confidential, false);
  assert.ok(body.warning, "MEMO_EMBED=off なので warning が付く");
  assert.ok(body.sections.length >= 1 && body.sections.length <= 3);
  const top = body.sections[0];
  assert.equal(top.page, "Projects/Demo");
  assert.ok(Array.isArray(top.heading_path) && top.heading_path.includes("Outcome"), JSON.stringify(top.heading_path));
  assert.match(top.text, /demo launch campaign/);
  assert.equal(top.ref, `Projects/Demo@L${top.heading_line}`);
  for (const s of body.sections) {
    assert.equal(typeof s.text, "string");
    assert.ok(s.text.length > 0);
    assert.match(s.ref, /^[^@]+(@L\d+)?$/);
    assert.ok(Number.isInteger(s.line_start) && s.line_end >= s.line_start);
  }
  // space はクエリ文字列でも指定できる
  const viaQuery = await api(OFF_PORT)("ask?space=notes", { body: { q: "newsletter", mode: "lexical" } });
  assert.equal(viaQuery.status, 200);
  assert.equal(viaQuery.body.warning, undefined);
  assert.ok(viaQuery.body.sections.length >= 1);
});

test("ask: q 必須、k・mode の不正と壊れた JSON は 400", async () => {
  const a = api(OFF_PORT);
  assert.equal((await a("ask", { body: { space: "notes" } })).status, 400);
  assert.equal((await a("ask", { body: { space: "notes", q: "x".repeat(501) } })).status, 400);
  assert.equal((await a("ask", { body: { space: "notes", q: "x", k: 0 } })).status, 400);
  assert.equal((await a("ask", { body: { space: "notes", q: "x", k: 21 } })).status, 400);
  assert.equal((await a("ask", { body: { space: "notes", q: "x", k: "8" } })).status, 400);
  assert.equal((await a("ask", { body: { space: "notes", q: "x", mode: "bogus" } })).status, 400);
  const broken = await a("ask?space=notes", { body: "{not json" });
  assert.equal(broken.status, 400);
  assert.ok(broken.body.error);
  assert.equal((await a("ask?space=notes", { body: "[1]" })).status, 400);
  assert.equal((await a("ask", { body: { q: "x" } })).status, 400, "space なし");
  assert.equal((await a("ask", { body: { space: "nope", q: "x" } })).status, 404);
  // 4 MiB を超える body は 413（Content-Length で読む前に弾く）
  const big = await a("ask", { body: JSON.stringify({ space: "notes", q: "x", pad: "p".repeat(4 * 1024 * 1024 + 1) }) });
  assert.equal(big.status, 413);
  assert.ok(big.body.error);
});

test("ask: work は confidential=true で返る", async () => {
  const { status, body } = await api(OFF_PORT)("ask", { body: { space: "work", q: "会議メモ" } });
  assert.equal(status, 200);
  assert.equal(body.confidential, true);
  assert.ok(body.sections.every((s) => s.page === "Areas/Team"));
});

test("space が無い / 未知のとき 400 / 404 と {error}", async () => {
  const a = api(OFF_PORT);
  const r1 = await a("search?q=x");
  assert.equal(r1.status, 400);
  assert.ok(r1.body.error);
  const r2 = await a("search?space=nope&q=x");
  assert.equal(r2.status, 404);
  assert.ok(r2.body.error);
});

test("search: 契約どおりの形で節が返る（lexical）", async () => {
  const { status, body } = await api(OFF_PORT)("search?space=notes&q=" + encodeURIComponent("demo launch campaign") + "&limit=3");
  assert.equal(status, 200);
  assert.ok(body.results.length >= 1 && body.results.length <= 3);
  const top = body.results[0];
  assert.equal(top.page, "Projects/Demo");
  assert.ok(Array.isArray(top.heading_path));
  assert.ok(Number.isInteger(top.line_start) && top.line_end >= top.line_start);
  assert.equal(top.heading_line, top.line_start - 1, "見出し行は line_start の 1 行前");
  for (const r of body.results) assert.ok(r.heading_line === null || r.heading_line === r.line_start - 1);
  assert.equal(typeof top.snippet, "string");
  assert.equal(typeof top.score, "number");
  assert.ok(Number.isInteger(top.ranks.lexical));
  assert.equal(top.ranks.semantic, null);
});

test("search: q 必須 / mode・limit の不正は 400", async () => {
  const a = api(OFF_PORT);
  assert.equal((await a("search?space=notes")).status, 400);
  assert.equal((await a("search?space=notes&q=x&mode=bogus")).status, 400);
  assert.equal((await a("search?space=notes&q=x&limit=0")).status, 400);
  assert.equal((await a("search?space=notes&q=x&limit=abc")).status, 400);
});

test("search: スペースごとに分かれ、work は confidential", async () => {
  const a = api(OFF_PORT);
  const n = await a("search?space=work&q=" + encodeURIComponent("会議メモ"));
  assert.equal(n.status, 200);
  assert.equal(n.body.confidential, true);
  assert.ok(n.body.results.every((r) => r.page === "Areas/Team"));
  const m = await a("search?space=notes&q=" + encodeURIComponent("会議メモ"));
  assert.ok(m.body.results.every((r) => r.page !== "Areas/Team"));
  assert.equal(m.body.confidential, false);
});

test("MEMO_EMBED=off: semantic 指定は空 + warning、lexical は通る", async () => {
  const a = api(OFF_PORT);
  const s = await a("search?space=notes&mode=semantic&q=" + encodeURIComponent("newsletter"));
  assert.equal(s.status, 200);
  assert.deepEqual(s.body.results, []);
  assert.ok(s.body.warning);
  const h = await a("search?space=notes&q=" + encodeURIComponent("newsletter"));
  assert.ok(h.body.results.length >= 1);
  assert.equal(h.body.mode, "lexical");
});

test("MEMO_EMBED=off: graph は edges 空 + warning、nodes は日報を除いて返る", async () => {
  const { status, body } = await api(OFF_PORT)("graph?space=notes");
  assert.equal(status, 200);
  assert.deepEqual(body.edges, []);
  assert.ok(body.warning);
  const ids = body.nodes.map((n) => n.id).sort();
  assert.deepEqual(ids, ["Areas/Operations", "Projects/Demo", "Projects/在庫システム", "Resources/Reading List"]);
  const sw = body.nodes.find((n) => n.id === "Projects/Demo");
  assert.equal(sw.title, "Demo");
  assert.deepEqual(sw.tags, ["project"]);
  const j = await api(OFF_PORT)("graph?space=notes&include_journal=1");
  assert.ok(j.body.nodes.some((n) => n.id === "Journal/2026-09-20"));
});

test("related: リンク（双方向）が via=link で返り、存在しないページは 404", async () => {
  const a = api(OFF_PORT);
  const r = await a("related?space=notes&page=" + encodeURIComponent("Projects/Demo"));
  assert.equal(r.status, 200);
  const hit = r.body.results.find((x) => x.page === "Areas/Operations");
  assert.equal(hit?.via, "link");
  assert.ok(r.body.warning);
  assert.equal((await a("related?space=notes&page=nope")).status, 404);
  assert.equal((await a("related?space=notes")).status, 400);
});

test("graph: k / threshold の不正は 400、未知の page は 404", async () => {
  const a = api(OFF_PORT);
  assert.equal((await a("graph?space=notes&k=0")).status, 400);
  assert.equal((await a("graph?space=notes&threshold=2")).status, 400);
  assert.equal((await a("graph?space=notes&page=nope")).status, 404);
});

if (!haveModel) {
  test("意味検索の REST テスト", { skip: "埋め込みモデルのキャッシュが無いので skip" }, () => {});
} else {
  test("search: hybrid で semantic の順位も入る", { timeout: 120000 }, async () => {
    const { body } = await api(ON_PORT)("search?space=notes&q=" + encodeURIComponent("在庫を数える仕組み"));
    assert.equal(body.mode, "hybrid");
    assert.equal(body.results[0].page, "Projects/在庫システム");
    assert.ok(body.results.some((r) => Number.isInteger(r.ranks.semantic)));
  });

  test("graph: k と threshold が効き、日報は既定で入らない", { timeout: 120000 }, async () => {
    const a = api(ON_PORT);
    const all = await a("graph?space=notes&k=1&threshold=0");
    assert.equal(all.status, 200);
    assert.ok(all.body.edges.length >= 1);
    const ids = new Set(all.body.nodes.map((n) => n.id));
    assert.ok(!ids.has("Journal/2026-09-20"));
    for (const e of all.body.edges) {
      assert.equal(e.kind, "semantic");
      assert.ok(ids.has(e.from) && ids.has(e.to));
      assert.ok(e.score >= 0 && e.score <= 1);
    }
    // k=1: 各ページが選ぶ辺は 1 本なので、辺の数はノード数以下
    assert.ok(all.body.edges.length <= all.body.nodes.length);
    const none = await a("graph?space=notes&threshold=1");
    assert.deepEqual(none.body.edges, []);
    assert.equal(none.body.warning, undefined);
    const withJ = await a("graph?space=notes&k=3&threshold=0&include_journal=1");
    assert.ok(withJ.body.nodes.some((n) => n.id === "Journal/2026-09-20"));
  });

  test("graph?page= はそのページに触れる辺だけ", { timeout: 120000 }, async () => {
    const p = "Projects/在庫システム";
    const { body } = await api(ON_PORT)("graph?space=notes&threshold=0&page=" + encodeURIComponent(p));
    assert.ok(body.edges.length >= 1);
    assert.ok(body.edges.every((e) => e.from === p || e.to === p));
    assert.ok(body.nodes.some((n) => n.id === p));
  });

  test("related: 意味的な近傍が via=semantic / both で入る", { timeout: 120000 }, async () => {
    const { body } = await api(ON_PORT)("related?space=notes&limit=5&page=" + encodeURIComponent("Projects/Demo"));
    assert.ok(body.results.length >= 1 && body.results.length <= 5);
    assert.ok(body.results.every((r) => ["semantic", "link", "both"].includes(r.via)));
    assert.ok(!body.results.some((r) => r.page.startsWith("Journal/")));
    assert.equal(body.warning, undefined);
  });
}

test("CONFIG.md（トークンを置く場所）は検索に出ない", async () => {
  const { status, body } = await api(OFF_PORT)("search?space=notes&q=" + encodeURIComponent("SECRET-TOKEN-XYZ memoSidecar") + "&limit=10");
  assert.equal(status, 200);
  assert.ok(!body.results.some((r) => r.page === "CONFIG" || r.snippet.includes("SECRET-TOKEN")));
});

test("MEMO_MCP_EXTRA_HOSTS の Host だけ追加で許可される", async () => {
  assert.equal(await withHost(OFF_PORT, "host.docker.internal:3010"), 200);
  assert.equal(await withHost(OFF_PORT, "evil.example:3010"), 403);
});
