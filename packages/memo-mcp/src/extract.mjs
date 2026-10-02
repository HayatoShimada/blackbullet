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
import os from "node:os";
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
  [".odt", "odf"],
  [".ods", "odf"],
  [".odp", "odf"],
  [".html", "html"],
  [".htm", "html"],
  // 旧式のバイナリ形式。読めないが、黙って無視せず status "unsupported" で報告する。
  [".doc", "legacy"],
  [".xls", "legacy"],
  [".ppt", "legacy"],
]);

/** OCR 対象の画像。MEMO_OCR=on のときだけ索引する（呼ぶたびに環境を読む）。 */
const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp", ".tif", ".tiff", ".bmp"]);

/** OCR は任意機能。tesseract が入っていない環境で画像を拾わないよう、明示的に on にしたときだけ使う。 */
export const ocrOn = () => /^(on|1|true|yes)$/i.test(process.env.MEMO_OCR ?? "");
const tesseractCmd = () => process.env.MEMO_TESSERACT || "tesseract";
const ocrLang = () => process.env.MEMO_OCR_LANG || "jpn+eng";
const ocrMaxPages = () => Number(process.env.MEMO_OCR_PAGES ?? 20);
/** これより文字が少ない PDF はテキスト層が無いとみなし、OCR に回す。 */
const OCR_MIN_CHARS = 20;
/** 1 文書の OCR 全体の持ち時間。超えたら読めたページまでで打ち切る。 */
const ocrBudgetMs = () => Number(process.env.MEMO_OCR_BUDGET ?? 120_000);

export function kindOf(file) {
  const ext = path.extname(file).toLowerCase();
  if (IMAGE_EXTS.has(ext)) return ocrOn() ? "image" : null;
  return DOC_KINDS.get(ext) ?? null;
}

// Pi の CPU で長時間ブロックさせない。超えたものは索引を諦める（検索に出ないだけで害はない）。
const TIMEOUT_MS = Number(process.env.MEMO_EXTRACT_TIMEOUT ?? 30_000);
const MAX_BYTES = Number(process.env.MEMO_EXTRACT_MAX_BYTES ?? 8 * 1024 * 1024);
const maxChars = () => Number(process.env.MEMO_EXTRACT_MAX_CHARS ?? 400_000); // 呼ぶたびに読む（テストで切り替えられる）

