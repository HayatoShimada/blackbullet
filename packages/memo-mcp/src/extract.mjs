// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada
/**
 * PDF / Office 文書からプレーンテキストを取り出す。
 *
 * 依存は増やさない。pdftotext (poppler-utils) と unzip は Dockerfile で apt から入れる外部コマンドで、
 * ネイティブ拡張を抱えないので better-sqlite3 のような ABI の事故が起きない。
 * どちらかが無い環境では抽出が空になるだけで、.md の索引はこれまで通り動く。
 *
 * 取り出したテキストは index.mjs が .md と同じ「節」に割って FTS と埋め込みに載せる。
 * ここが返すのは「単位（ページ/スライド/シート）ごとのテキスト」までで、
 * 節への分割はしない。単位のラベルは検索結果の見出しパスに出る（p.3 など）。
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";

const run = promisify(execFile);

/** 拡張子 → 種別。ここに無いものは索引しない。 */
export const DOC_KINDS = new Map([
  [".pdf", "pdf"],
  [".docx", "docx"],
  [".xlsx", "xlsx"],
  [".pptx", "pptx"],
  [".txt", "text"],
  [".csv", "text"],
]);

export function kindOf(file) {
  return DOC_KINDS.get(path.extname(file).toLowerCase()) ?? null;
}

// Pi の CPU で長時間ブロックさせない。超えたものは索引を諦める（検索に出ないだけで害はない）。
const TIMEOUT_MS = Number(process.env.MEMO_EXTRACT_TIMEOUT ?? 30_000);
const MAX_BYTES = Number(process.env.MEMO_EXTRACT_MAX_BYTES ?? 8 * 1024 * 1024);
const MAX_CHARS = Number(process.env.MEMO_EXTRACT_MAX_CHARS ?? 400_000);

const XML_ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

/** エンティティを 1 パスで復号する（&amp;#65; を二重に復号しない）。範囲外の数値参照は原文のまま残す。 */
function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) => {
    if (e[0] !== "#") return XML_ENTITIES[e.toLowerCase()];
    const cp = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1));
    return Number.isInteger(cp) && cp >= 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff) ? String.fromCodePoint(cp) : m;
  });
}

/** OOXML の断片からテキストを抜く。段落・改行に当たるタグは改行、セル・タブは空白に変える。 */
function xmlText(xml, { breakTags }) {
  let s = xml;
  for (const t of breakTags) s = s.replaceAll(new RegExp(`</${t}>`, "g"), "\n");
  s = s.replace(/<\/(?:w|a):tc>/g, " ").replace(/<w:tab\b[^>]*\/>/g, " ");
  s = s.replace(/<(?:w:br|w:cr|a:br)\b[^>]*\/>/g, "\n");
  s = s.replace(/<[^>]*>/g, "");
  s = decodeEntities(s);
  return s.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** 一時的な失敗（時間切れ・コマンド無し・資源不足）。文書自体の問題ではないので、結果を覚えずに再試行させる。 */
function isTransient(e) {
  return e?.killed === true || e?.signal != null || e?.code === "ENOENT" || e?.code === "EAGAIN" || e?.code === "ENOMEM";
}

async function unzipMember(file, member) {
  // -p は標準出力に出す。存在しないメンバー（unzip の終了コード 11）は空を返して呼び手に判断させる。
  try {
    const { stdout } = await run("unzip", ["-p", file, member], {
      timeout: TIMEOUT_MS,
      maxBuffer: MAX_BYTES,
      encoding: "utf-8",
    });
    return stdout;
  } catch (e) {
    if (isTransient(e)) throw e;
    return "";
  }
}

async function unzipList(file) {
  try {
    const { stdout } = await run("unzip", ["-Z1", file], {
      timeout: TIMEOUT_MS,
      maxBuffer: MAX_BYTES,
      encoding: "utf-8",
    });
    return stdout.split(/\r?\n/).filter(Boolean);
  } catch (e) {
    if (isTransient(e)) throw e;
    return [];
  }
}

async function extractPdf(file) {
  // -layout は表組みの桁を保つ。pdftotext はページ区切りに \f を入れる。
  const { stdout } = await run("pdftotext", ["-layout", "-enc", "UTF-8", file, "-"], {
    timeout: TIMEOUT_MS,
    maxBuffer: MAX_BYTES,
    encoding: "utf-8",
  });
  return stdout.split("\f").map((text, i) => ({ label: `p.${i + 1}`, text: text.trim() }));
}

async function extractDocx(file) {
  const xml = await unzipMember(file, "word/document.xml");
  if (!xml) return [];
  // w:p が段落、w:tr が表の行。w:br / w:tab / セル境界は xmlText が改行・空白にする。
  const text = xmlText(xml, { breakTags: ["w:p", "w:tr"] });
  return [{ label: null, text }];
}

async function extractXlsx(file) {
  // 文字列セルの実体は sharedStrings に集約されている。数式や数値は拾わないが、
  // ナレッジ検索で要るのは見出し・項目名・備考といった文字列のほう。
  const shared = await unzipMember(file, "xl/sharedStrings.xml");
  const out = [];
  if (shared) {
    const text = xmlText(shared, { breakTags: ["si"] });
    if (text) out.push({ label: "文字列", text });
  }
  const wb = await unzipMember(file, "xl/workbook.xml");
  if (wb) {
    const names = [...wb.matchAll(/<sheet[^>]*name="([^"]+)"/g)].map((m) => decodeEntities(m[1]));
    if (names.length) out.push({ label: "シート名", text: names.join("\n") });
  }
  return out;
}

async function extractPptx(file) {
  const slides = (await unzipList(file))
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => {
      const n = (s) => Number(/slide(\d+)\.xml$/.exec(s)[1]);
      return n(a) - n(b);
    });
  const out = [];
  for (const s of slides) {
    const xml = await unzipMember(file, s);
    if (!xml) continue;
    // a:p が段落。スライド番号は本文より当てになるので見出しに使う。
    const text = xmlText(xml, { breakTags: ["a:p"] });
    const n = /slide(\d+)\.xml$/.exec(s)[1];
    if (text) out.push({ label: `slide.${n}`, text });
  }
  return out;
}

