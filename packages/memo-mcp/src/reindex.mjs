#!/usr/bin/env node
// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada
/** 索引を組んで統計を出す。--embed で埋め込みも先に計算して MEMO_INDEX_DIR に置く。 */
import { enabledSpaces } from "./space.mjs";
import { Indexes } from "./index.mjs";
import { Embedder } from "./embed.mjs";

const spaces = enabledSpaces();
const indexes = new Indexes(spaces);
const doEmbed = process.argv.includes("--embed");
const t0 = Date.now();
for (const idx of await indexes.all()) {
  const st = idx.stats();
  console.log(`${idx.space}: pages ${st.pages} / sections ${st.sections} / links ${st.links} / tasks ${st.tasks}`);
  if (doEmbed) {
    const emb = new Embedder(idx.space);
    const t1 = Date.now();
    const r = await emb.ensure(idx.rows("select id, hash, context_text from sections"));
    console.log(`  embeddings: ${r.computed} computed / ${r.cached} cached (${Date.now() - t1}ms)`);
  }
}
console.log(`done in ${Date.now() - t0}ms`);