/** 抽出器の版。抽出の中身を変えたら上げる（索引済みの文書が次回の refresh で再抽出される）。 */
export const EXTRACTOR_VERSION = 5;
/** 版と抽出設定の署名。変わると index.mjs が既知の文書を作り直す。 */
export const EXTRACT_SIGNATURE = `${EXTRACTOR_VERSION}:${TIMEOUT_MS}:${MAX_BYTES}:${maxChars()}:${process.env.MEMO_EXTRACT_KINDS ?? ""}:ocr=${ocrOn() ? 1 : 0}:${process.env.MEMO_OCR_LANG ?? ""}:${process.env.MEMO_OCR_PAGES ?? ""}:${process.env.MEMO_OCR_BUDGET ?? ""}`;

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
  if (e?.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") return false; // 出力が大きすぎるのは文書の性質。再試行しても変わらない
  return e?.killed === true || e?.signal != null || (e?.code === "ENOENT" && String(e?.syscall ?? "").startsWith("spawn")) || e?.code === "EAGAIN" || e?.code === "ENOMEM";
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
    // 上限を超えたメンバーは、読めたところまでを返す（大きなシートでも先頭の行は索引できる）。
    return e?.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" ? String(e.stdout ?? "") : "";
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

/** 画像 1 枚を tesseract に通す。コマンド無しは ENOENT（一時的な失敗として呼び手が扱う）。 */
async function ocrImage(file, timeout = TIMEOUT_MS) {
  const { stdout } = await run(tesseractCmd(), [file, "-", "-l", ocrLang()], {
    timeout,
    maxBuffer: MAX_BYTES,
    encoding: "utf-8",
  });
  return stdout;
}

/** テキスト層の無い PDF をページ画像にして OCR する。ページ数は MEMO_OCR_PAGES で頭打ち。 */
async function ocrPdf(file) {
  // tesseract が無いなら、重いページ画像化の前に ENOENT で諦める。
  await run(tesseractCmd(), ["--version"], { timeout: TIMEOUT_MS });
  const deadline = Date.now() + ocrBudgetMs();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "memo-ocr-"));
  try {
    await run("pdftoppm", ["-r", "200", "-png", "-l", String(ocrMaxPages()), file, path.join(dir, "pg")], { timeout: TIMEOUT_MS });
    const pages = (await fs.readdir(dir)).filter((n) => n.endsWith(".png")).sort((a, b) => Number(/(\d+)\.png$/.exec(a)[1]) - Number(/(\d+)\.png$/.exec(b)[1]));
    const out = [];
    for (const name of pages) {
      const n = Number(/(\d+)\.png$/.exec(name)[1]);
      const left = deadline - Date.now();
      if (left <= 0 && out.length) break; // 持ち時間切れ: 済んだページだけ返す
      try {
        out.push({ label: `p.${n}`, text: (await ocrImage(path.join(dir, name), Math.max(1, Math.min(TIMEOUT_MS, left)))).trim() });
      } catch (e) {
        if (out.length && e?.code !== "ENOENT") break; // 途中のページで時間切れ・失敗: ここまでを残す
        throw e;
      }
    }
    return out;
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function extractImage(file) {
  if ((await fs.stat(file)).size > MAX_BYTES) throw Object.assign(new Error("too large"), { code: "TOO_LARGE" });
  return [{ label: "ocr", text: await ocrImage(file) }];
}

/** pdfinfo の Title / Author。無くても失敗しても本文の抽出には影響させない。 */
async function pdfInfo(file) {
  try {
    const { stdout } = await run("pdfinfo", ["-enc", "UTF-8", file], { timeout: TIMEOUT_MS, maxBuffer: 1024 * 1024, encoding: "utf-8" });
    return infoUnit({ title: /^Title:\s*(.+)$/m.exec(stdout)?.[1], author: /^Author:\s*(.+)$/m.exec(stdout)?.[1] });
  } catch {
    return [];
  }
}

/** タイトル・作成者があれば「文書情報」単位にする。 */
function infoUnit({ title, author }) {
  const lines = [title?.trim() && `title: ${title.trim()}`, author?.trim() && `author: ${author.trim()}`].filter(Boolean);
  return lines.length ? [{ label: "info", text: lines.join("\n") }] : [];
}

/** docProps/core.xml（docx / xlsx / pptx 共通）の dc:title / dc:creator。 */
async function coreInfo(file) {
  const xml = await unzipMember(file, "docProps/core.xml");
  if (!xml) return [];
  const pick = (tag) => {
    const m = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`).exec(xml);
    return m ? decodeEntities(m[1].replace(/<[^>]*>/g, "")) : undefined;
  };
  return infoUnit({ title: pick("dc:title"), author: pick("dc:creator") });
}

async function extractPdf(file) {
  // -layout は表組みの桁を保つ。pdftotext はページ区切りに \f を入れる。
  const { stdout } = await run("pdftotext", ["-layout", "-enc", "UTF-8", file, "-"], {
    timeout: TIMEOUT_MS,
    maxBuffer: MAX_BYTES,
    encoding: "utf-8",
  });
  let pages = stdout.split("\f").map((text, i) => ({ label: `p.${i + 1}`, text: text.trim() }));
  // スキャン PDF（テキスト層なし）。OCR が on のときだけ画像化して読む。
  if (ocrOn() && pages.reduce((n, p) => n + p.text.length, 0) < OCR_MIN_CHARS) pages = await ocrPdf(file);
  return [...(await pdfInfo(file)), ...pages];
}

/** 見出しスタイル Heading1..3（"heading 2" も）の段落ごとに本文を分け、見出しの階層をラベルにする。 */
function docxSections(xml) {
  const heads = [];
  for (const m of xml.matchAll(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g)) {
    const lv = /<w:pStyle\b[^>]*w:val="(?:Heading|heading ?)([1-3])"/.exec(m[0]);
    if (lv) heads.push({ at: m.index, level: Number(lv[1]), title: xmlText(m[0], { breakTags: [] }).replace(/\s+/g, " ") });
  }
  const cut = (a, b) => xmlText(xml.slice(a, b), { breakTags: ["w:p", "w:tr"] });
  if (!heads.length) return [{ label: null, text: cut(0, xml.length) }];
  const out = [{ label: null, text: cut(0, heads[0].at) }];
  const stack = [];
  heads.forEach((h, i) => {
    stack.length = Math.min(stack.length, h.level - 1);
    stack[h.level - 1] = h.title;
    const label = stack.filter(Boolean).join(" > ");
    out.push({ label: label || null, text: cut(h.at, heads[i + 1]?.at ?? xml.length) });
  });
  return out;
}

async function extractDocx(file) {
  const xml = await unzipMember(file, "word/document.xml");
  if (!xml) return [];
  // w:p が段落、w:tr が表の行。w:br / w:tab / セル境界は xmlText が改行・空白にする。
  const out = [...(await coreInfo(file)), ...docxSections(xml)];
  // 注釈・コメント・ヘッダ/フッタ。定義や但し書きが入っていることが多い。
  const names = await unzipList(file);
  const part = async (label, members) => {
    const seen = new Set();
    for (const n of members) {
      for (const line of xmlText(await unzipMember(file, n), { breakTags: ["w:p"] }).split("\n")) if (line.trim()) seen.add(line.trim());
    }
    if (seen.size) out.push({ label, text: [...seen].join("\n") });
  };
  const named = (re) => names.filter((n) => re.test(n)).sort();
  await part("footnotes", named(/^word\/footnotes\.xml$/));
  await part("endnotes", named(/^word\/endnotes\.xml$/));
  await part("comments", named(/^word\/comments\.xml$/));
  await part("header", named(/^word\/header\d*\.xml$/));
  await part("footer", named(/^word\/footer\d*\.xml$/));
  return out;
}

/** 列記号（"AB2" の "AB"）。 */
const colOf = (ref) => /^[A-Z]+/i.exec(ref ?? "")?.[0].toUpperCase() ?? "";
/** 表を何行ずつ 1 単位にするか。ヒットが行に絞れる程度に細かく、単位数が膨らまない程度に粗く。 */
const ROWS_PER_UNIT = 20;

/**
 * 行（[行番号, セル配列[{col, text}]]）を「見出し: 値 | …」の行にして、ROWS_PER_UNIT 行ごとの単位にする。
 * 最初の空でない行を見出しとみなす。単位ラベルは "Sheet1 r12" / "Sheet1 r2-21"。
 */
function rowUnits(prefix, rows) {
  const out = [];
  let header = null;
  let lines = [];
  let first = 0;
  let last = 0;
  const flush = () => {
    if (!lines.length) return;
    out.push({ label: `${prefix}r${first}${last > first ? `-${last}` : ""}`, text: lines.join("\n") });
    lines = [];
  };
  for (const [n, cells] of rows) {
    const filled = cells.filter((c) => c.text !== "");
    if (!filled.length) continue;
    let body;
    if (!header) {
      header = new Map(filled.map((c) => [c.col, c.text]));
      body = filled.map((c) => c.text).join(" | ");
    } else {
      body = filled.map((c) => `${header.get(c.col) ?? c.col}: ${c.text}`).join(" | ");
    }
    if (!lines.length) first = n;
    last = n;
    lines.push(`r${n}: ${body}`);
    if (lines.length >= ROWS_PER_UNIT) flush();
  }
  flush();
  return out;
}

async function extractXlsx(file) {
  const out = await coreInfo(file);
  const wb = await unzipMember(file, "xl/workbook.xml");
  const shared = [...(await unzipMember(file, "xl/sharedStrings.xml")).matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) =>
    xmlText(m[1].replace(/<rPh\b[\s\S]*?<\/rPh>/g, ""), { breakTags: [] })
  );
  const rels = new Map(
    [...(await unzipMember(file, "xl/_rels/workbook.xml.rels")).matchAll(/<Relationship\b([^>]*)>/g)].map((m) => [
      /\bId="([^"]*)"/.exec(m[1])?.[1],
      /\bTarget="([^"]*)"/.exec(m[1])?.[1],
    ])
  );
  const sheets = [...wb.matchAll(/<sheet\b([^>]*)>/g)].map((m, i) => {
    const target = rels.get(/\br:id="([^"]*)"/.exec(m[1])?.[1]);
    const part = target ? (target.startsWith("/") ? target.slice(1) : `xl/${target}`) : `xl/worksheets/sheet${i + 1}.xml`;
    return { name: decodeEntities(/\bname="([^"]*)"/.exec(m[1])?.[1] ?? `Sheet${i + 1}`), part };
  });
  for (const sh of sheets) {
    const xml = await unzipMember(file, sh.part);
    const rows = [];
    for (const rm of xml.matchAll(/<row\b((?:[^>"/]|"[^"]*")*)>([\s\S]*?)<\/row>/g)) {
      const n = Number(/\br="(\d+)"/.exec(rm[1])?.[1] ?? rows.length + 1);
      const cells = [];
      for (const cm of rm[2].matchAll(/<c\b((?:[^>"/]|"[^"]*")*)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const type = /\bt="([^"]*)"/.exec(cm[1])?.[1];
        const ref = /\br="([^"]*)"/.exec(cm[1])?.[1];
        const body = cm[2] ?? "";
        const v = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body)?.[1];
        let text = "";
        if (type === "s") text = shared[Number(v)] ?? "";
        else if (type === "inlineStr") text = xmlText(body, { breakTags: [] });
        else if (type === "b") text = v === "1" ? "TRUE" : "FALSE";
        else if (v !== undefined) text = decodeEntities(v).trim(); // 数値・数式の結果文字列(str)・エラー
        cells.push({ col: colOf(ref) || String(cells.length), text: text.replace(/\s+/g, " ").trim() });
      }
      rows.push([n, cells]);
    }
    out.push(...rowUnits(`${sh.name} `, rows));
  }
  if (!out.some((u) => u.label !== "info")) {
    // 想定外の構成（シートの実体が読めない）: 文字列だけでも拾う
    const text = shared.join("\n");
    if (text) out.push({ label: "文字列", text });
  }
  return out;
}

async function extractPptx(file) {
  const names = await unzipList(file);
  const slides = names
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => {
      const n = (s) => Number(/slide(\d+)\.xml$/.exec(s)[1]);
      return n(a) - n(b);
    });
  const out = await coreInfo(file);
  for (const s of slides) {
    const xml = await unzipMember(file, s);
    if (!xml) continue;
    // a:p が段落。スライド番号は本文より当てになるので見出しに使う。
    let text = xmlText(xml, { breakTags: ["a:p"] });
    const n = /slide(\d+)\.xml$/.exec(s)[1];
    // スピーカーノート。スライドの rels が指すノートを優先し、無ければ同番号を見る。
    const rels = await unzipMember(file, `ppt/slides/_rels/slide${n}.xml.rels`);
    const target = /Target="[^"]*?(notesSlides\/notesSlide\d+\.xml)"/.exec(rels)?.[1] ?? `notesSlides/notesSlide${n}.xml`;
    if (names.includes(`ppt/${target}`)) {
      const nx = (await unzipMember(file, `ppt/${target}`)).replace(/<a:fld\b[^>]*type="slidenum"[^>]*>[\s\S]*?<\/a:fld>/g, "");
      const notes = xmlText(nx, { breakTags: ["a:p"] });
      if (notes) text = `${text}\n\nnotes: ${notes}`.trim();
    }
    if (text) out.push({ label: `slide.${n}`, text });
  }
  return out;
}

/** ODF (content.xml) の断片をテキストにする。段落・見出し・表の行は改行、セル・タブ・空白は半角空白。 */
function odfText(xml) {
  const s = xml
    .replace(/<\/table:table-cell>|<\/table:covered-table-cell>/g, " ")
    .replace(/<text:(?:tab|s)\b[^>]*\/>/g, " ")
    .replace(/<text:line-break\b[^>]*\/>/g, "\n");
  return xmlText(s, { breakTags: ["text:p", "text:h", "table:table-row"] });
}

/** meta.xml の dc:title / dc:creator（ODF の文書情報）。 */
async function odfInfo(file) {
  const xml = await unzipMember(file, "meta.xml");
  if (!xml) return [];
  const pick = (tag) => {
    const m = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`).exec(xml);
    return m ? decodeEntities(m[1].replace(/<[^>]*>/g, "")) : undefined;
  };
  return infoUnit({ title: pick("dc:title"), author: pick("dc:creator") });
}

