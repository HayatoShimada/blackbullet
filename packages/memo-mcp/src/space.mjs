// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada
/**
 * SilverBullet スペース（Markdown ファイル群）の読み書き。
 *
 * MCP のトランスポートには依存しない。stdio 版と HTTP 版が同じロジックを共有する。
 */
import fs from "node:fs/promises";
import path from "node:path";

/**
 * Spaces are configured via MEMO_SPACES: comma-separated `name=/abs/path` entries,
 * with an optional `:confidential` suffix flag per entry.
 *   MEMO_SPACES="notes=/data/notes,work=/data/work:confidential"
 * There are no default spaces.
 */
export function parseSpaces(raw) {
  if (!raw || !raw.trim()) {
    throw new Error(
      "MEMO_SPACES is not set. Example: MEMO_SPACES=\"notes=/data/notes,work=/data/work:confidential\""
    );
  }
  const out = {};
  for (const entry of raw.split(",").map((s) => s.trim()).filter(Boolean)) {
    const eq = entry.indexOf("=");
    if (eq <= 0) throw new Error(`Invalid MEMO_SPACES entry: "${entry}" (expected name=/abs/path[:confidential])`);
    const name = entry.slice(0, eq).trim();
    let root = entry.slice(eq + 1).trim();
    let confidential = false;
    if (root.endsWith(":confidential")) {
      confidential = true;
      root = root.slice(0, -":confidential".length);
    }
    if (!root) throw new Error(`Invalid MEMO_SPACES entry: "${entry}" (empty path)`);
    out[name] = {
      root,
      confidential,
      description: `Markdown space "${name}"${confidential ? " (confidential)" : ""}`,
    };
  }
  if (Object.keys(out).length === 0) throw new Error("MEMO_SPACES is empty");
  return out;
}

export function enabledSpaces() {
  return parseSpaces(process.env.MEMO_SPACES);
}

function spaceRoot(spaces, name) {
  const s = spaces[name];
  if (!s) throw new Error(`未知のスペース: ${name}（利用可能: ${Object.keys(spaces).join(", ")}）`);
  return s.root;
}

/**
 * ページ名からファイルパスを解決する。
 * スペース外へ出る指定（.. や絶対パス）は拒否する。
 */
export function resolvePage(spaces, space, page) {
  const root = spaceRoot(spaces, space);
  const rel = page.endsWith(".md") ? page : `${page}.md`;
  const full = path.resolve(root, rel);
  const rootResolved = path.resolve(root);
  if (full !== rootResolved && !full.startsWith(rootResolved + path.sep)) {
    throw new Error(`スペースの外は参照できません: ${page}`);
  }
  return full;
}

/** スペース内の .md を再帰列挙（.git などは除外）。 */
export async function listFiles(spaces, space) {
  const root = spaceRoot(spaces, space);
  const out = [];
  async function walk(dir) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue; // .git, .silverbullet.auth.json など
      const full = path.join(dir, e.name);
      if (e.isDirectory()) await walk(full);
      else if (e.isFile() && e.name.endsWith(".md")) out.push(full);
    }
  }
  await walk(root);
  out.sort();
  return out.map((full) => ({
    full,
    page: path.relative(root, full).replace(/\.md$/, ""),
  }));
}

/**
 * frontmatter を分離する。
 * 単純な `key: value` のみを解釈する。SilverBullet の実データがその形しか使っていないため、
 * 完全な YAML パーサは持ち込まない。
 */
export function splitFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) return { meta: {}, body: text, bodyStartLine: 1 };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const km = /^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/.exec(line);
    if (!km) continue;
    let v = km[2].trim().replace(/^["']|["']$/g, "");
    meta[km[1]] = v;
  }
  // body がファイル全体の何行目から始まるか。タスクの行番号をファイル基準で返すのに要る。
  const consumed = text.slice(0, text.length - m[2].length);
  const bodyStartLine = consumed.split(/\r?\n/).length;
  return { meta, body: m[2], bodyStartLine };
}

/** tags: "a, b" → ["a","b"] */
export function tagList(meta) {
  if (!meta.tags) return [];
  return meta.tags.split(",").map((t) => t.trim()).filter(Boolean);
}

