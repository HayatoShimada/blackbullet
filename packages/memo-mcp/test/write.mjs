// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada
// 書き込み系の検証。実データを汚さないよう一時スペースに対してだけ書く。
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TMP = await fs.mkdtemp(path.join(os.tmpdir(), "memo-write-"));
await fs.mkdir(`${TMP}/Journal`, { recursive: true });
await fs.mkdir(`${TMP}/Projects`, { recursive: true });
await fs.writeFile(`${TMP}/Journal/2026-09-17.md`,
  `---\ntags: journal\n---\n\n# 2026-09-17\n\n## Done\n\n* [x] existing line\n\n## Review\n\n- ok\n`);
// 行番号: 10 = 未完了タスク, 11 = 完了済みタスク, 6 = 見出し
await fs.writeFile(`${TMP}/Projects/Sample.md`,
  `---\nstatus: active\ntags: project\n---\n\n# Sample\n\n## Next actions\n\n* [ ] Open task #next [due: 2026-09-20]\n* [x] Finished task\n`);

const transport = new StdioClientTransport({
  command: "node",
  args: [fileURLToPath(new URL("../src/stdio.mjs", import.meta.url))],
  env: { ...process.env, MEMO_SPACES: `notes=${TMP}`, MEMO_INDEX_DIR: `${TMP}.idx`, MEMO_EMBED: "off" },
  stderr: "ignore",
});
const client = new Client({ name: "wtest", version: "1.0.0" });
await client.connect(transport);
const call = async (n, a = {}) => {
  const r = await client.callTool({ name: n, arguments: a });
  return { isError: r.isError ?? false, text: r.content?.[0]?.text ?? "" };
};
const PAGE = "Projects/Sample";
// 実データを書き換えないための確認: このページは一時スペースにしか無い。見えなければ env が効いていないので何も書かず止める
assert.equal((await call("read_note", { space: "notes", page: PAGE })).isError, false, "一時スペースが使われていません（実データを書く恐れがあるため中止）");

after(async () => {
  await client.close();
  await fs.rm(TMP, { recursive: true, force: true });
  await fs.rm(`${TMP}.idx`, { recursive: true, force: true });
});

test("古い expected_modified は競合として中断し、ファイルは変わらない", async () => {
  const before = await fs.readFile(`${TMP}/${PAGE}.md`, "utf8");
  const r = await call("complete_task", { space: "notes", page: PAGE, line: 10, expected_modified: "2020-01-01T00:00:00.000Z" });
  assert.equal(r.isError, true);
  assert.doesNotMatch(r.text, /ページが見つかりません/);
  assert.equal(await fs.readFile(`${TMP}/${PAGE}.md`, "utf8"), before);
});

test("タスクでない行は拒否される", async () => {
  const r = await call("complete_task", { space: "notes", page: PAGE, line: 6 });
  assert.equal(r.isError, true);
  assert.match(r.text, /タスクではありません/);
});

test("完了済みタスクの再完了は拒否される", async () => {
  const r = await call("complete_task", { space: "notes", page: PAGE, line: 11 });
  assert.equal(r.isError, true);
  assert.match(r.text, /既に完了/);
});

test("範囲外の行番号は拒否される", async () => {
  const r = await call("complete_task", { space: "notes", page: PAGE, line: 9999 });
  assert.equal(r.isError, true);
  assert.match(r.text, /範囲外/);
});

/** スペース配下の .*.tmp（原子的書き込みの一時ファイル）を再帰で集める */
async function tmpFiles(dir) {
  const out = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await tmpFiles(full)));
    else if (/^\..*\.tmp$/.test(e.name)) out.push(full);
  }
  return out;
}

test("正しい行・最新の modified なら完了にできる（原子的に書かれ、一時ファイルは残らない）", async () => {
  const before = await fs.readFile(`${TMP}/${PAGE}.md`, "utf8");
  const note = JSON.parse((await call("read_note", { space: "notes", page: PAGE })).text);
  const r = await call("complete_task", { space: "notes", page: PAGE, line: 10, expected_modified: note.modified, date: "2026-09-21" });
  assert.equal(r.isError, false, r.text);
  const after = await fs.readFile(`${TMP}/${PAGE}.md`, "utf8");
  assert.equal(
    after,
    before.replace("* [ ] Open task #next [due: 2026-09-20]", "* [x] Open task #next [due: 2026-09-20] [completed: 2026-09-21]")
  );
  assert.deepEqual(await tmpFiles(TMP), []);
});

test("writeAtomic: 新規作成・権限維持・失敗時は元のまま一時ファイルも残さない・リンクは指す先を書く", async () => {
  const { writeAtomic } = await import("../src/space.mjs");
  const dir = await fs.mkdtemp(path.join(TMP, "atomic-"));
  const f = path.join(dir, "new.md");
  await writeAtomic(f, "hello");
  assert.equal(await fs.readFile(f, "utf8"), "hello");

  await fs.chmod(f, 0o640);
  await writeAtomic(f, "second");
  assert.equal((await fs.stat(f)).mode & 0o777, 0o640);
  assert.equal(await fs.readFile(f, "utf8"), "second");

  // リンク先を書き、リンクは残る
  const link = path.join(dir, "link.md");
  await fs.symlink(f, link);
  await writeAtomic(link, "via link");
  assert.ok((await fs.lstat(link)).isSymbolicLink());
  assert.equal(await fs.readFile(f, "utf8"), "via link");

  // rename できない（対象がディレクトリ）なら失敗し、一時ファイルを消す
  const blocked = path.join(dir, "blocked.md");
  await fs.mkdir(blocked);
  await assert.rejects(writeAtomic(blocked, "x"));
  assert.deepEqual(await tmpFiles(dir), []);

  // 長い日本語名でも書ける
  const long = path.join(dir, `${"あ".repeat(80)}.md`);
  await writeAtomic(long, "long");
  assert.equal(await fs.readFile(long, "utf8"), "long");
});