/** .odt は 1 単位、.odp は draw:page ごと（slide.N）、.ods は table:table ごと（シート名）。 */
async function extractOdf(file) {
  const xml = await unzipMember(file, "content.xml");
  if (!xml) return [];
  const out = await odfInfo(file);
  const ext = path.extname(file).toLowerCase();
  const split = (re, label) => {
    const parts = [...xml.matchAll(re)];
    parts.forEach((m, i) => {
      const text = odfText(xml.slice(m.index, parts[i + 1]?.index ?? xml.length));
      if (text) out.push({ label: label(m, i), text });
    });
  };
  if (ext === ".odp") split(/<draw:page\b/g, (_, i) => `slide.${i + 1}`);
  else if (ext === ".ods") {
    split(/<table:table(?=[\s>])[^>]*>/g, (m, i) => decodeEntities(/\btable:name="([^"]*)"/.exec(m[0])?.[1] ?? `Sheet${i + 1}`));
  } else out.push({ label: null, text: odfText(xml) });
  return out;
}

/** HTML をテキストにする。script / style / コメントは捨て、ブロック要素は改行にする。<title> は文書情報。 */
async function extractHtml(file) {
  if ((await fs.stat(file)).size > MAX_BYTES) throw Object.assign(new Error("too large"), { code: "TOO_LARGE" });
  const buf = await fs.readFile(file);
  let raw = buf.toString("utf-8");
  // <meta charset> が UTF-8 以外（Shift_JIS / EUC-JP など）ならその文字コードで読み直す
  const cs = /<meta[^>]*charset\s*=\s*["']?\s*([\w-]+)/i.exec(buf.subarray(0, 4096).toString("latin1"))?.[1];
  if (cs && !/^utf-?8$/i.test(cs)) {
    try {
      raw = new TextDecoder(cs).decode(buf);
    } catch {
      /* 未知の文字コードは UTF-8 のまま */
    }
  }
  const title = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(raw)?.[1];
  const body = raw
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|head)\b[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<\/?(?:p|div|br|li|ul|ol|tr|table|h[1-6]|section|article|header|footer|pre|blockquote)\b[^>]*>/gi, "\n")
    .replace(/<\/t[dh]\s*>/gi, " ")
    .replace(/<[^>]*>/g, "");
  const text = decodeEntities(body.replace(/&nbsp;/gi, " "))
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return [...infoUnit({ title: title && decodeEntities(title.replace(/\s+/g, " ")) }), { label: null, text }];
}

