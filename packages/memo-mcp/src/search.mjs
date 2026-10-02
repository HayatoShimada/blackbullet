// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada
/**
 * ハイブリッド検索: FTS5(BM25, trigram) と ローカル埋め込み(cos) を RRF で統合し、
 * ページ名一致 / status: active / 日報の鮮度で加点する。
 *
 * trigram は 3 文字未満の語を引けない（空になる）ので、短い語は LIKE で補う。
 */
import crypto from "node:crypto";
import { Embedder, EMBED_ENABLED, cosine } from "./embed.mjs";

const RRF_K = 60;
const TOP_EACH = 40;
const JOURNAL_HALF_LIFE_DAYS = 30;

const embedders = new Map();
function embedderFor(space) {
  if (!embedders.has(space)) embedders.set(space, new Embedder(space));
  return embedders.get(space);
}

/** 検索語を分かち、trigram 用（3 字以上）と LIKE 用（2 字以下）に分ける。 */
export function splitTerms(query) {
  const terms = (query ?? "")
    .split(/[\s、。，．,.!?！？「」（）()\[\]【】]+/)
    .map((t) => t.trim())
    .filter(Boolean);
  // 日本語は分かち書きされないので、助詞で切って語を増やす（「在庫管理のキャンペーン」→ 2 語）。
  // 切った断片が 3 字未満なら短語として LIKE に回る。
  const PARTICLES = /(?<=[^\sぁ-ん])(の|を|に|は|が|と|で|へ|から|まで|より|って|や)(?=[^\sぁ-ん])/g;
  const expanded = new Set(terms);
  for (const t of terms) {
    if (!/[぀-ヿ一-鿿]/.test(t)) continue;
    for (const piece of t.split(PARTICLES)) {
      if (piece && !/^(の|を|に|は|が|と|で|へ|から|まで|より|って|や)$/.test(piece)) expanded.add(piece);
    }
  }
  const all = [...expanded];
  const long = all.filter((t) => [...t].length >= 3);
  const short = all.filter((t) => [...t].length > 0 && [...t].length < 3);
  return { terms: all, long, short };
}

function ftsQuery(query, long) {
  const parts = [];
  const q = query.trim();
  if ([...q].length >= 3) parts.push(`"${q.replace(/"/g, '""')}"`);
  for (const t of long) parts.push(`"${t.replace(/"/g, '""')}"`);
  return parts.join(" OR ");
}

function ageDays(iso) {
  return Math.max(0, (Date.now() - Date.parse(iso)) / 86400000);
}

/**
 * @param {import("./index.mjs").SpaceIndex} idx
 * @returns {Promise<Array<object>>} 節単位のヒット（ページごとに最大 2）
 */