test("同じファイルへの同時書き込みは直列化され、更新が失われない", async () => {
  const { appendToPage, insertUnderHeading, parseSpaces } = await import("../src/space.mjs");
  const spaces = parseSpaces(`notes=${TMP}`);
  const rel = "Projects/Race";
  await fs.writeFile(`${TMP}/${rel}.md`, "# Race\n\n## List\n\n");
  const jobs = [];
  for (let i = 0; i < 15; i++) {
    jobs.push(appendToPage(spaces, "notes", rel, `append-${i}`));
    jobs.push(insertUnderHeading(spaces, "notes", rel, "## List", `insert-${i}`));
  }
  await Promise.all(jobs);
  const text = await fs.readFile(`${TMP}/${rel}.md`, "utf8");
  for (let i = 0; i < 15; i++) {
    assert.ok(text.includes(`append-${i}\n`), `append-${i} が消えた`);
    assert.ok(text.includes(`insert-${i}\n`), `insert-${i} が消えた`);
  }
  assert.deepEqual(await tmpFiles(TMP), []);
});

test("withFileLock は失敗しても次の仕事を止めず、順序を守る", async () => {
  const { withFileLock } = await import("../src/space.mjs");
  const order = [];
  const a = withFileLock("k", async () => {
    await new Promise((r) => setTimeout(r, 30));
    order.push("a");
    throw new Error("boom");
  });
  const b = withFileLock("k", async () => order.push("b"));
  await assert.rejects(a, /boom/);
  await b;
  assert.deepEqual(order, ["a", "b"]);
});

test("doc_status と reindex_docs は MCP から呼べる", async () => {
  await fs.writeFile(`${TMP}/Projects/note.txt`, "plain document text");
  const st = JSON.parse((await call("doc_status", { space: "notes" })).text);
  assert.ok(st.spaces[0].documents.some((d) => d.page === "Projects/note.txt" && d.status === "ok"));
  assert.equal((await call("doc_status", { status: "bogus" })).isError, true);
  assert.equal((await call("reindex_docs", { page: "x" })).isError, true, "page は space と一緒に");
  const r = JSON.parse((await call("reindex_docs", { space: "notes", page: "Projects/note.txt" })).text);
  assert.equal(r.reindexed[0].changed, 1);
  const ls = JSON.parse((await call("list_spaces")).text);
  assert.equal(ls.spaces[0].index.docs_pending, 0);
});

test("add_inbox は既定でアプリのクイックメモと同じ Inbox/<日付>/<時刻> ページを作る", async () => {
  const r = JSON.parse((await call("add_inbox", { space: "notes", text: "buy milk", tag: "next", due: "2026-10-05" })).text);
  assert.match(r.page, /^Inbox\/\d{4}-\d{2}-\d{2}\/\d{2}-\d{2}-\d{2}$/);
  const body = await fs.readFile(`${TMP}/${r.page}.md`, "utf8");
  assert.match(body, /\* \[ \] buy milk #next \[due: 2026-10-05\]\n$/);
  await assert.rejects(fs.access(`${TMP}/Inbox.md`));
});

test("add_inbox のページ名は MEMO_TZ の時刻で作られる", async () => {
  // サーバーは別プロセスなので、MEMO_TZ を付けた専用のサーバーを起動する（テスト側の process.env は届かない）
  const TZ = "Pacific/Kiritimati"; // UTC+14。どの時刻でも UTC と日付か時刻がずれる
  const tzTransport = new StdioClientTransport({
    command: "node",
    args: [fileURLToPath(new URL("../src/stdio.mjs", import.meta.url))],
    env: { ...process.env, MEMO_SPACES: `notes=${TMP}`, MEMO_INDEX_DIR: `${TMP}.idx`, MEMO_EMBED: "off", MEMO_TZ: TZ },
    stderr: "ignore",
  });
  const tzClient = new Client({ name: "wtest-tz", version: "1.0.0" });
  await tzClient.connect(tzTransport);
  try {
    const before = new Date().toLocaleDateString("sv-SE", { timeZone: TZ });
    const res = await tzClient.callTool({ name: "add_inbox", arguments: { space: "notes", text: "tz check" } });
    const after = new Date().toLocaleDateString("sv-SE", { timeZone: TZ });
    const r = JSON.parse(res.content?.[0]?.text ?? "{}");
    // 日付の境目をまたいだ場合も通るよう、呼び出し前後どちらかの日付と一致すればよい
    assert.ok(r.page?.startsWith(`Inbox/${before}/`) || r.page?.startsWith(`Inbox/${after}/`), r.page);
    const utc = new Date().toISOString().slice(0, 10);
    if (utc !== before && utc !== after) assert.ok(!r.page.startsWith(`Inbox/${utc}/`), "UTC の日付で作られている");
  } finally {
    await tzClient.close();
  }
});

test("doc_status は status=unsupported で絞り込める", async () => {
  assert.notEqual((await call("doc_status", { status: "unsupported" })).isError, true);
});

test("add_inbox mode=append は従来どおり Inbox.md に追記する", async () => {
  const r = JSON.parse((await call("add_inbox", { space: "notes", mode: "append", text: "legacy one" })).text);
  assert.equal(r.page, "Inbox");
  await call("add_inbox", { space: "notes", mode: "append", text: "legacy two" });
  const body = await fs.readFile(`${TMP}/Inbox.md`, "utf8");
  assert.match(body, /\* \[ \] legacy one\n\* \[ \] legacy two\n$/);
});