/** 旧式バイナリ（.doc / .xls / .ppt）。抽出器が無いので status "unsupported" にする。 */
async function extractLegacy() {
  throw Object.assign(new Error("unsupported legacy format"), { code: "UNSUPPORTED" });
}

/** RFC 4180 の CSV を行の配列にする（引用符・"" ・引用内の改行）。 */
function parseCsv(src) {
  const rows = [];
  let row = [];
  let cell = "";
  let q = false;
  const s = src.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') {
        if (s[i + 1] === '"') (cell += '"'), i++;
        else q = false;
      } else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") (row.push(cell), (cell = ""));
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length) (row.push(cell), rows.push(row));
  return rows;
}

async function extractPlain(file) {
  // 巨大なログや CSV をメモリに載せない。上限を超えたものは索引しない（抽出器の maxBuffer 超過と同じ扱い）。
  if ((await fs.stat(file)).size > MAX_BYTES) throw Object.assign(new Error("too large"), { code: "TOO_LARGE" });
  const text = (await fs.readFile(file)).toString("utf-8");
  if (path.extname(file).toLowerCase() === ".csv") {
    // 1 行目を見出しにして、行を「見出し: 値」に直す。引用符つきの CSV でも列が揃う。
    const units = rowUnits("", parseCsv(text).map((cells, i) => [i + 1, cells.map((t, c) => ({ col: String(c), text: t.replace(/\s+/g, " ").trim() }))]));
    if (units.length) return units;
  }
  return [{ label: null, text }];
}

