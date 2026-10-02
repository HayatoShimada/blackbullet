// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada
/**
 * 読み取り専用の REST API（/api/*）。SilverBullet フォーク（ブラウザ側）から使う。
 *
 * 検索・節分割・埋め込みは MCP ツールと同じコード（search.mjs / index.mjs）を通す。
 * ここはクエリの検証と、ページ単位への整形だけを持つ。認証は http.mjs 側で済ませてある。
 */
import { searchSpace, neighbors, sectionVectors } from "./search.mjs";
import { EMBED_ENABLED, cosine } from "./embed.mjs";

const NO_EMBED_WARNING = "MEMO_EMBED=off のため意味検索は無効です";

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

/** 整数パラメータ。未指定なら既定値、範囲外や非数は 400。 */
function intParam(q, name, def, min, max) {
  const raw = q.get(name);
  if (raw === null || raw === "") return def;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, `${name} は ${min}〜${max} の整数で指定してください`);
  return n;
}

function floatParam(q, name, def, min, max) {
  const raw = q.get(name);
  if (raw === null || raw === "") return def;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min || n > max) throw new HttpError(400, `${name} は ${min}〜${max} の数値で指定してください`);
  return n;
}

const flag = (q, name) => ["1", "true"].includes(q.get(name));

/** 0 始まりの内部順位を 1 始まりにして返す。無ければ null。 */
const rank1 = (r) => (r === undefined ? null : r + 1);

// ---------- /api/search ----------

async function search(idx, q) {
  const query = (q.get("q") ?? "").trim();
  if (!query) throw new HttpError(400, "q が必要です");
  if (query.length > 500) throw new HttpError(400, "q が長すぎます（500 字まで）");
  const mode = q.get("mode") ?? "hybrid";
  if (!["hybrid", "lexical", "semantic"].includes(mode)) throw new HttpError(400, "mode は hybrid / lexical / semantic のいずれかです");
  const limit = intParam(q, "limit", 10, 1, 50);

  const hits = await searchSpace(idx, { query, mode, limit });
  const body = {
    mode: hits.semanticUsed ? mode : "lexical",
    results: hits.map((h) => ({
      page: h.page,
      heading_path: h.heading_path.split(" > "),
      line_start: h.line_start,
      line_end: h.line_end,
      heading_line: h.heading_line,
      snippet: h.snippet,
      score: h.score,
      ranks: { lexical: rank1(h.ranks.lexical), semantic: rank1(h.ranks.semantic) },
    })),
  };
  if (!EMBED_ENABLED && mode !== "lexical") body.warning = NO_EMBED_WARNING;
  else if (mode !== "lexical" && hits.semanticError) body.warning = `意味検索が今は使えません（${hits.semanticError}）。語彙検索で返しています`;
  else if (mode !== "lexical" && !hits.semanticUsed) body.warning = "セマンティック検索の結果がありません（埋め込み未生成の可能性）。語彙検索で返しています";
  return body;
}

// ---------- /api/related ----------

/** リンク先の表記（フルパス or 末尾の名前）を実在するページ名に解決する。曖昧なら捨てる。 */
function resolveLinks(idx, page) {
  const all = idx.rows("select page, is_journal from pages");
  const exact = new Map(all.map((p) => [p.page, p]));
  const byBase = new Map();
  for (const p of all) {
    const base = p.page.split("/").pop();
    byBase.set(base, [...(byBase.get(base) ?? []), p.page]);
  }
  const resolve = (name) => {
    if (exact.has(name)) return name;
    const c = byBase.get(name.split("/").pop());
    return c?.length === 1 ? c[0] : null;
  };
  const out = new Set();
  for (const r of idx.rows("select distinct to_page from links where from_page = ?", [page])) {
    const t = resolve(r.to_page);
    if (t) out.add(t);
  }
  const base = page.split("/").pop();
  for (const r of idx.rows("select distinct from_page, to_page from links where to_page = ? or to_page = ?", [page, base])) {
    if (resolve(r.to_page) === page) out.add(r.from_page);
  }
  out.delete(page);
  return out;
}

async function related(idx, q) {
  const page = q.get("page");
  if (!page) throw new HttpError(400, "page が必要です");
  const limit = intParam(q, "limit", 10, 1, 50);
  const includeJournal = flag(q, "include_journal");
  if (!idx.rows("select 1 x from pages where page = ?", [page]).length) throw new HttpError(404, `ページが見つかりません: ${idx.space}/${page}`);

  const journal = new Set(idx.rows("select page from pages where is_journal = 1").map((r) => r.page));
  const keep = (p) => includeJournal || !journal.has(p);
  const links = [...resolveLinks(idx, page)].filter(keep);

  // neighbors は節ベクトルとの類似度をページ単位に畳んだ全件（1000 ページまで）を返す
  const sims = new Map((await neighbors(idx, page, 1000)).map((n) => [n.page, n.similarity]));
  const semantic = [...sims].filter(([p]) => keep(p)).slice(0, limit).map(([p]) => p);
  const semSet = new Set(semantic);
  const linkSet = new Set(links);

  const results = [...new Set([...semantic, ...links])].map((p) => ({
    page: p,
    // リンク先は意味的に遠くても出る。score は意味的類似度（算出できなければ 0）
    score: sims.get(p) ?? 0,
    via: semSet.has(p) && linkSet.has(p) ? "both" : linkSet.has(p) ? "link" : "semantic",
  }));
  // リンクで繋がっているものを優先し、同順位内は類似度順
  results.sort((a, b) => (b.via !== "semantic") - (a.via !== "semantic") || b.score - a.score);
  const body = { results: results.slice(0, limit) };
  if (!EMBED_ENABLED) body.warning = NO_EMBED_WARNING;
  return body;
}

