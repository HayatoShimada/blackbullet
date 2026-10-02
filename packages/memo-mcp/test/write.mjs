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