const EXTRACTORS = {
  pdf: extractPdf,
  docx: extractDocx,
  xlsx: extractXlsx,
  pptx: extractPptx,
  text: extractPlain,
  odf: extractOdf,
  html: extractHtml,
  legacy: extractLegacy,
  image: extractImage,
};

/** 抽出失敗の理由。"timeout" / "tool_missing" は一時的（再試行）、残りは変わるまで再試行しない。 */
function failureStatus(e) {
  if (e?.code === "UNSUPPORTED") return "unsupported";
  if (e?.code === "TOO_LARGE" || e?.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") return "too_large";
  if (e?.code === "ENOENT" && String(e?.syscall ?? "").startsWith("spawn")) return "tool_missing"; // 文書自体の消失は error
  if (e?.killed === true || e?.signal != null) return "timeout";
  if (isTransient(e)) return "timeout";
  return "error";
}

/**
 * extractDoc の詳細版。{ units, status } を返す。
 * status: ok / empty（テキスト無し）/ too_large / error（壊れ・暗号化など）/ timeout / tool_missing。
 * timeout と tool_missing は一時的で units は null。
 */
export async function extractDocStatus(file, kind = kindOf(file)) {
  const fn = EXTRACTORS[kind];
  if (!fn) return { units: [], status: "empty" };
  let units;
  try {
    units = await fn(file);
  } catch (e) {
    const status = failureStatus(e); // 抽出の失敗で索引全体を止めない
    return { units: isTransient(e) ? null : [], status };
  }
  // 題名・作成者だけの文書（スキャン PDF、本文の無い Office 文書）は「本文なし」として扱う。
  if (!units.some((u) => u.label !== "info" && (u.text ?? "").trim())) units = [];
  const MAX_CHARS = maxChars();
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
  return { units: out, status: out.length ? "ok" : "empty" };
}

/**
 * 文書からテキスト単位の配列を返す。
 * テキストが無い場合は空配列（画像だけの PDF、壊れたファイル、出力が上限超過など。変わるまで再試行しない）。
 * 一時的な失敗（時間切れ・コマンド無し）は null。呼び手は結果を覚えず、後で再試行する。
 */
export async function extractDoc(file, kind = kindOf(file)) {
  return (await extractDocStatus(file, kind)).units;
}

// 文書として索引しない: 雛形とプラグの置き場、ゴミ箱、および秘密の置き場に見える名前（token.txt / passwords.csv など）。
const DOC_EXCLUDE = /^(Templates|Library|Trash)(\/|$)/;
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
