#!/usr/bin/env node
// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada
/**
 * ゴールデンセットで recall@5 / MRR を lexical / semantic / hybrid ごとに出す。
 * 埋め込みを入れる根拠を数字で持つためのもの。合格の目安: hybrid >= lexical。
 */
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";

// Usage: node src/eval.mjs [golden.json]
// With no argument, evaluates test/eval/golden.json against a temporary fixture space (MEMO_SPACES is ignored).
// With a golden file, evaluates the spaces configured in MEMO_SPACES.
const goldenArg = process.argv[2];
let fixture = null;
if (!goldenArg) {
  const { createFixture } = await import("../test/helpers/fixture.mjs");
  fixture = await createFixture("memo-eval-");
  process.env.MEMO_SPACES = fixture.spacesEnv;
  process.env.MEMO_INDEX_DIR ??= fixture.idx;
}
const { enabledSpaces } = await import("./space.mjs");
const { Indexes } = await import("./index.mjs");
const { searchSpace } = await import("./search.mjs");

const goldenPath = goldenArg ?? fileURLToPath(new URL("../test/eval/golden.json", import.meta.url));
const golden = JSON.parse(await fs.readFile(goldenPath, "utf-8"));
const indexes = new Indexes(enabledSpaces());
const idx = await indexes.get(golden.space);
const K = 5;

for (const mode of ["lexical", "semantic", "hybrid"]) {
  let hitAt5 = 0, rrSum = 0, hitAt1 = 0;
  const misses = [];
  const t0 = Date.now();
  for (const c of golden.cases) {
    const hits = await searchSpace(idx, { query: c.q, mode, limit: 20 });
    const pages = [...new Set(hits.map((h) => h.page))];
    const rank = pages.findIndex((p) => c.expect.includes(p));
    if (rank === 0) hitAt1++;
    if (rank >= 0 && rank < K) hitAt5++;
    if (rank >= 0) rrSum += 1 / (rank + 1);
    else misses.push(`${c.q} → ${pages.slice(0, 2).join(", ") || "(なし)"}`);
  }
  const n = golden.cases.length;
  console.log(`${mode.padEnd(9)} recall@1 ${(hitAt1 / n).toFixed(2)}  recall@5 ${(hitAt5 / n).toFixed(2)}  MRR ${(rrSum / n).toFixed(3)}  (${n} 問, ${Date.now() - t0}ms)`);
  for (const m of misses) console.log(`    miss: ${m}`);
}
await fixture?.cleanup();