// ---------- /api/graph ----------

const MAX_K = 20;
// space ごとに直近の全ページ近傍表を持つ。節ハッシュの指紋が変わったら作り直す
const graphCache = new Map();

/**
 * ページ間の類似度 = 節ベクトル同士の cos の最大値（max-of-sections）。
 * 平均（重心）だと長いページで話題が薄まり、1 節だけ同じ話をしているページ対を拾えない。
 * メモは「1 ページ複数話題」が普通なので max を採る。
 * 戻り値: Map page -> [[other, score], ...]（score 降順、上位 MAX_K 件）
 */
async function neighborTable(byPage) {
  const pages = [...byPage.keys()];
  const lists = new Map(pages.map((p) => [p, []]));
  for (let i = 0; i < pages.length; i++) {
    // 全対計算は O(ページ^2 × 節^2)。1 ページ分ごとにイベントループを譲り、/mcp や /healthz を止めない
    await new Promise((r) => setImmediate(r));
    for (let j = i + 1; j < pages.length; j++) {
      let best = -1;
      for (const a of byPage.get(pages[i])) for (const b of byPage.get(pages[j])) best = Math.max(best, cosine(a, b));
      lists.get(pages[i]).push([pages[j], best]);
      lists.get(pages[j]).push([pages[i], best]);
    }
  }
  for (const [p, l] of lists) lists.set(p, l.sort((x, y) => y[1] - x[1]).slice(0, MAX_K));
  return lists;
}

async function graph(idx, q) {
  const k = intParam(q, "k", 3, 1, MAX_K);
  const threshold = floatParam(q, "threshold", 0.8, 0, 1);
  const page = q.get("page");
  if (page && !idx.rows("select 1 x from pages where page = ?", [page]).length) throw new HttpError(404, `ページが見つかりません: ${idx.space}/${page}`);
  // ページを名指しした場合、日報でも辺を引けるようにする
  const includeJournal = flag(q, "include_journal") || (page ? idx.rows("select is_journal j from pages where page = ?", [page])[0].j === 1 : false);

  const pages = idx.rows(
    `select page, title, tags from pages ${includeJournal ? "" : "where is_journal = 0"} order by page`
  );
  const nodeOf = (p) => ({ id: p.page, title: p.title, tags: p.tags ? p.tags.split(",") : [] });
  const body = { nodes: pages.map(nodeOf), edges: [] };

  const vecs = await sectionVectors(idx, { includeJournal });
  if (!vecs) {
    body.warning = NO_EMBED_WARNING;
    return body;
  }
  const cacheKey = `${idx.space}:${includeJournal}`;
  let cached = graphCache.get(cacheKey);
  if (cached?.signature !== vecs.signature) {
    cached = { signature: vecs.signature, table: await neighborTable(vecs.byPage) };
    graphCache.set(cacheKey, cached);
  }

  const seen = new Set();
  for (const [from, list] of cached.table) {
    for (const [to, score] of list.filter(([, s]) => s >= threshold).slice(0, k)) {
      if (page && from !== page && to !== page) continue;
      const key = from < to ? `${from}\0${to}` : `${to}\0${from}`;
      if (seen.has(key)) continue; // A→B と B→A は同じ辺
      seen.add(key);
      body.edges.push({ from, to, kind: "semantic", score: Number(score.toFixed(4)) });
    }
  }
  body.edges.sort((a, b) => b.score - a.score);
  if (page) {
    // 指定ページに繋がるものだけ残す
    const touched = new Set([page, ...body.edges.flatMap((e) => [e.from, e.to])]);
    body.nodes = body.nodes.filter((n) => touched.has(n.id));
  }
  return body;
}

const ROUTES = { "/api/search": search, "/api/related": related, "/api/graph": graph };

/**
 * /api/* を処理する。認証・Origin 検証は呼び出し側で済んでいること。
 * @param {{ spaces: object, indexes: import("./index.mjs").Indexes }} ctx
 */
export async function handleRest(req, res, url, { spaces, indexes }) {
  try {
    if (req.method !== "GET") throw new HttpError(405, "GET のみ対応しています");
    const route = ROUTES[url.pathname];
    if (!route) throw new HttpError(404, "Not found");
    const space = url.searchParams.get("space");
    if (!space) throw new HttpError(400, "space が必要です");
    if (!spaces[space]) throw new HttpError(404, `未知のスペース: ${space}`);
    const idx = await indexes.get(space);
    const body = await route(idx, url.searchParams);
    sendJson(res, 200, { ...body, confidential: Boolean(spaces[space].confidential) });
  } catch (e) {
    if (e instanceof HttpError) {
      if (e.status === 405) res.setHeader("Allow", "GET");
      sendJson(res, e.status, { error: e.message });
      return;
    }
    console.error("[memo-mcp] rest failed:", e);
    sendJson(res, 500, { error: "Internal error" });
  }
}
