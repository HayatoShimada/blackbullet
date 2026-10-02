// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada
/**
 * スペースの索引。最初のツール呼び出し / REST 呼び出し時にメモリ上の SQLite（公式 WASM 版）へ
 * 組み立て（遅延構築）、以後は呼び出しごとにファイルの mtime を見て変わったページだけ差し替える。
 *
 * ネイティブの better-sqlite3 は一部の環境（ARM など）で new Database() が落ちる（ABI の相性）ため使わない。
 * 数十〜数百ファイル（約 100k 字）なら全件組み直しでも 1 秒かからない。永続化が要るのは
 * 埋め込みだけで、それは embed.mjs が節ハッシュ単位で MEMO_INDEX_DIR（既定 ~/.cache/memo-mcp）に置く。
 *
 * 検索の最小単位は「節」（## 見出しごと）。各節には
 *   [space / page > 見出しパス] tags: … area: … status: …
 * を先頭に前置した context_text を持たせ、FTS もこの文字列に張る（contextual retrieval）。
 *
 * PDF / Office 文書（extract.mjs が対応する拡張子）も同じ pages / sections に載せる。
 * ページ名は拡張子つき（Images/report.pdf）、kind 列で .md と区別し、節は単位ラベル
 * （p.3 / slide.2）を見出しパスにして行番号は 0 にする。
 */
import fs from "node:fs/promises";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import sqlite3InitModule from "@sqlite.org/sqlite-wasm";
import {
  listFiles,
  listDocs,
  splitFrontmatter,
  tagList,
  normalizeStatus,
  stripQueries,
  parseTaskLine,
} from "./space.mjs";
import { extractDocStatus, docIndexable, EXTRACT_SIGNATURE } from "./extract.mjs";

export const INDEX_DIR = process.env.MEMO_INDEX_DIR ?? path.join(os.homedir(), ".cache", "memo-mcp");
// CONFIG.md には memoSidecar のトークンを置くため、検索・埋め込みの対象にしない。
// Trash/ は DB ビューで「削除」したページの置き場。消したものが検索や Ask の引用に出ないようにする
const EXCLUDE = /^((Templates|Library|Images|Trash)(\/|$)|CONFIG$)/;
// 文書は Images/ に置かれていてもナレッジなので拾う。除外規則は extract.mjs の docIndexable。
// 1 回の refresh で抽出に使ってよい時間。超えたら残りは次回の呼び出しに回す（初回に大量の文書があっても止まらない）。
const extractBudgetMs = () => Number(process.env.MEMO_EXTRACT_BUDGET ?? 60_000); // 呼ぶたびに読む（テストで切り替えられる）
// 一時的な失敗（時間切れなど）をやり直すまでの待ち時間。
const EXTRACT_RETRY_MS = 5 * 60_000;
const MAX_SECTION_CHARS = 2000;

/**
 * 抽出結果の永続化。MEMO_INDEX_DIR/extract/<space>/<sha1(page)>.json に { key, units, status } を置く。
 * key は mtime・サイズ・抽出署名なので、文書か設定が変われば読み捨てる。一時的な失敗は保存しない。
 * 失敗しても索引は止めない（ディスクが書けなくても従来どおり毎回抽出するだけ）。
 */
