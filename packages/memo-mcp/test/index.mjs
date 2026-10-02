// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada
// 索引のパース: 節の行番号がファイル基準で正しいこと、クエリ除去が行数を変えないこと、語の分割
import { test } from "node:test";
import assert from "node:assert/strict";
import { splitSections, parsePage } from "../src/index.mjs";
import { stripQueries } from "../src/space.mjs";
import { splitTerms } from "../src/search.mjs";

const RAW = `---
tags: project
status: active
area: operations
---

# Demo

## Outcome
できている状態。

## Next actions
* [ ] やる #next [due: 2026-09-30]

\${query[[
from p = index.pages("project")
where p.status == "active"
]]}

## Notes
### 経緯
- 2026-09-17 取り込み
`;

test("stripQueries は行数を変えない", () => {
  assert.equal(stripQueries(RAW).split("\n").length, RAW.split("\n").length);
});

test("節の行範囲はファイル基準で、見出しの直後から始まる", () => {
  const { sections } = parsePage({ space: "notes", page: "Projects/Demo", raw: RAW, mtime: 0 });
  const lines = RAW.split("\n");
  const byPath = Object.fromEntries(sections.map((s) => [s.heading_path, s]));
  assert.equal(byPath["Outcome"].line_start, 10);
  assert.match(lines[byPath["Outcome"].line_start - 2], /^## Outcome/);
  assert.equal(byPath["Notes > 経緯"].line_start, lines.findIndex((l) => l === "### 経緯") + 2);
  assert.ok(sections.every((s) => /^#{1,6}\s/.test(lines[s.line_start - 2])));
});

test("context_text にスペース・ページ・見出しパス・メタが前置される", () => {
  const { sections } = parsePage({ space: "notes", page: "Projects/Demo", raw: RAW, mtime: 0 });
  const s = sections.find((x) => x.heading_path === "Next actions");
  assert.match(s.context_text, /^\[notes \/ Projects\/Demo tags: project area: operations status: active > Next actions\]/);
  assert.ok(!s.context_text.includes("index.pages"), "クエリ本文が入っていない");
});

test("タスクの行番号は list_tasks と同じファイル基準", () => {
  const { tasks } = parsePage({ space: "notes", page: "Projects/Demo", raw: RAW, mtime: 0 });
  assert.equal(tasks.length, 1);
  assert.equal(RAW.split("\n")[tasks[0].line - 1].trim(), "* [ ] やる #next [due: 2026-09-30]");
});

test("長い節は段落で割られ、見出しパスに (2) が付く", () => {
  const body = "## 長い\n" + Array.from({ length: 12 }, (_, i) => `段落${i} ` + "あ".repeat(300)).join("\n\n");
  const secs = splitSections(body, 1, { pageTitle: "x" });
  assert.ok(secs.length >= 2);
  assert.equal(secs[1].heading_path, "長い (2)");
  assert.ok(secs.every((s) => s.text.length <= 2600));
});

test("日本語の助詞で語を切り、3字未満は短語に回す", () => {
  const t = splitTerms("在庫管理のキャンペーン 日報");
  assert.ok(t.long.includes("在庫管理") && t.long.includes("キャンペーン"));
  assert.ok(t.short.includes("日報"));
});