/**
 * status の表記ゆれを吸収する。
 * 実データには active / done / completed / someday が混在している。
 */
export function normalizeStatus(raw) {
  if (!raw) return null;
  const v = raw.trim().toLowerCase();
  if (v === "completed") return "done";
  return v;
}

/**
 * SilverBullet の Space Lua クエリブロックを取り除く。
 * `${query[[...]]}` や `${some(query[[...]]) or "..."}` は SilverBullet が実行時に
 * 展開するもので、MCP クライアントには意味のない文字列としてしか届かない。
 * Areas ページと index.md は本文の大半がこれなので、既定で外す。
 */
export function stripQueries(body) {
  // ${ ... } を対応括弧で数えて除去する（入れ子の } に耐えるため正規表現では切らない）
  let out = "";
  let i = 0;
  while (i < body.length) {
    const start = body.indexOf("${", i);
    if (start === -1) {
      out += body.slice(i);
      break;
    }
    const chunk = body.slice(i, start);
    let depth = 0;
    let j = start + 1; // '{' の位置から数える
    for (; j < body.length; j++) {
      if (body[j] === "{") depth++;
      else if (body[j] === "}") {
        depth--;
        if (depth === 0) break;
      }
    }
    if (depth !== 0) {
      // 閉じていない。そのまま残す。
      out += body.slice(i);
      break;
    }
    const inner = body.slice(start, j + 1);
    const isQuery = /\bquery\s*\[\[/.test(inner) || /\bwidgets\./.test(inner) || /\btemplates\./.test(inner);
    // 置き換えても行数を変えない（節や タスクの行番号がファイル基準のまま保てるように）
    const newlines = isQuery ? "\n".repeat((inner.match(/\n/g) ?? []).length) : "";
    out += chunk + (isQuery ? "_(SilverBulletのクエリ。MCP経由では展開されません)_" + newlines : inner);
    i = j + 1;
  }
  return out;
}

const TASK_RE = /^(\s*)\*\s\[([ xX])\]\s(.*)$/;

/** 1行をタスクとして解釈する。タスクでなければ null。 */
export function parseTaskLine(line) {
  const m = TASK_RE.exec(line);
  if (!m) return null;
  let text = m[3];
  const attrs = {};
  // [due: 2026-09-20] のようなインライン属性
  text = text.replace(/\[([a-z]+):\s*([^\]]*)\]/g, (_, k, v) => {
    attrs[k] = v.trim();
    return "";
  });
  const tags = [...text.matchAll(/#([A-Za-z0-9_-]+)/g)].map((t) => t[1]);
  text = text.replace(/#[A-Za-z0-9_-]+/g, "").replace(/\s+/g, " ").trim();
  return { done: m[2].toLowerCase() === "x", text, tags, ...attrs };
}

/** 1ページを読み、メタ・本文・タスクに分解する。 */
export async function readPage(spaces, space, page, { stripQuery = true } = {}) {
  const full = resolvePage(spaces, space, page);
  let raw;
  try {
    raw = await fs.readFile(full, "utf-8");
  } catch (e) {
    if (e.code === "ENOENT") throw new Error(`ページが見つかりません: ${space}/${page}`);
    throw e;
  }
  const stat = await fs.stat(full);
  const { meta, body, bodyStartLine } = splitFrontmatter(raw);
  const tasks = [];
  // line は「ファイル全体の行番号」。complete_task がこの値をそのまま使う。
  body.split(/\r?\n/).forEach((line, idx) => {
    const t = parseTaskLine(line);
    if (t) tasks.push({ ...t, line: bodyStartLine + idx });
  });
  return {
    space,
    page,
    tags: tagList(meta),
    status: normalizeStatus(meta.status),
    meta,
    body: stripQuery ? stripQueries(body) : body,
    tasks,
    modified: stat.mtime.toISOString(),
    bytes: stat.size,
  };
}

/** スペース横断でページのメタ情報だけを集める。 */
export async function indexSpace(spaces, space, { stripQuery = true } = {}) {
  const files = await listFiles(spaces, space);
  const pages = [];
  for (const { page } of files) {
    try {
      pages.push(await readPage(spaces, space, page, { stripQuery }));
    } catch {
      /* 読めないファイルは飛ばす */
    }
  }
  return pages;
}

/**
 * 書き込み前の競合チェック。
 * SilverBullet を開いたまま外から書くと、ブラウザ側の保存で上書きされうる。
 * 読み取り時の mtime を expectedModified で渡してもらい、変わっていたら拒否する。
 */
export async function assertUnchanged(full, expectedModified) {
  if (!expectedModified) return;
  const stat = await fs.stat(full);
  const actual = stat.mtime.toISOString();
  if (actual !== expectedModified) {
    throw new Error(
      `ページが読み取り後に変更されています（期待 ${expectedModified} / 実際 ${actual}）。` +
        `再度読み込んでから書き込んでください。`
    );
  }
}

/** ページ末尾に追記する。存在しなければ initial で作る。 */
export async function appendToPage(spaces, space, page, text, { expectedModified, initial } = {}) {
  const full = resolvePage(spaces, space, page);
  let current;
  try {
    current = await fs.readFile(full, "utf-8");
    await assertUnchanged(full, expectedModified);
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
    if (initial === undefined) throw new Error(`ページが見つかりません: ${space}/${page}`);
    await fs.mkdir(path.dirname(full), { recursive: true });
    current = initial;
  }
  const sep = current.endsWith("\n") ? "" : "\n";
  const next = `${current}${sep}${text}\n`;
  await fs.writeFile(full, next, "utf-8");
  const stat = await fs.stat(full);
  return { space, page, bytes: stat.size, modified: stat.mtime.toISOString() };
}

/** 指定セクション（## 見出し）の直後に行を挿入する。無ければ末尾に追記。 */
export async function insertUnderHeading(spaces, space, page, heading, line, { expectedModified } = {}) {
  const full = resolvePage(spaces, space, page);
  const current = await fs.readFile(full, "utf-8");
  await assertUnchanged(full, expectedModified);
  const lines = current.split(/\r?\n/);
  const idx = lines.findIndex((l) => l.trim() === heading.trim());
  if (idx === -1) {
    return appendToPage(spaces, space, page, `\n${heading}\n\n${line}`, { expectedModified: undefined });
  }
  // 見出し直後の空行を飛ばし、そのセクションの末尾（次の見出しの手前）に入れる
  let insertAt = idx + 1;
  while (insertAt < lines.length && !/^#{1,6}\s/.test(lines[insertAt])) insertAt++;
  while (insertAt > idx + 1 && lines[insertAt - 1].trim() === "") insertAt--;
  lines.splice(insertAt, 0, line);
  await fs.writeFile(full, lines.join("\n"), "utf-8");
  const stat = await fs.stat(full);
  return { space, page, inserted_at_line: insertAt + 1, modified: stat.mtime.toISOString() };
}

/** タスク行の [ ] を [x] にし、[completed: ...] を付ける。 */
export async function completeTask(spaces, space, page, lineNumber, completedDate, { expectedModified } = {}) {
  const full = resolvePage(spaces, space, page);
  const current = await fs.readFile(full, "utf-8");
  await assertUnchanged(full, expectedModified);
  const lines = current.split(/\r?\n/);
  const i = lineNumber - 1;
  if (i < 0 || i >= lines.length) throw new Error(`行番号が範囲外です: ${lineNumber}`);
  const m = TASK_RE.exec(lines[i]);
  if (!m) throw new Error(`${lineNumber}行目はタスクではありません: ${lines[i].slice(0, 80)}`);
  if (m[2].toLowerCase() === "x") throw new Error(`${lineNumber}行目は既に完了しています`);
  let next = lines[i].replace(/^(\s*)\*\s\[\s\]/, "$1* [x]");
  if (!/\[completed:/.test(next)) next = `${next.trimEnd()} [completed: ${completedDate}]`;
  lines[i] = next;
  await fs.writeFile(full, lines.join("\n"), "utf-8");
  const stat = await fs.stat(full);
  return { space, page, line: lineNumber, text: next.trim(), modified: stat.mtime.toISOString() };
}