async function extractPlain(file) {
  // 巨大なログや CSV をメモリに載せない。上限を超えたものは索引しない（抽出器の maxBuffer 超過と同じ扱い）。
  if ((await fs.stat(file)).size > MAX_BYTES) return [];
  const buf = await fs.readFile(file);
  return [{ label: null, text: buf.toString("utf-8") }];
}

const EXTRACTORS = {
  pdf: extractPdf,
  docx: extractDocx,
  xlsx: extractXlsx,
  pptx: extractPptx,
  text: extractPlain,
};

/**
 * 文書からテキスト単位の配列を返す。
 * テキストが無い場合は空配列（画像だけの PDF、壊れたファイル、出力が上限超過など。変わるまで再試行しない）。
 * 一時的な失敗（時間切れ・コマンド無し）は null。呼び手は結果を覚えず、後で再試行する。
 */
export async function extractDoc(file, kind = kindOf(file)) {
  const fn = EXTRACTORS[kind];
  if (!fn) return [];
  let units;
  try {
    units = await fn(file);
  } catch (e) {
    return isTransient(e) ? null : []; // 抽出の失敗で索引全体を止めない
  }
  let total = 0;
  const out = [];
  for (const u of units) {
    const text = (u.text ?? "").replace(/\r\n/g, "\n").trim();
    if (!text) continue;
    if (total + text.length > MAX_CHARS) {
      out.push({ ...u, text: text.slice(0, Math.max(0, MAX_CHARS - total)) });
      break;
    }
    total += text.length;
    out.push({ ...u, text });
  }
  return out;
}

// 文書として索引しない: 雛形とプラグの置き場、および秘密の置き場に見える名前（token.txt / passwords.csv など）。
const DOC_EXCLUDE = /^(Templates|Library)(\/|$)/;
const SECRET_NAME = /(token|secret|password|credential)/i;
// 追加の除外（正規表現）と、索引する種別の絞り込み（例 "pdf,docx"）。
const EXTRA_EXCLUDE = process.env.MEMO_DOC_EXCLUDE ? new RegExp(process.env.MEMO_DOC_EXCLUDE) : null;
const KINDS = process.env.MEMO_EXTRACT_KINDS
  ? new Set(process.env.MEMO_EXTRACT_KINDS.split(",").map((k) => k.trim().toLowerCase()).filter(Boolean))
  : null;

/** このページ名・種別の文書を索引に載せるか。 */
export function docIndexable(page, kind) {
  if (DOC_EXCLUDE.test(page) || SECRET_NAME.test(path.basename(page))) return false;
  if (EXTRA_EXCLUDE?.test(page)) return false;
  if (KINDS && !KINDS.has(kind) && !KINDS.has(path.extname(page).slice(1).toLowerCase())) return false;
  return true;
}
