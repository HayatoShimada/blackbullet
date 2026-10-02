// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada
/**
 * スペースの索引。起動時にメモリ上の SQLite（公式 WASM 版）へ組み直し、
 * 以後はファイルの mtime を見て変わったページだけ差し替える。
 *
 * ネイティブの better-sqlite3 は一部の環境（ARM など）で new Database() が落ちる（ABI の相性）ため使わない。
 * 74 ファイル・約 100k 字なので全件組み直しでも 1 秒かからない。永続化が要るのは
 * 埋め込みだけで、それは embed.mjs が節ハッシュ単位で MEMO_INDEX_DIR（既定 ~/.cache/memo-mcp）に置く。
 *
 * 検索の最小単位は「節」（## 見出しごと）。各節には
 *   [space / page > 見出しパス] tags: … area: … status: …
 * を先頭に前置した context_text を持たせ、FTS もこの文字列に張る（contextual retrieval）。
 */
import fs from "node:fs/promises";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import sqlite3InitModule from "@sqlite.org/sqlite-wasm";
import {
  listFiles,
  splitFrontmatter,
  tagList,
  normalizeStatus,
  stripQueries,
  parseTaskLine,
} from "./space.mjs";

export const INDEX_DIR = process.env.MEMO_INDEX_DIR ?? path.join(os.homedir(), ".cache", "memo-mcp");
// CONFIG.md には memoSidecar のトークンを置くため、検索・埋め込みの対象にしない
const EXCLUDE = /^((Templates|Library|Images)(\/|$)|CONFIG$)/;
const MAX_SECTION_CHARS = 2000;

let sqlite3Promise;
function sqlite() {
  if (!sqlite3Promise) sqlite3Promise = sqlite3InitModule({ print() {}, printErr() {} });
  return sqlite3Promise;
}

const SCHEMA = `
create table pages (
  page text primary key, path text, mtime real, modified text, title text,
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

export class SpaceIndex {
  constructor(spaces, space) {
    this.spaces = spaces;
    this.space = space;
    this.db = null;
    this.known = new Map(); // page -> mtime(ms)
    this._refreshing = null;
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
    let removed = 0;
    for (const page of [...this.known.keys()]) {
      if (!seen.has(page)) {
        this.remove(page);
        this.known.delete(page);
        removed++;
      }
    }
    return { space: this.space, changed, removed, pages: this.known.size };
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
        sql: `insert into pages (page, path, mtime, modified, title, tags, area, status, due, goal, summary, chars, is_journal, date)
              values (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        bind: [r.page, fullPath, r.mtime, r.modified, r.title, r.tags, r.area, r.status, r.due, r.goal, r.summary, r.chars, r.is_journal, r.date],
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

  stats() {
    const one = (sql) => this.rows(sql)[0].n;
    return {
      pages: one("select count(*) n from pages"),
      sections: one("select count(*) n from sections"),
      links: one("select count(*) n from links"),
      tasks: one("select count(*) n from tasks"),
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
