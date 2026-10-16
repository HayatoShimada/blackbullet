// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada
/**
 * 書き出し（/api/export/pdf・/api/export/docx）。アプリが組み立てた 1 ページ分の HTML
 * （画像は data: URL で埋め込み済み）を受け取り、PDF か Word にして返す。
 * スペースも索引も使わない。認証は呼び出し側（http.mjs）で済んでいること。
 *
 * - PDF: ヘッドレス Chromium の --print-to-pdf。ページの HTML から script・meta・base・link・
 *   埋め込み要素を取り除き（meta refresh で file:// の別ファイルへ移られないように）、CSP で
 *   スクリプトと外部の読み込みを止め、名前解決もさせない。Chromium は 1 本ずつ動かし、待ちは 1 件まで
 *   （それ以上は 503）。呼び出し側が切断したら、待ち中なら作らず、作成中なら Chromium を止める。
 *   --blink-settings=scriptEnabled=false は PDF が書かれなくなるので使わない。
 *   Chromium が無ければ 501。MEMO_CHROMIUM で実行ファイルを指定できる。
 * - Word: @turbodocx/html-to-docx。同じく取り除いたうえで、data: 以外の画像も外す
 *   （ライブラリが http(s) の画像を取りに行くので、サイドカーから任意の URL に接続させない）。
 */
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const MAX_BODY = Number(process.env.MEMO_EXPORT_MAX_BODY ?? 48 * 1024 * 1024);
const PDF_TIMEOUT_MS = 90_000;
// 作成中 1 件 + 待ち 1 件。アプリ側の待ち時間（plugs/export/export.ts）はこの 2 件分より長くしてある
const PDF_MAX_PENDING = 2;
const CHROMIUM = process.env.MEMO_CHROMIUM || "chromium";

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}

async function readInput(req) {
  if (Number(req.headers["content-length"]) > MAX_BODY)
    throw new HttpError(413, "ページが大きすぎます（画像込みで 48 MiB まで）");
  const chunks = [];
  let n = 0;
  for await (const c of req) {
    n += c.length;
    if (n > MAX_BODY)
      throw new HttpError(413, "ページが大きすぎます（画像込みで 48 MiB まで）");
    chunks.push(c);
  }
  let body;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "body を JSON として読めません");
  }
  if (typeof body?.html !== "string" || !body.html.trim())
    throw new HttpError(400, "html が必要です");
  const title = typeof body.title === "string" ? body.title : "";
  return { html: body.html, title };
}

// Pi で Chromium を同時に何本も立てないよう、PDF は 1 本ずつ作る
let pdfQueue = Promise.resolve();
let pdfPending = 0;

function runChromium(args, signal) {
  return new Promise((resolve, reject) => {
    execFile(CHROMIUM, args, { timeout: PDF_TIMEOUT_MS, signal }, (err, _out, stderr) => {
      if (err) {
        err.stderr = stderr;
        reject(err);
      } else resolve();
    });
  });
}

// 画像は data: URL、スタイルはインラインだけを許す
const CSP =
  `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:">`;

/**
 * 印刷に要らない「動く」要素を取り除く: script・style 以外の読み込み・移動・埋め込み。
 * meta はすべて落とす（http-equiv=refresh で別の URL へ移れるため）。charset は withCsp が足す。
 */
export function stripActive(html) {
  return html
    .replace(/<(script|iframe|frame|frameset|object|embed|noscript|template)\b[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<\/?(script|meta|base|link|iframe|frame|frameset|object|embed|portal)\b[^>]*>/gi, "");
}

/** 動く要素を取り除き、先頭（<head> があればその直後）に charset と CSP を差し込む。 */
export function withCsp(html) {
  const clean = stripActive(html);
  const meta = `<meta charset="utf-8">${CSP}`;
  const head = clean.match(/<head\b[^>]*>/i);
  if (!head) return meta + clean;
  const at = head.index + head[0].length;
  return clean.slice(0, at) + meta + clean.slice(at);
}

/** data: URL でない <img> を外す（Word 変換で外部へ取りに行かせない）。 */
export function onlyInlineImages(html) {
  return html.replace(/<img\b[^>]*>/gi, (tag) =>
    /\ssrc\s*=\s*["']?\s*data:/i.test(tag) ? tag : "",
  );
}

export async function htmlToPdf(html, signal) {
  if (pdfPending >= PDF_MAX_PENDING)
    throw new HttpError(503, "ほかの PDF を作成中です。少し待ってからもう一度試してください");
  pdfPending++;
  const job = pdfQueue.then(async () => {
    if (signal?.aborted) throw new HttpError(499, "Client went away");
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "memo-export-"));
    try {
      const input = path.join(dir, "page.html");
      const output = path.join(dir, "page.pdf");
      await fs.writeFile(input, withCsp(html));
      await runChromium([
        "--headless",
        "--no-sandbox",
        "--disable-gpu",
        "--disable-dev-shm-usage",
        "--no-first-run",
        "--no-default-browser-check",
        "--host-resolver-rules=MAP * ~NOTFOUND",
        `--user-data-dir=${path.join(dir, "profile")}`,
        "--no-pdf-header-footer",
        `--print-to-pdf=${output}`,
        `file://${input}`,
      ], signal);
      return await fs.readFile(output);
    } catch (e) {
      if (e?.code === "ENOENT" && !e.path?.endsWith("page.pdf"))
        throw new HttpError(
          501,
          "PDF export needs Chromium in the sidecar (rebuild the memo-mcp image)",
        );
      if (e?.code === "ENOENT")
        throw new HttpError(500, "Chromium did not write a PDF");
      throw e;
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
  pdfQueue = job.catch(() => {});
  return job.finally(() => {
    pdfPending--;
  });
}

export async function htmlToDocx(html, title) {
  const { default: HTMLtoDOCX } = await import("@turbodocx/html-to-docx");
  const out = await HTMLtoDOCX(onlyInlineImages(stripActive(html)), null, {
    title,
    creator: "BlackBullet",
    lang: "ja-JP",
    font: "Yu Gothic",
    fontSize: 21, // half-points: 10.5pt
    table: { row: { cantSplit: true } },
  });
  return Buffer.isBuffer(out) ? out : Buffer.from(await out.arrayBuffer());
}

const FORMATS = {
  "/api/export/pdf": {
    type: "application/pdf",
    make: ({ html }, signal) => htmlToPdf(html, signal),
  },
  "/api/export/docx": {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    make: ({ html, title }) => htmlToDocx(html, title),
  },
};

/** /api/export/* を処理する。 */
export async function handleExport(req, res, url) {
  // 呼び出し側が先に諦めたら（タイムアウトなど）、待ち中の PDF は作らず、作成中なら止める
  const gone = new AbortController();
  res.on("close", () => {
    if (!res.writableFinished) gone.abort();
  });
  try {
    const format = FORMATS[url.pathname];
    if (!format) throw new HttpError(404, "Not found");
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      throw new HttpError(405, "POST のみ対応しています");
    }
    const bytes = await format.make(await readInput(req), gone.signal);
    if (gone.signal.aborted) return;
    res.writeHead(200, {
      "Content-Type": format.type,
      "Content-Length": bytes.length,
      "Cache-Control": "no-store",
    });
    res.end(bytes);
  } catch (e) {
    if (gone.signal.aborted) return;
    if (e instanceof HttpError) return sendJson(res, e.status, { error: e.message });
    console.error("[memo-mcp] export failed:", e?.stderr || e);
    sendJson(res, 500, { error: "Export failed" });
  }
}
