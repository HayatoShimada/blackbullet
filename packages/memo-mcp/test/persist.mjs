// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada
// 抽出結果の永続化: 再起動（新しい SpaceIndex）で再抽出せず、変更・強制再索引では抽出し直す
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createFixture } from "./helpers/fixture.mjs";

const fx = await createFixture("memo-persist-");
process.env.MEMO_INDEX_DIR = fx.idx; // index.mjs は import 時に読む
process.env.MEMO_EMBED = "off";
const { SpaceIndex } = await import("../src/index.mjs");
const { parseSpaces } = await import("../src/space.mjs");
after(() => fx.cleanup());

const spaces = parseSpaces(fx.spacesEnv);
const FILE = path.join(fx.notes, "Docs", "p.html");
const body = (s) => `<html><body><p>${s}</p></body></html>`;
await fs.mkdir(path.dirname(FILE), { recursive: true });
await fs.writeFile(FILE, body("alpha one"));
const text = (idx) => idx.rows("select group_concat(text) t from sections where page = 'Docs/p.html'")[0].t;
const open = async () => {
  const idx = await new SpaceIndex(spaces, "notes").open();
  await idx.refresh();
  return idx;
};

test("抽出結果は MEMO_INDEX_DIR に保存され、再起動後は再抽出せずに読まれる", async () => {
  const first = await open();
  assert.match(text(first), /alpha one/);
  const cache = path.join(fx.idx, "extract", "notes");
  assert.equal((await fs.readdir(cache)).length, 1);

  // 保存ファイルの中身を差し替える。再抽出されれば alpha のままだが、保存を使えば sentinel になる。
  const [f] = await fs.readdir(cache);
  const saved = JSON.parse(await fs.readFile(path.join(cache, f), "utf8"));
  saved.units = [{ label: null, text: "from cache" }];
  await fs.writeFile(path.join(cache, f), JSON.stringify(saved));
  const second = await open();
  assert.match(text(second), /from cache/);
  assert.equal(second.docStatus.get("Docs/p.html").status, "ok");

  // 強制再索引は保存済みを使わない
  await second.reindex("Docs/p.html");
  assert.match(text(second), /alpha one/);
});

test("文書が変わる（mtime・サイズ）と再抽出され、削除すると保存も消える", async () => {
  await fs.writeFile(FILE, body("gamma longer text"));
  const idx = await open();
  assert.match(text(idx), /gamma longer text/);
  await fs.rm(FILE);
  await idx.refresh();
  assert.deepEqual(await fs.readdir(path.join(fx.idx, "extract", "notes")), []);
});

test("壊れた保存ファイルは無視して抽出し直す", async () => {
  await fs.writeFile(FILE, body("delta"));
  await open();
  const dir = path.join(fx.idx, "extract", "notes");
  const [f] = await fs.readdir(dir);
  await fs.writeFile(path.join(dir, f), "{not json");
  const idx = await open();
  assert.match(text(idx), /delta/);
});

test("旧式文書（unsupported）の status が保存され、再起動後に保たれる", async () => {
  await fs.writeFile(path.join(fx.notes, "Docs", "old.doc"), "binary");
  await open();
  const dir = path.join(fx.idx, "extract", "notes");
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith(".json"));
  let sentinel = null;
  for (const f of files) {
    const j = JSON.parse(await fs.readFile(path.join(dir, f), "utf-8"));
    if (j.status === "unsupported") {
      sentinel = f;
      j.status = "empty"; // 保存ファイルが実際に読まれる証拠
      await fs.writeFile(path.join(dir, f), JSON.stringify(j));
    }
  }
  assert.ok(sentinel, "unsupported の保存ファイルがある");
  const idx = await open();
  assert.equal(idx.docStatus.get("Docs/old.doc").status, "empty");
});

test("形の壊れた保存内容は無視して抽出し直す", async () => {
  const dir = path.join(fx.idx, "extract", "notes");
  for (const f of await fs.readdir(dir)) {
    const j = JSON.parse(await fs.readFile(path.join(dir, f), "utf-8"));
    j.units = [null];
    await fs.writeFile(path.join(dir, f), JSON.stringify(j));
  }
  const idx = await open();
  assert.match(text(idx), /alpha|delta/);
});

test("停止中に消えた文書の保存ファイルは次の索引で掃除される", async () => {
  await fs.rm(path.join(fx.notes, "Docs", "old.doc"));
  await open();
  const dir = path.join(fx.idx, "extract", "notes");
  assert.equal((await fs.readdir(dir)).length, 1);
});
