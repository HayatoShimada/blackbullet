// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada
/**
 * SilverBullet スペース（Markdown ファイル群）の読み書き。
 *
 * MCP のトランスポートには依存しない。stdio 版と HTTP 版が同じロジックを共有する。
 */
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { kindOf } from "./extract.mjs";

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
  // CONFIG には API キーやサイドカーのトークンが入る。索引だけでなく、読み書きのどのツールからも触らせない
  if (path.relative(rootResolved, full).toLowerCase() === "config.md") {
    throw new Error("CONFIG は参照できません（トークンや API キーを含むため）");
  }
  return full;
}

/** スペース内をたどり、述語に合う実ファイルを集める（.git などのドット始まりは除外）。 */
async function walkSpace(root, accept) {
  const out = [];
  async function walk(dir) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue; // .git, .silverbullet.auth.json, 書き込み中の .*.tmp など
      const full = path.join(dir, e.name);
      if (e.isDirectory()) await walk(full);
      else if (e.isFile() && accept(e.name)) out.push(full);
    }
  }
  await walk(root);
  out.sort();
  return out;
}

/** スペース内の .md を再帰列挙（.git などは除外）。 */
export async function listFiles(spaces, space) {
  const root = spaceRoot(spaces, space);
  const files = await walkSpace(root, (name) => name.endsWith(".md"));
  return files.map((full) => ({
    full,
    page: path.relative(root, full).replace(/\.md$/, ""),
  }));
}

/**
 * スペース内の PDF / Office 文書を再帰列挙する。
 * page には拡張子を残す。.md のページ名と衝突させないためと、
 * 検索結果からそのまま SilverBullet の添付リンク（![[...]]）を組み立てられるため。
 */
export async function listDocs(spaces, space) {
  const root = spaceRoot(spaces, space);
  const files = await walkSpace(root, (name) => kindOf(name) !== null);
  return files.map((full) => ({
    full,
    page: path.relative(root, full),
    kind: kindOf(full),
  }));
}

const unquote = (s) => s.trim().replace(/^["']|["']$/g, "");
const indentOf = (line) => /^ */.exec(line)[0].length;

/**
 * frontmatter の YAML の、ノートで実際に使われる部分集合を解釈する（完全な YAML パーサは持ち込まない）。
 * - `key: value`（スカラーは文字列のまま）
 * - 値が空で、続く行がより深く字下げされていれば入れ子: `- item` の並びなら配列、`key: value` ならマップ
 *   （例: pageDecoration の icon / cover、`tags:` の下の `- a`）
 * - `[a, b]` の流れ形式は、tagList と metaText で必要なときに配列として読む
 */
function parseYamlBlock(lines) {
  const out = {};
  let i = 0;
  while (i < lines.length) {
    const km = /^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/.exec(lines[i].trimStart());
    const base = indentOf(lines[i]);
    i++;
    if (!km) continue;
    const [, key, raw] = km;
    if (raw.trim() !== "") {
      out[key] = unquote(raw);
      continue;
    }
    // 値が空: 続く、より深く字下げされた行を子として集める（空行は飛ばす）
    const child = [];
    while (i < lines.length && (lines[i].trim() === "" || indentOf(lines[i]) > base)) {
      if (lines[i].trim() !== "") child.push(lines[i]);
      i++;
    }
    if (child.length === 0) out[key] = "";
    else if (child.every((l) => /^\s*-(\s|$)/.test(l))) {
      out[key] = child.map((l) => unquote(l.replace(/^\s*-\s?/, ""))).filter(Boolean);
    } else {
      const depth = Math.min(...child.map(indentOf));
      out[key] = parseYamlBlock(child.map((l) => l.slice(depth)));
    }
  }
  return out;
}

/** frontmatter を分離する。値は文字列、入れ子のマップはオブジェクト、ブロック形式のリストは配列になる。 */
export function splitFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) return { meta: {}, body: text, bodyStartLine: 1 };
  const meta = parseYamlBlock(m[1].split(/\r?\n/));
  // body がファイル全体の何行目から始まるか。タスクの行番号をファイル基準で返すのに要る。
  const consumed = text.slice(0, text.length - m[2].length);
  const bodyStartLine = consumed.split(/\r?\n/).length;
  return { meta, body: m[2], bodyStartLine };
}

/** 索引や文脈行に入れる 1 行の文字列。配列は ", " でつなぎ、マップなど文字列にできないものは null。 */
export function metaText(v) {
  if (typeof v === "string") return v.replace(/^\[(.*)\]$/, "$1");
  if (Array.isArray(v)) return v.map(String).join(", ");
  return null;
}