const extractCacheFile = (space, page) => path.join(INDEX_DIR, "extract", space.replace(/[^\w.-]/g, "_"), `${sha1(page)}.json`);
async function loadExtractCache(space, page, key) {
  try {
    const c = JSON.parse(await fs.readFile(extractCacheFile(space, page), "utf-8"));
    const ok = (u) => u && typeof u === "object" && typeof u.text === "string" && (u.label === null || typeof u.label === "string");
    return c?.key === key && Array.isArray(c.units) && c.units.every(ok) && typeof c.status === "string" ? c : null;
  } catch {
    return null;
  }
}
async function saveExtractCache(space, page, key, units, status) {
  if (status === "error") return; // 環境起因（EMFILE など）の失敗が固定されないよう、毎回やり直す
  try {
    const f = extractCacheFile(space, page);
    await fs.mkdir(path.dirname(f), { recursive: true, mode: 0o700 });
    const tmp = `${f}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify({ key, units, status }));
    await fs.rename(tmp, f);
  } catch {
    /* 保存できなくても索引には影響しない */
  }
}

let sqlite3Promise;
function sqlite() {
  if (!sqlite3Promise) sqlite3Promise = sqlite3InitModule({ print() {}, printErr() {} });
  return sqlite3Promise;
}

const SCHEMA = `
create table pages (
  page text primary key, path text, kind text not null default 'md', mtime real, modified text, title text,
  tags text, area text, status text, due text, goal text, summary text,
  chars integer, is_journal integer, date text
);
create table sections (
  id text primary key, page text, n integer, heading_path text, level integer,
  line_start integer, line_end integer, text text, context_text text, hash text
);
create index sections_page on sections(page);
create virtual table sections_fts using fts5(id unindexed, context_text, heading_path, tokenize='trigram');
create table links (from_page text, to_page text, display text);
create index links_to on links(to_page);
create table tasks (page text, line integer, text text, done integer, due text, completed text, start text, tags text);
`;

const sha1 = (s) => crypto.createHash("sha1").update(s).digest("hex");

/** 本文を見出し単位の節に割る。行番号はファイル全体基準。 */
export function splitSections(body, bodyStartLine, { pageTitle }) {
  const lines = body.split(/\r?\n/);
  const sections = [];
  let stack = []; // [{level, text}]
  let cur = { heading_path: "", level: 0, start: 0, lines: [] };
  const PLACEHOLDER = /_\(SilverBulletのクエリ。MCP経由では展開されません\)_/g;
  const flush = (endIdx) => {
    const text = cur.lines.join("\n").trim();
    // クエリの置き換え文だけの節（Areas の一覧欄など）は検索の対象にしない
    if (text && text.replace(PLACEHOLDER, "").trim()) {
      sections.push({
        heading_path: cur.heading_path,
        level: cur.level,
        line_start: bodyStartLine + cur.start,
        line_end: bodyStartLine + endIdx,
        text,
      });
    }
  };
  lines.forEach((line, i) => {
    const m = /^(#{1,6})\s+(.*)$/.exec(line);
    if (m) {
      flush(i - 1);
      const level = m[1].length;
      const title = m[2].trim();
      // レベル1はページタイトル扱い（節にはしない）
      stack = stack.filter((s) => s.level < level);
      if (level > 1) stack.push({ level, text: title });
      cur = { heading_path: stack.map((s) => s.text).join(" > "), level, start: i + 1, lines: [] };
      return;
    }
    cur.lines.push(line);
  });
  flush(lines.length - 1);

  // 長すぎる節は段落で割る（見出しパスに (2) を付ける）
  const out = [];
  for (const s of sections) {
    if (s.text.length <= MAX_SECTION_CHARS) {
      out.push(s);
      continue;
    }
    const paras = s.text.split(/\n{2,}/);
    let buf = [];
    let bufChars = 0;
    let part = 1;
    let lineCursor = s.line_start;
    const emit = () => {
      if (!buf.length) return;
      const text = buf.join("\n\n");
      const nLines = text.split("\n").length;
      out.push({
        ...s,
        heading_path: part === 1 ? s.heading_path : `${s.heading_path} (${part})`,
        line_start: lineCursor,
        line_end: Math.min(s.line_end, lineCursor + nLines - 1),
        text,
      });
      lineCursor += nLines + 1;
      part++;
      buf = [];
      bufChars = 0;
    };
    for (const p of paras) {
      if (bufChars + p.length > MAX_SECTION_CHARS && buf.length) emit();
      buf.push(p);
      bufChars += p.length;
    }
    emit();
  }
  return out.map((s) => ({ ...s, heading_path: s.heading_path || pageTitle }));
}

const LINK_RE = /\[\[([^\]|#]+?)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g;

export function parsePage({ space, page, raw, mtime }) {
  const { meta, body: rawBody, bodyStartLine } = splitFrontmatter(raw);
  const body = stripQueries(rawBody);
  const title = page.split("/").pop();
  const tags = tagList(meta);
  const status = normalizeStatus(meta.status);
  const isJournal = page.startsWith("Journal/");
  const date = isJournal ? page.replace("Journal/", "") : meta.date || null;
  const summary = meta.summary || meta.description || null;

  const ctxHead = [
    `[${space} / ${page}`,
    tags.length ? `tags: ${tags.join(",")}` : "",
    meta.area ? `area: ${meta.area}` : "",
    status ? `status: ${status}` : "",
    meta.due ? `due: ${meta.due}` : "",
    date ? `date: ${date}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  const sections = splitSections(body, bodyStartLine, { pageTitle: title }).map((s, n) => {
    const context_text = `${ctxHead} > ${s.heading_path}]${summary ? ` summary: ${summary}` : ""}\n${s.text}`;
    return { ...s, id: `${page}#${n}`, n, context_text, hash: sha1(context_text) };
  });

  const links = [];
  for (const m of rawBody.matchAll(LINK_RE)) {
    links.push({ to_page: m[1].trim().replace(/\.md$/, ""), display: (m[2] ?? "").trim() });
  }

  const tasks = [];
  rawBody.split(/\r?\n/).forEach((line, idx) => {
    const t = parseTaskLine(line);
    if (t) tasks.push({ ...t, line: bodyStartLine + idx });
  });

  return {
    row: {
      page,
      mtime,
      modified: new Date(mtime).toISOString(),
      title,
      tags: tags.join(","),
      area: meta.area || null,
      status,
      due: meta.due || null,
      goal: meta.goal || null,
      summary,
      chars: body.length,
      is_journal: isJournal ? 1 : 0,
      date,
    },
    sections,
    links,
    tasks,
  };
}

/**
 * 抽出済みテキストを節に割る。見出しが無いので段落で詰めるだけ。
 * 単位ラベル（p.3 / slide.2 など）があれば「<title> p.3」を見出しパスにし、無ければファイル名。
 * 長い単位は .md と同じく MAX_SECTION_CHARS で割り、(2) 以降を付ける。
 */
export function chunkUnits(units, { title }) {
  const out = [];
  for (const u of units) {
    const base = u.label ? `${title} ${u.label}` : title;
    const paras = u.text.split(/\n{2,}/);
    let buf = [];
    let chars = 0;
    let part = 1;
    const emit = () => {
      if (!buf.length) return;
      const text = buf.join("\n\n").trim();
      buf = [];
      chars = 0;
      if (!text) return;
      out.push({ heading_path: part === 1 ? base : `${base} (${part})`, text });
      part++;
    };
    for (const para of paras) {
      if (chars + para.length > MAX_SECTION_CHARS && buf.length) emit();
      buf.push(para);
      chars += para.length;
    }
    emit();
  }
  return out;
}

/**
 * PDF / Office 文書を .md ページと同じ形に整える。
 * 検索・埋め込み側は kind を意識せず、これまで通り sections だけを見ればよい。
 * 行番号は文書には無いので 0 を入れる（tools 側はそれを見て原本の読み直しを省く）。
 */
export function parseDocument({ space, page, kind, units, mtime }) {
  const title = page.split("/").pop();
  const ctxHead = `[${space} / ${page} kind: ${kind}`;
  const sections = chunkUnits(units, { title }).map((s, n) => {
    const context_text = `${ctxHead} > ${s.heading_path}]\n${s.text}`;
    return {
      ...s,
      id: `${page}#${n}`,
      n,
      level: 0,
      line_start: 0,
      line_end: 0,
      context_text,
      hash: sha1(context_text),
    };
  });
  return {
    row: {
      page,
      kind,
      mtime,
      modified: new Date(mtime).toISOString(),
      title,
      tags: "",
      area: null,
      status: null,
      due: null,
      goal: null,
      summary: null,
      chars: units.reduce((a, u) => a + u.text.length, 0),
      is_journal: 0,
      date: null,
    },
    sections,
    links: [],
    tasks: [],
  };
}

export class SpaceIndex {
  constructor(spaces, space) {
    this.spaces = spaces;
    this.space = space;
    this.db = null;
    this.known = new Map(); // page -> mtime(ms)
    this._refreshing = null;
    this.retryAfter = new Map();
    this.forceExtract = null; // reindex() 中だけ true / Set<page>。保存済みの抽出結果を使わせない
    this.docStatus = new Map(); // page -> { status, retry? }。status: ok / empty / too_large / error / timeout / tool_missing / pending
  }

  async open() {
    const s = await sqlite();
    this.db = new s.oo1.DB(":memory:");
    this.db.exec(SCHEMA);
    return this;
  }

  /** 変更のあったページだけ差し替える。戻り値は変更点の要約。 */
  refresh() {
    if (this._refreshing) return this._refreshing;
    this._refreshing = this._refresh().finally(() => (this._refreshing = null));
    return this._refreshing;
  }

  async _refresh() {
    const files = (await listFiles(this.spaces, this.space)).filter((f) => !EXCLUDE.test(f.page));
    const seen = new Set();
    let changed = 0;
    for (const { full, page } of files) {
      seen.add(page);
      let st;
      try {
        st = await fs.stat(full);
      } catch {
        continue;
      }
      const mtime = st.mtimeMs;
      if (this.known.get(page) === mtime) continue;
      const raw = await fs.readFile(full, "utf-8");
      this.upsert(parsePage({ space: this.space, page, raw, mtime }), full);
      this.known.set(page, mtime);
      changed++;
    }
    // ---- PDF / Office 文書 ----
    // 抽出は .md の読み込みより高いので、mtime が変わったものだけ通す（.md と同じ方針）。
    const started = Date.now();
    for (const { full, page, kind } of await listDocs(this.spaces, this.space)) {
      if (!docIndexable(page, kind)) continue;
      if (seen.has(page)) {
        this.docStatus.delete(page);
        this.retryAfter.delete(page);
        continue; // 同名の .md ページ（foo.txt.md など）が先客。主キーが衝突するので文書は諦める
      }
      seen.add(page);
      let st;
      try {
        st = await fs.stat(full);
      } catch {
        continue;
      }
      // 抽出器の版・設定も鍵に含める。変わったら既知の文書も作り直す。
      const key = `${st.mtimeMs}:${EXTRACT_SIGNATURE}`;
      if (this.known.get(page) === key) continue;
      const cacheKey = `${key}:${st.size}`;
      const forced = this.forceExtract === true || this.forceExtract?.has(page);
      const cached = forced ? null : await loadExtractCache(this.space, page, cacheKey);
      if (cached) {
        // 前回の起動で抽出済み。再抽出せず、予算も使わない。
        this.retryAfter.delete(page);
        this.docStatus.set(page, { status: cached.status });
        if (!cached.units.length) {
          this.remove(page);
          this.known.set(page, key);
          continue;
        }
        try {
          this.upsert(parseDocument({ space: this.space, page, kind, units: cached.units, mtime: st.mtimeMs }), full);
          this.known.set(page, key);
          changed++;
          continue;
        } catch {
          /* 保存内容が使えない。抽出し直す */
        }
      }
      if (Date.now() - started > extractBudgetMs()) {
        // 時間切れ。未処理は次回。すでに索引にある文書は検索できるので、前回の状況を残す。
        if (!this.known.has(page) || !this.docStatus.has(page)) this.docStatus.set(page, { status: "pending" });
        continue;
      }
      if ((this.retryAfter.get(page) ?? 0) > Date.now()) continue; // 状態は前回の失敗理由のまま
      const { units, status } = await extractDocStatus(full, kind);
      if (units === null) {
        // 時間切れ・コマンド無しなど一時的な失敗。mtime は覚えず、しばらくしてからやり直す。
        this.retryAfter.set(page, Date.now() + EXTRACT_RETRY_MS);
        this.docStatus.set(page, { status });
        continue;
      }
      this.retryAfter.delete(page);
      this.docStatus.set(page, { status });
      await saveExtractCache(this.space, page, cacheKey, units, status);
      if (!units.length) {
        // 画像だけの PDF や抽出失敗。毎回やり直さないよう鍵は覚え、古い索引があれば消す。
        this.remove(page);
        this.known.set(page, key);
        continue;
      }
      this.upsert(parseDocument({ space: this.space, page, kind, units, mtime: st.mtimeMs }), full);
      this.known.set(page, key);
      changed++;
    }
    // 停止中に消えた文書の保存ファイルも掃除する（known には残らないため）
    try {
      const dir = path.dirname(extractCacheFile(this.space, ""));
      const live = new Set([...seen].map((p) => `${sha1(p)}.json`));
      for (const f of await fs.readdir(dir)) if (f.endsWith(".json") && !live.has(f)) await fs.rm(path.join(dir, f), { force: true });
    } catch {
      /* ディレクトリが無ければ何もしない */
    }
    // known に入らない文書（pending / timeout / tool_missing）の状況も、ファイルが消えたら捨てる
    for (const page of [...this.docStatus.keys()]) {
      if (!seen.has(page)) {
        this.docStatus.delete(page);
        this.retryAfter.delete(page);
      }
    }
    let removed = 0;
    for (const [page, known] of [...this.known]) {
      if (!seen.has(page)) {
        this.remove(page);
        this.known.delete(page);
        this.docStatus.delete(page);
        this.retryAfter.delete(page);
        if (typeof known === "string") await fs.rm(extractCacheFile(this.space, page), { force: true }).catch(() => {});
        removed++;
      }
    }
    return { space: this.space, changed, removed, pages: this.known.size };
  }

  /**
   * 強制再抽出。page 指定ならその 1 件、無ければ全文書の既知情報と再試行待ちを捨てて組み直す。
   * poppler を入れた後・MEMO_EXTRACT_* を変えた後などに、再起動せず取り込み直すために使う。
   */
  async reindex(page) {
    // 進行中の更新が終わるまで待つ。抜けた直後は同期的に消去して次の更新を始めるので、間に他の呼び出しは入らない。
    while (this._refreshing) await this._refreshing.catch(() => {});
    if (page) {
      if (!this.known.has(page) && !this.docStatus.has(page)) {
        return { space: this.space, changed: 0, removed: 0, pages: this.known.size, warning: "not_found", page, ...this.docReport() };
      }
      this.known.delete(page);
      this.retryAfter.delete(page);
      this.forceExtract = new Set([page]);
    } else {
      // 文書の鍵（"mtime:署名" の文字列）だけ捨てる。.md ページ（数値の mtime）は読み直さない。
      for (const [p, k] of [...this.known]) if (typeof k === "string") this.known.delete(p);
      this.retryAfter.clear();
      this.forceExtract = true;
    }
    let r;
    try {
      r = await this.refresh();
    } finally {
      this.forceExtract = null;
    }
    return { ...r, ...this.docReport() };
  }

  /** 文書の取り込み状況。pending は予算切れで未処理、unreadable はテキストを取れなかったもの。 */
  docReport(limit = 20) {
    const counts = {};
    const unreadable = [];
    for (const [page, { status }] of this.docStatus) {
      counts[status] = (counts[status] ?? 0) + 1;
      if (status !== "ok" && status !== "pending") unreadable.push({ page, status });
    }
    unreadable.sort((a, b) => a.page.localeCompare(b.page));
    return {
      docs_pending: counts.pending ?? 0,
      docs_unreadable: unreadable.length,
      docs_status: counts,
      unreadable: unreadable.slice(0, limit),
    };
  }

  /** 文書ごとの状況（status 指定で絞る）。 */
  docList(status) {
    return [...this.docStatus]
      .filter(([, v]) => !status || v.status === status)
      .map(([page, v]) => ({ page, status: v.status }))
      .sort((a, b) => a.page.localeCompare(b.page));
  }

  remove(page) {
    const db = this.db;
    db.exec({ sql: "delete from sections_fts where id in (select id from sections where page = ?)", bind: [page] });
    for (const t of ["sections", "links", "tasks"]) {
      db.exec({ sql: `delete from ${t} where ${t === "links" ? "from_page" : "page"} = ?`, bind: [page] });
    }
    db.exec({ sql: "delete from pages where page = ?", bind: [page] });
  }

  upsert(parsed, fullPath) {
    const db = this.db;
    db.transaction(() => {
      this.remove(parsed.row.page);
      const r = parsed.row;
      db.exec({
        sql: `insert into pages (page, path, kind, mtime, modified, title, tags, area, status, due, goal, summary, chars, is_journal, date)
              values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        bind: [r.page, fullPath, r.kind ?? "md", r.mtime, r.modified, r.title, r.tags, r.area, r.status, r.due, r.goal, r.summary, r.chars, r.is_journal, r.date],
      });
      for (const s of parsed.sections) {
        db.exec({
          sql: `insert into sections (id, page, n, heading_path, level, line_start, line_end, text, context_text, hash)
                values (?,?,?,?,?,?,?,?,?,?)`,
          bind: [s.id, r.page, s.n, s.heading_path, s.level, s.line_start, s.line_end, s.text, s.context_text, s.hash],
        });
        db.exec({ sql: "insert into sections_fts (id, context_text, heading_path) values (?,?,?)", bind: [s.id, s.context_text, s.heading_path] });
      }
      for (const l of parsed.links) {
        db.exec({ sql: "insert into links (from_page, to_page, display) values (?,?,?)", bind: [r.page, l.to_page, l.display] });
      }
      for (const t of parsed.tasks) {
        db.exec({
          sql: "insert into tasks (page, line, text, done, due, completed, start, tags) values (?,?,?,?,?,?,?,?)",
          bind: [r.page, t.line, t.text, t.done ? 1 : 0, t.due ?? null, t.completed ?? null, t.start ?? null, t.tags.join(",")],
        });
      }
    });
  }

  rows(sql, bind = []) {
    return this.db.exec({ sql, bind, rowMode: "object", returnValue: "resultRows" });
  }

  /**
   * 文書ページ（kind が md 以外）を、索引に入れた抽出済みテキストごと返す。
   * 原本はバイナリなので読み直さない。.md のページや未知のページなら null。
   */
  document(page) {
    const row = this.rows("select page, kind, modified, chars, path from pages where page = ? and kind <> 'md'", [page])[0];
    if (!row) return null;
    const sections = this.rows("select heading_path, text from sections where page = ? order by n", [page]);
    return {
      space: this.space,
      page: row.page,
      kind: row.kind,
      modified: row.modified,
      chars: row.chars,
      sections,
      body: sections.map((s) => `## ${s.heading_path}\n\n${s.text}`).join("\n\n"),
    };
  }

  stats() {
    const one = (sql) => this.rows(sql)[0].n;
    return {
      pages: one("select count(*) n from pages where kind = 'md'"),
      docs: one("select count(*) n from pages where kind <> 'md'"),
      sections: one("select count(*) n from sections"),
      links: one("select count(*) n from links"),
      tasks: one("select count(*) n from tasks"),
      ...this.docReport(),
    };
  }
}

/** 全スペースの索引を持ち、ツールから使う。 */
export class Indexes {
  constructor(spaces) {
    this.spaces = spaces;
    this.byName = new Map();
  }
  async get(space) {
    if (!this.spaces[space]) throw new Error(`未知のスペース: ${space}`);
    let idx = this.byName.get(space);
    if (!idx) {
      idx = await new SpaceIndex(this.spaces, space).open();
      this.byName.set(space, idx);
    }
    await idx.refresh();
    return idx;
  }
  async all(space) {
    const names = space ? [space] : Object.keys(this.spaces);
    return Promise.all(names.map((n) => this.get(n)));
  }
}