export async function searchSpace(idx, opts) {
  const { query = "", tag, area, status, since, mode = "hybrid", limit = 20 } = opts;
  const space = idx.space;

  // 1. メタデータで候補を絞る
  const where = [];
  const bind = [];
  if (tag) { where.push("(',' || p.tags || ',') like ?"); bind.push(`%,${tag},%`); }
  if (area) { where.push("p.area = ?"); bind.push(area); }
  if (status) { where.push("p.status = ?"); bind.push(status); }
  if (since) { where.push("p.modified >= ?"); bind.push(since); }
  const candidates = idx.rows(
    `select s.id, s.page, s.heading_path, s.level, s.line_start, s.line_end, s.text, s.hash,
            p.tags, p.status, p.modified, p.is_journal, p.summary
     from sections s join pages p on p.page = s.page
     ${where.length ? "where " + where.join(" and ") : ""}`,
    bind
  );
  if (!candidates.length) return [];
  const byId = new Map(candidates.map((c) => [c.id, c]));

  const q = query.trim();
  const { long, short } = splitTerms(q);
  const ranks = new Map(); // id -> {lexical?: rank, semantic?: rank}
  const snippets = new Map();

  // 2. lexical
  if (q && mode !== "semantic") {
    const fq = ftsQuery(q, long);
    if (fq) {
      const rows = idx.rows(
        `select id, bm25(sections_fts) s, snippet(sections_fts, 1, '', '', '…', 24) sn
         from sections_fts where sections_fts match ? order by s limit ?`,
        [fq, TOP_EACH * 3]
      );
      let r = 0;
      for (const row of rows) {
        if (!byId.has(row.id)) continue;
        ranks.set(row.id, { ...(ranks.get(row.id) ?? {}), lexical: r++ });
        snippets.set(row.id, row.sn);
        if (r >= TOP_EACH) break;
      }
    }
    if (short.length) {
      // 2 字以下は trigram で引けないので LIKE。全語を含む節を lexical の末尾に足す
      let r = ranks.size ? Math.max(...[...ranks.values()].map((v) => v.lexical ?? 0)) + 1 : 0;
      for (const c of candidates) {
        if (ranks.get(c.id)?.lexical !== undefined) continue;
        if (short.every((t) => c.text.includes(t))) {
          ranks.set(c.id, { ...(ranks.get(c.id) ?? {}), lexical: r++ });
        }
      }
    }
  }

  // 3. semantic
  let semanticUsed = false;
  if (q && mode !== "lexical" && EMBED_ENABLED) {
    const emb = embedderFor(space);
    await emb.ensure(idx.rows("select id, hash, context_text from sections"));
    const qv = await emb.query(q);
    const scored = [];
    for (const c of candidates) {
      const v = emb.get(c.hash);
      if (v) scored.push([c.id, cosine(qv, v)]);
    }
    scored.sort((a, b) => b[1] - a[1]);
    scored.slice(0, TOP_EACH).forEach(([id], r) => {
      ranks.set(id, { ...(ranks.get(id) ?? {}), semantic: r });
    });
    semanticUsed = scored.length > 0;
  }

  // 4. 統合（クエリ無しなら更新順）
  const hits = [];
  if (!q) {
    for (const c of candidates) hits.push({ c, score: Date.parse(c.modified) / 1e15, why: ["filter"] });
  } else {
    for (const [id, rk] of ranks) {
      const c = byId.get(id);
      let score = 0;
      const why = [];
      if (rk.lexical !== undefined) { score += 1 / (RRF_K + rk.lexical); why.push("lexical"); }
      if (rk.semantic !== undefined) { score += 1 / (RRF_K + rk.semantic); why.push("semantic"); }
      const qlc = q.toLowerCase();
      if (c.page.toLowerCase().includes(qlc) || long.some((t) => c.page.toLowerCase().includes(t.toLowerCase()))) {
        score += 0.01; why.push("title");
      }
      if (c.status === "active") score += 0.002;
      if (c.is_journal) score += 0.004 * Math.pow(0.5, ageDays(c.modified) / JOURNAL_HALF_LIFE_DAYS);
      hits.push({ c, score, why });
    }
  }
  hits.sort((a, b) => b.score - a.score);

  // 5. ページごとに最大 2 節
  const perPage = new Map();
  const out = [];
  for (const h of hits) {
    const n = perPage.get(h.c.page) ?? 0;
    if (n >= 2) continue;
    perPage.set(h.c.page, n + 1);
    const c = h.c;
    out.push({
      space,
      page: c.page,
      heading_path: c.heading_path,
      line_start: c.line_start,
      line_end: c.line_end,
      // 見出し行そのもの（1 始まり）。見出しの前の導入部と、長い節の 2 つ目以降の断片には無い
      heading_line: c.level > 0 && !/ \([2-9]\d*\)$/.test(c.heading_path) ? c.line_start - 1 : null,
      score: Number(h.score.toFixed(5)),
      why: h.why,
      ranks: ranks.get(c.id) ?? {},
      snippet: (snippets.get(c.id) ?? c.text.replace(/\s+/g, " ")).slice(0, 200),
      tags: c.tags ? c.tags.split(",") : [],
      status: c.status,
      summary: c.summary,
      modified: c.modified,
      confidential: Boolean(idx.spaces[space]?.confidential),
    });
    if (out.length >= limit) break;
  }
  out.semanticUsed = semanticUsed;
  return out;
}

/** 意味的に近い節（related_notes 用）。同じページは除く。 */
export async function neighbors(idx, page, limit = 5) {
  if (!EMBED_ENABLED) return [];
  const emb = embedderFor(idx.space);
  const all = idx.rows("select id, page, heading_path, hash, line_start, line_end from sections");
  await emb.ensure(idx.rows("select id, hash, context_text from sections"));
  const mine = all.filter((s) => s.page === page).map((s) => emb.get(s.hash)).filter(Boolean);
  if (!mine.length) return [];
  // ページ全体は節ベクトルの平均で代表させる
  const dim = mine[0].length;
  const centroid = new Float32Array(dim);
  for (const v of mine) for (let i = 0; i < dim; i++) centroid[i] += v[i] / mine.length;
  const scored = [];
  for (const s of all) {
    if (s.page === page) continue;
    const v = emb.get(s.hash);
    if (v) scored.push({ ...s, similarity: Number(cosine(centroid, v).toFixed(3)) });
  }
  scored.sort((a, b) => b.similarity - a.similarity);
  const seen = new Set();
  return scored.filter((s) => (seen.has(s.page) ? false : seen.add(s.page))).slice(0, limit)
    .map(({ hash, id, ...rest }) => rest);
}

/**
 * ページごとの節ベクトル（グラフ用）。埋め込みが無効なら null。
 * signature は節ハッシュ全体の指紋で、索引や埋め込みが変わったかどうかの判定に使う。
 */
export async function sectionVectors(idx, { includeJournal = false } = {}) {
  if (!EMBED_ENABLED) return null;
  const emb = embedderFor(idx.space);
  await emb.ensure(idx.rows("select id, hash, context_text from sections"));
  const rows = idx.rows(
    `select s.page, s.hash from sections s join pages p on p.page = s.page
     ${includeJournal ? "" : "where p.is_journal = 0"} order by s.page, s.n`
  );
  const byPage = new Map();
  const h = crypto.createHash("sha1");
  for (const r of rows) {
    const v = emb.get(r.hash);
    if (!v) continue;
    if (!byPage.has(r.page)) byPage.set(r.page, []);
    byPage.get(r.page).push(v);
    h.update(r.page + r.hash);
  }
  return { byPage, signature: h.digest("hex") };
}
