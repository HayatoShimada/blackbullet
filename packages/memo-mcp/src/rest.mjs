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
// POST の JSON body の上限。http.mjs の MCP 側と同じ 4 MiB
const MAX_BODY = 4 * 1024 * 1024;
const MODES = ["hybrid", "lexical", "semantic"];

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

/** 検索語の検証（/api/search の q、/api/ask の body.q で共通）。 */
function validQuery(raw) {
  const query = (typeof raw === "string" ? raw : "").trim();
  if (!query) throw new HttpError(400, "q が必要です");
  if (query.length > 500) throw new HttpError(400, "q が長すぎます（500 字まで）");
  return query;
}

function validMode(raw) {
  const mode = raw ?? "hybrid";
  if (!MODES.includes(mode)) throw new HttpError(400, "mode は hybrid / lexical / semantic のいずれかです");
  return mode;
}

/** 意味検索が使えなかったときの説明。使えたときは undefined。 */
function semanticWarning(mode, hits) {
  if (mode === "lexical") return undefined;
  if (!EMBED_ENABLED) return NO_EMBED_WARNING;
  if (hits.semanticError) return `意味検索が今は使えません（${hits.semanticError}）。語彙検索で返しています`;
  if (!hits.semanticUsed) return "セマンティック検索の結果がありません（埋め込み未生成の可能性）。語彙検索で返しています";
  return undefined;
}

// ---------- /api/search ----------

async function search(idx, q) {
  const query = validQuery(q.get("q"));
  const mode = validMode(q.get("mode"));
  const limit = intParam(q, "limit", 10, 1, 50);

  const hits = await searchSpace(idx, { query, mode, limit });
  const body = {
    mode: hits.semanticUsed ? mode : "lexical",
    results: hits.map((h) => ({
      page: h.page,
      // 長い節の続き断片の " (2)" 接尾辞は表示用に落とす。" > " を含む見出しは分割される（ベストエフォート）。
      heading_path: h.heading_path.replace(/ \([2-9]\d*\)$/, "").split(" > "),
      line_start: h.line_start,
      line_end: h.line_end,
      heading_line: h.heading_line,
      snippet: h.snippet,
      score: h.score,
      ranks: { lexical: rank1(h.ranks.lexical), semantic: rank1(h.ranks.semantic) },
    })),
  };
  const warning = semanticWarning(mode, hits);
  if (warning) body.warning = warning;
  return body;
}

// ---------- /api/ask ----------

const ASK_K_MAX = 20;

/** JSON body の整数フィールド。未指定なら既定値、数値でない・範囲外は 400。 */
function bodyInt(body, name, def, min, max) {
  const v = body[name];
  if (v === undefined || v === null) return def;
  if (!Number.isInteger(v) || v < min || v > max) throw new HttpError(400, `${name} は ${min}〜${max} の整数で指定してください`);
  return v;
}

/** 節を開く位置。見出し行があればそこ、無ければ本文の先頭行、それも無ければページだけ。 */
function sectionRef(h) {
  const line = h.heading_line ?? h.line_start;
  return Number.isInteger(line) && line >= 1 ? `${h.page}@L${line}` : h.page;
}

/**
 * 質問に関係する節を本文つきで返す（AI に渡す根拠）。回答の生成はブラウザ側で行う。
 * ここは検索と同じヒットに、節の全文を足すだけ。
 */
async function ask(idx, _q, body) {
  const query = validQuery(body.q);
  const mode = validMode(body.mode);
  const k = bodyInt(body, "k", 8, 1, ASK_K_MAX);

  const hits = await searchSpace(idx, { query, mode, limit: k });
  const out = {
    question: query,
    mode: hits.semanticUsed ? mode : "lexical",
    sections: hits.map((h) => ({
      page: h.page,
      // 長い節の続き断片の " (2)" 接尾辞は表示用に落とす。" > " を含む見出しは分割される（ベストエフォート）。
      heading_path: h.heading_path.replace(/ \([2-9]\d*\)$/, "").split(" > "),
      heading_line: h.heading_line,
      line_start: h.line_start,
      line_end: h.line_end,
      ref: sectionRef(h),
      text: idx.rows("select text from sections where id = ?", [h.id])[0]?.text ?? "",
    })),
  };
  const warning = semanticWarning(mode, hits);
  if (warning) out.warning = warning;
  return out;
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

// パスごとに、対応するメソッドとハンドラ (idx, searchParams, jsonBody) => body
const ROUTES = {
  "/api/search": { GET: search },
  "/api/related": { GET: related },
  "/api/graph": { GET: graph },
  "/api/ask": { POST: ask },
};

/** POST の JSON body を読む。空なら {}。壊れた JSON は 400、大きすぎれば 413。 */
async function readJsonBody(req) {
  const tooLarge = () => new HttpError(413, "body が大きすぎます（4 MiB まで）");
  // 読み始める前に Content-Length で弾く。読んでいる途中で中断すると接続ごと切れて 413 が届かない
  if (Number(req.headers["content-length"]) > MAX_BODY) throw tooLarge();
  const chunks = [];
  let n = 0;
  for await (const c of req) {
    n += c.length;
    if (n > MAX_BODY) throw tooLarge();
    chunks.push(c);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) return {};
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new HttpError(400, "body を JSON として読めません");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "body は JSON オブジェクトで指定してください");
  return body;
}

/**
 * /api/* を処理する。認証・Origin 検証は呼び出し側で済んでいること。
 * @param {{ spaces: object, indexes: import("./index.mjs").Indexes }} ctx
 */
export async function handleRest(req, res, url, { spaces, indexes }) {
  try {
    const route = ROUTES[url.pathname];
    if (!route) throw new HttpError(404, "Not found");
    const handler = route[req.method];
    if (!handler) {
      const allowed = Object.keys(route).join(", ");
      res.setHeader("Allow", allowed);
      throw new HttpError(405, `${allowed} のみ対応しています`);
    }
    const json = req.method === "POST" ? await readJsonBody(req) : {};
    // space はクエリでも body でも指定できる（POST は body が普通）
    const space = url.searchParams.get("space") || (typeof json.space === "string" ? json.space : "");
    if (!space) throw new HttpError(400, "space が必要です");
    if (!spaces[space]) throw new HttpError(404, `未知のスペース: ${space}`);
    const idx = await indexes.get(space);
    const body = await handler(idx, url.searchParams, json);
    sendJson(res, 200, { ...body, confidential: Boolean(spaces[space].confidential) });
  } catch (e) {
    if (e instanceof HttpError) {
      sendJson(res, e.status, { error: e.message });
      return;
    }
    console.error("[memo-mcp] rest failed:", e);
    sendJson(res, 500, { error: "Internal error" });
  }
}
