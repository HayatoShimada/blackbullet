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

test("add_inbox は既定で Tasks/<題名> の todo ページを作る", async () => {
  const r = JSON.parse((await call("add_inbox", { space: "notes", text: "buy milk for [[Projects/Sample]] #next #home [due: 2026-10-05]" })).text);
  assert.equal(r.page, "Tasks/buy milk for Sample");
  const body = await fs.readFile(`${TMP}/${r.page}.md`, "utf8");
  assert.equal(
    body,
    "---\ntags: [todo, home]\nstatus: next\ndue: 2026-10-05\nproject:\narea:\ncompleted:\n---\n# buy milk for Sample\nbuy milk for [[Projects/Sample]] #next #home [due: 2026-10-05]\n"
  );
  await assert.rejects(fs.access(`${TMP}/Inbox.md`));
  // 索引から todo ページとして見える
  const t = JSON.parse((await call("list_tasks", { space: "notes", status: "next" })).text).tasks;
  assert.ok(t.some((x) => x.page === r.page && x.kind === "page" && x.due === "2026-10-05"));
});

test("add_inbox: 衝突は ' 2' ' 3'、記号は除かれ 40 文字に切る、due 引数と tag 引数", async () => {
  const a = JSON.parse((await call("add_inbox", { space: "notes", text: "same title" })).text);
  const b = JSON.parse((await call("add_inbox", { space: "notes", text: "same title", due: "2026-11-01", tag: "someday" })).text);
  const c = JSON.parse((await call("add_inbox", { space: "notes", text: "same title" })).text);
  assert.deepEqual([a.page, b.page, c.page], ["Tasks/same title", "Tasks/same title 2", "Tasks/same title 3"]);
  const bb = await fs.readFile(`${TMP}/${b.page}.md`, "utf8");
  assert.match(bb, /^---\ntags: \[todo\]\nstatus: someday\ndue: 2026-11-01\n/);
  assert.match(bb, /\n# same title 2\n/);
  const aa = await fs.readFile(`${TMP}/${a.page}.md`, "utf8");
  assert.match(aa, /status: inbox\ndue:\n/);
  const sym = JSON.parse((await call("add_inbox", { space: "notes", text: "a/b #x @y | <z> $ ` [q] " + "あ".repeat(60) })).text);
  assert.equal(sym.page, `Tasks/ab y z q ${"あ".repeat(40 - 9)}`.slice(0, "Tasks/".length + 40));
  assert.doesNotMatch(sym.page.slice("Tasks/".length), /[\/#@|<>$`\[\]]/);
  assert.ok(Array.from(sym.page.slice("Tasks/".length)).length <= 40);
});

test("complete_task: todo ページは page だけで status: done と completed を書く", async () => {
  const r = JSON.parse((await call("add_inbox", { space: "notes", text: "finish report #next [due: 2026-10-09]" })).text);
  const note = JSON.parse((await call("read_note", { space: "notes", page: r.page })).text);
  // 古い modified は競合
  const stale = await call("complete_task", { space: "notes", page: r.page, expected_modified: "2020-01-01T00:00:00.000Z" });
  assert.equal(stale.isError, true);
  assert.match(await fs.readFile(`${TMP}/${r.page}.md`, "utf8"), /status: next/);
  const done = await call("complete_task", { space: "notes", page: r.page, expected_modified: note.modified, date: "2026-10-03" });
  assert.equal(done.isError, false, done.text);
  const text = await fs.readFile(`${TMP}/${r.page}.md`, "utf8");
  assert.match(text, /\nstatus: done\n/);
  assert.match(text, /\ncompleted: 2026-10-03\n/);
  assert.match(text, /\ndue: 2026-10-09\n/, "他の項目は触らない");
  assert.match(text, /\n# finish report\nfinish report #next/, "本文は触らない");
  assert.deepEqual(await tmpFiles(TMP), []);
  // 再完了は拒否
  assert.match((await call("complete_task", { space: "notes", page: r.page })).text, /既に完了/);
  // list_tasks で完了済みとして見える
  const dt = JSON.parse((await call("list_tasks", { space: "notes", done: true })).text).tasks;
  assert.ok(dt.some((x) => x.page === r.page && x.done && x.completed === "2026-10-03"));
});

test("complete_task: todo でないページ・無いページは拒否、date 省略は今日", async () => {
  const before = await fs.readFile(`${TMP}/${PAGE}.md`, "utf8");
  const r = await call("complete_task", { space: "notes", page: PAGE });
  assert.equal(r.isError, true);
  assert.match(r.text, /todo ページではありません/);
  assert.equal(await fs.readFile(`${TMP}/${PAGE}.md`, "utf8"), before);
  assert.equal((await call("complete_task", { space: "notes", page: "Tasks/NoSuch" })).isError, true);
  const t = JSON.parse((await call("add_inbox", { space: "notes", text: "today check" })).text);
  await call("complete_task", { space: "notes", page: t.page });
  const today = new Date().toLocaleDateString("sv-SE");
  const utc = new Date().toISOString().slice(0, 10);
  const m = /completed: (\S+)/.exec(await fs.readFile(`${TMP}/${t.page}.md`, "utf8"));
  assert.ok([today, utc].includes(m[1]), m[1]);
});

test("complete_task の完了日は MEMO_TZ の日付になる", async () => {
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
    const mark = await tzClient.callTool({ name: "complete_task", arguments: { space: "notes", page: r.page } });
    assert.notEqual(mark.isError, true);
    const done = /completed: (\S+)/.exec(await fs.readFile(`${TMP}/${r.page}.md`, "utf8"))[1];
    assert.ok(done === before || done === after, done);
    const utc = new Date().toISOString().slice(0, 10);
    if (utc !== before && utc !== after) assert.notEqual(done, utc, "UTC の日付で書かれている");
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

// ---------- 汎用の編集 ----------

const ok = (r) => {
  assert.equal(r.isError, false, r.text);
  return JSON.parse(r.text);
};
const read = (page) => fs.readFile(`${TMP}/${page}.md`, "utf8");

test("write_note: 無ければフォルダごと作り、既存の上書きには expected_modified が要る", async () => {
  const page = "Projects/Sample/Plans/2026-10-29 計画";
  const made = ok(await call("write_note", { space: "notes", page, content: "---\ntags: plan\n---\n# 計画\n\n## 進捗" }));
  assert.equal(made.created, true);
  assert.equal(await read(page), "---\ntags: plan\n---\n# 計画\n\n## 進捗\n");

  const refused = await call("write_note", { space: "notes", page, content: "x" });
  assert.equal(refused.isError, true);
  assert.match(refused.text, /expected_modified/);
  const stale = await call("write_note", { space: "notes", page, content: "x", expected_modified: "2020-01-01T00:00:00.000Z" });
  assert.equal(stale.isError, true);
  assert.match(await read(page), /# 計画/);

  const over = ok(await call("write_note", { space: "notes", page, content: "new\n", expected_modified: made.modified }));
  assert.equal(over.created, false);
  assert.equal(await read(page), "new\n");
});

test("write_note / edit_note / update_section は Library/・Templates/・ドット始まり・CONFIG に書かない", async () => {
  for (const page of ["Library/Std/Foo", "templates/x", ".hidden/x", "Projects/.x", "CONFIG", "../outside"]) {
    for (const [name, args] of [
      ["write_note", { content: "x" }],
      ["edit_note", { old_text: "a", new_text: "b" }],
      ["update_section", { heading: "## A", content: "x" }],
    ]) {
      const r = await call(name, { space: "notes", page, ...args });
      assert.equal(r.isError, true, `${name} ${page}`);
    }
  }
  await assert.rejects(fs.access(`${TMP}/Library/Std/Foo.md`));
  await assert.rejects(fs.access(`${TMP}/CONFIG.md`));
});

test("edit_note: 一意な一致だけ置き換え、0件・複数件（replace_all なし）は書かない", async () => {
  const page = "Projects/EditMe";
  ok(await call("write_note", { space: "notes", page, content: "---\nstatus: approved\n---\n- a\n- a\n- b\n" }));
  const before = await read(page);
  const none = await call("edit_note", { space: "notes", page, old_text: "- zzz", new_text: "x" });
  assert.equal(none.isError, true);
  assert.match(none.text, /見つかりません/);
  const many = await call("edit_note", { space: "notes", page, old_text: "- a", new_text: "- c" });
  assert.equal(many.isError, true);
  assert.match(many.text, /2 箇所/);
  assert.equal(await read(page), before);

  const st = ok(await call("edit_note", { space: "notes", page, old_text: "status: approved", new_text: "status: done" }));
  assert.equal(st.replaced, 1);
  const all = ok(await call("edit_note", { space: "notes", page, old_text: "- a\n", new_text: "- $&c\n", replace_all: true }));
  assert.equal(all.replaced, 2);
  assert.equal(await read(page), "---\nstatus: done\n---\n- $&c\n- $&c\n- b\n");
  const stale = await call("edit_note", { space: "notes", page, old_text: "- b", new_text: "x", expected_modified: "2020-01-01T00:00:00.000Z" });
  assert.equal(stale.isError, true);
  assert.match(await read(page), /- b/);
});

test("update_section: replace は下位の見出しごと次の同レベルの見出しまで、append は節の末尾、無ければ末尾に作る", async () => {
  const page = "Projects/Sections";
  ok(await call("write_note", {
    space: "notes",
    page,
    content: "---\n# not a heading: yaml comment\ntags: project\n---\n# Title\n\n## Plans\n\n- old\n\n### sub\n\nsub text\n\n## Links\n\n```\n## not a heading\n```\n- link\n",
  }));
  ok(await call("update_section", { space: "notes", page, heading: "## Plans", content: "- one", mode: "append" }));
  assert.match(await read(page), /## Plans\n\n- old\n\n### sub\n\nsub text\n- one\n\n## Links\n/);

  ok(await call("update_section", { space: "notes", page, heading: "##  Plans ", content: "- only\n- two\n\n" }));
  assert.match(await read(page), /# Title\n\n## Plans\n\n- only\n- two\n\n## Links\n\n```\n## not a heading\n```\n- link\n$/);

  // コードブロック内の "## not a heading" は見出し扱いしない → 新しく末尾に作る
  const made = ok(await call("update_section", { space: "notes", page, heading: "## not a heading", content: "x" }));
  assert.equal(made.created_heading, true);
  assert.match(await read(page), /- link\n\n## not a heading\n\nx\n$/);

  // 空の節への append は空行 1 つを挟む
  ok(await call("update_section", { space: "notes", page, heading: "## 進捗", content: "- 2026-10-29 start", mode: "append" }));
  ok(await call("update_section", { space: "notes", page, heading: "## 進捗", content: "- 2026-10-30 next", mode: "append" }));
  assert.match(await read(page), /## 進捗\n\n- 2026-10-29 start\n- 2026-10-30 next\n$/);

  const bad = await call("update_section", { space: "notes", page, heading: "Plans", content: "x" });
  assert.equal(bad.isError, true);
  const missing = await call("update_section", { space: "notes", page: "Projects/Nope", heading: "## A", content: "x" });
  assert.equal(missing.isError, true);
  await assert.rejects(fs.access(`${TMP}/Projects/Nope.md`));
});