/** tags: "a, b" / "[a, b]" / ["a", "b"]（ブロック形式のリスト）→ ["a","b"] */
export function tagList(meta) {
  const t = meta.tags;
  if (!t) return [];
  const items = Array.isArray(t) ? t : typeof t === "string" ? t.replace(/^\[(.*)\]$/, "$1").split(",") : [];
  return items.map((x) => unquote(String(x))).filter(Boolean);
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
    status: normalizeStatus(metaText(meta.status)),
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

/** rename を電源断でも失わないようディレクトリを fsync する。対応しない環境（EINVAL / EPERM など）は黙って諦める。 */
async function syncDir(dir) {
  let fh;
  try {
    fh = await fs.open(dir, "r");
    await fh.sync();
  } catch {
    // 非対応なら何もしない（書き込み自体は成功している）
  } finally {
    await fh?.close().catch(() => {});
  }
}

// ファイルごとの直列化。読む→計算→書くの間に別の書き込みが割り込んで更新が消えるのを防ぐ（同一プロセス内）。
const locks = new Map();
export async function withFileLock(file, fn) {
  const full = await fs.realpath(file).catch(() => file); // シンボリックリンク経由でも同じ鍵にする
  const prev = locks.get(full) ?? Promise.resolve();
  const run = prev.catch(() => {}).then(fn);
  const tail = run.catch(() => {});
  locks.set(full, tail);
  try {
    return await run;
  } finally {
    if (locks.get(full) === tail) locks.delete(full);
  }
}

/**
 * ファイルを原子的に書き換える。
 * 同じディレクトリに一時ファイルを書いてから rename するので、途中で落ちても
 * 元のファイルが半端な状態にはならず、SilverBullet のウォッチャにも完成した内容だけが見える。
 * 一時ファイルはドット始まりにして listFiles / listDocs の列挙から外す。
 */
export async function writeAtomic(full, data) {
  // シンボリックリンクは writeFile と同じく指す先を書く（rename でリンクを置き換えない）
  try {
    full = await fs.realpath(full);
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  const dir = path.dirname(full);
  // 長い日本語のページ名でも ENAMETOOLONG にならないよう、元の名前は含めない
  const tmp = path.join(dir, `.mcp-${process.pid}-${crypto.randomBytes(4).toString("hex")}.tmp`);
  let mode;
  try {
    mode = (await fs.stat(full)).mode & 0o7777;
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  try {
    const fh = await fs.open(tmp, "wx");
    try {
      await fh.writeFile(data, "utf-8");
      await fh.sync();
    } finally {
      await fh.close();
    }
    // 既存ファイルの権限を引き継ぐ（open の mode は umask で削られるので chmod で合わせる）
    if (mode !== undefined) await fs.chmod(tmp, mode);
    await fs.rename(tmp, full);
    await syncDir(dir);
  } catch (e) {
    await fs.unlink(tmp).catch(() => {});
    throw e;
  }
}

/** ページ末尾に追記する。存在しなければ initial で作る。 */
export async function appendToPage(spaces, space, page, text, opts = {}) {
  const full = resolvePage(spaces, space, page);
  return withFileLock(full, () => appendUnlocked(full, space, page, text, opts));
}

async function appendUnlocked(full, space, page, text, { expectedModified, initial } = {}) {
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
  await writeAtomic(full, next);
  const stat = await fs.stat(full);
  return { space, page, bytes: stat.size, modified: stat.mtime.toISOString() };
}

/** 指定セクション（## 見出し）の直後に行を挿入する。無ければ末尾に追記。 */
export async function insertUnderHeading(spaces, space, page, heading, line, opts = {}) {
  const full = resolvePage(spaces, space, page);
  return withFileLock(full, () => insertUnlocked(full, space, page, heading, line, opts));
}

async function insertUnlocked(full, space, page, heading, line, { expectedModified } = {}) {
  const current = await fs.readFile(full, "utf-8");
  await assertUnchanged(full, expectedModified);
  const lines = current.split(/\r?\n/);
  const idx = lines.findIndex((l) => l.trim() === heading.trim());
  if (idx === -1) {
    return appendUnlocked(full, space, page, `\n${heading}\n\n${line}`, { expectedModified: undefined });
  }
  // 見出し直後の空行を飛ばし、そのセクションの末尾（次の見出しの手前）に入れる
  let insertAt = idx + 1;
  while (insertAt < lines.length && !/^#{1,6}\s/.test(lines[insertAt])) insertAt++;
  while (insertAt > idx + 1 && lines[insertAt - 1].trim() === "") insertAt--;
  lines.splice(insertAt, 0, line);
  await writeAtomic(full, lines.join("\n"));
  const stat = await fs.stat(full);
  return { space, page, inserted_at_line: insertAt + 1, modified: stat.mtime.toISOString() };
}

/** タスク行の [ ] を [x] にし、[completed: ...] を付ける。 */
export async function completeTask(spaces, space, page, lineNumber, completedDate, opts = {}) {
  const full = resolvePage(spaces, space, page);
  return withFileLock(full, () => completeUnlocked(full, space, page, lineNumber, completedDate, opts));
}

async function completeUnlocked(full, space, page, lineNumber, completedDate, { expectedModified } = {}) {
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
  await writeAtomic(full, lines.join("\n"));
  const stat = await fs.stat(full);
  return { space, page, line: lineNumber, text: next.trim(), modified: stat.mtime.toISOString() };
}

/** frontmatter 内の `key: value` 行を差し替える（無ければ閉じ --- の直前に足す）。本文は触らない。 */
function setFrontmatterKey(text, key, value) {
  const m = /^(---\r?\n)([\s\S]*?)(\r?\n---)/.exec(text);
  if (!m) throw new Error("frontmatter がありません");
  const re = new RegExp(`^${key}:.*$`, "m");
  const block = re.test(m[2]) ? m[2].replace(re, `${key}: ${value}`) : `${m[2]}\n${key}: ${value}`;
  return m[1] + block + text.slice(m[1].length + m[2].length);
}

/** todo ページ（tags に todo を含むページ）を status: done・completed: 日付にする。 */
export async function completeTodoPage(spaces, space, page, completedDate, opts = {}) {
  const full = resolvePage(spaces, space, page);
  return withFileLock(full, async () => {
    const current = await fs.readFile(full, "utf-8").catch((e) => {
      if (e.code === "ENOENT") throw new Error(`ページが見つかりません: ${space}/${page}`);
      throw e;
    });
    await assertUnchanged(full, opts.expectedModified);
    const { meta } = splitFrontmatter(current);
    if (!tagList(meta).includes("todo")) throw new Error(`todo ページではありません（tags に todo がありません）: ${page}`);
    if (normalizeStatus(metaText(meta.status)) === "done") throw new Error(`既に完了しています: ${page}`);
    const next = setFrontmatterKey(setFrontmatterKey(current, "status", "done"), "completed", completedDate);
    await writeAtomic(full, next);
    const stat = await fs.stat(full);
    return { space, page, kind: "page", status: "done", completed: completedDate, modified: stat.mtime.toISOString() };
  });
}

/** 本文テキストから Tasks/ のページ名にする題名を作る。 */
export function todoTitle(text) {
  let t = text
    .replace(/\[\[([^\]]*)\]\]/g, (_, inner) => inner.split("|").pop().split("/").pop())
    .replace(/\[[A-Za-z_]+:[^\]]*\]/g, "")
    .replace(/(^|\s)#[^\s#]+/g, "$1")
    .replace(/[\/#@|<>$`\[\]\\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  t = Array.from(t).slice(0, 40).join("").trim();
  return t || "Task";
}

/** Tasks/<title> に todo ページを新規作成する。既存と衝突したら " 2", " 3"… を付ける。 */
export async function createTodoPage(spaces, space, title, content) {
  for (let n = 1; n < 1000; n++) {
    const page = `Tasks/${n === 1 ? title : `${title} ${n}`}`;
    const full = resolvePage(spaces, space, page);
    const made = await withFileLock(full, async () => {
      try {
        await fs.access(full);
        return null;
      } catch {
        /* 無ければ作る */
      }
      await fs.mkdir(path.dirname(full), { recursive: true });
      await writeAtomic(full, content(page.slice("Tasks/".length)));
      const stat = await fs.stat(full);
      return { space, page, bytes: stat.size, modified: stat.mtime.toISOString() };
    });
    if (made) return made;
  }
  throw new Error("同名の todo ページが多すぎます");
}

// ---------- 汎用の編集（write_note / edit_note / update_section） ----------

// 汎用の編集ツールが書かない場所。Library/ は Std のコード、Templates/ はテンプレート。
// ドット始まりは .silverbullet.auth.json や書き込み中の一時ファイル。
const READ_ONLY_DIRS = ["library", "templates"];

/** 汎用の編集ツールで書いてよいページかを確かめる。CONFIG とスペース外は resolvePage が拒否する。 */
export function assertWritable(page) {
  const parts = page.replace(/\\/g, "/").split("/");
  if (parts.some((p) => p.startsWith("."))) throw new Error(`ドットで始まるパスには書けません: ${page}`);
  if (READ_ONLY_DIRS.includes(parts[0].toLowerCase())) {
    throw new Error(`${parts[0]}/ には書けません（Std のコードやテンプレートのため）: ${page}`);
  }
}

async function readExisting(full, space, page) {
  try {
    return await fs.readFile(full, "utf-8");
  } catch (e) {
    if (e.code === "ENOENT") throw new Error(`ページが見つかりません: ${space}/${page}`);
    throw e;
  }
}

async function written(full, space, page, extra = {}) {
  const stat = await fs.stat(full);
  return { space, page, ...extra, bytes: stat.size, modified: stat.mtime.toISOString() };
}

/** ページを丸ごと書く。無ければ作る。既存ページの上書きには expectedModified が要る。 */
export async function writeNote(spaces, space, page, content, { expectedModified } = {}) {
  assertWritable(page);
  const full = resolvePage(spaces, space, page);
  return withFileLock(full, async () => {
    let exists = true;
    try {
      await fs.access(full);
    } catch {
      exists = false;
    }
    if (exists) {
      // ブラウザで開いている内容を黙って消さないよう、読んだ版を示してもらう
      if (!expectedModified) {
        throw new Error(`既にあるページです: ${space}/${page}。上書きするには read_note の modified を expected_modified に渡してください`);
      }
      await assertUnchanged(full, expectedModified);
    } else {
      await fs.mkdir(path.dirname(full), { recursive: true });
    }
    await writeAtomic(full, content.endsWith("\n") ? content : `${content}\n`);
    return written(full, space, page, { created: !exists });
  });
}

/** 完全一致の文字列を置き換える。見つからない・複数ある（replaceAll なし）ときは書かずにエラー。 */
export async function editNote(spaces, space, page, oldText, newText, { replaceAll = false, expectedModified } = {}) {
  assertWritable(page);
  if (!oldText) throw new Error("old_text が空です");
  const full = resolvePage(spaces, space, page);
  return withFileLock(full, async () => {
    const current = await readExisting(full, space, page);
    await assertUnchanged(full, expectedModified);
    const count = current.split(oldText).length - 1;
    if (count === 0) throw new Error(`old_text が見つかりません: ${oldText.slice(0, 80)}`);
    if (count > 1 && !replaceAll) {
      throw new Error(`old_text が ${count} 箇所にあります。前後の行を含めて一意にするか、replace_all を指定してください`);
    }
    const next = replaceAll ? current.split(oldText).join(newText) : current.replace(oldText, () => newText);
    await writeAtomic(full, next);
    return written(full, space, page, { replaced: replaceAll ? count : 1 });
  });
}

const normHeading = (h) => h.trim().replace(/\s+/g, " ");

/** 見出し行を集める。frontmatter とコードブロックの中の # 行は見出しではない。 */
function headingLines(lines) {
  const out = [];
  let i = 0;
  if (lines[0]?.trim() === "---") i = lines.findIndex((l, k) => k > 0 && l.trim() === "---") + 1;
  let fence = null;
  for (; i < lines.length; i++) {
    const l = lines[i];
    const f = /^\s*(```|~~~)/.exec(l);
    if (f) {
      if (!fence) fence = f[1];
      else if (l.trim().startsWith(fence)) fence = null;
      continue;
    }
    if (fence) continue;
    const m = /^(#{1,6})\s+\S/.exec(l);
    if (m) out.push({ i, level: m[1].length, text: normHeading(l) });
  }
  return out;
}

/**
 * 見出しの節を置き換える（mode=replace）か、節の末尾に足す（mode=append）。
 * 節は見出しの次の行から、同じかより上のレベルの次の見出しの手前まで（下位の見出しも節に含む）。
 * 見出しが無ければページの末尾に作る。
 */
export async function updateSection(spaces, space, page, heading, content, { mode = "replace", expectedModified } = {}) {
  assertWritable(page);
  const hm = /^(#{1,6})\s+\S/.exec(heading.trim());
  if (!hm) throw new Error(`見出しは "## 名前" の形で渡してください: ${heading}`);
  const level = hm[1].length;
  const full = resolvePage(spaces, space, page);
  return withFileLock(full, async () => {
    const current = await readExisting(full, space, page);
    await assertUnchanged(full, expectedModified);
    const lines = current.split(/\r?\n/);
    const body = content.replace(/\s+$/, "").split(/\r?\n/);
    const headings = headingLines(lines);
    const h = headings.find((x) => x.text === normHeading(heading));
    if (!h) {
      while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
      if (lines.length) lines.push("");
      lines.push(normHeading(heading), "", ...body, "");
      await writeAtomic(full, lines.join("\n"));
      return written(full, space, page, { heading: normHeading(heading), created_heading: true });
    }
    const next = headings.find((x) => x.i > h.i && x.level <= level);
    const end = next ? next.i : lines.length;
    let contentEnd = end;
    while (contentEnd > h.i + 1 && lines[contentEnd - 1].trim() === "") contentEnd--;
    const existing = lines.slice(h.i + 1, contentEnd);
    const keep = mode === "append" && existing.some((l) => l.trim()) ? existing : [""];
    lines.splice(h.i + 1, end - (h.i + 1), ...keep, ...body, "");
    await writeAtomic(full, lines.join("\n"));
    return written(full, space, page, { heading: h.text, mode });
  });
}
