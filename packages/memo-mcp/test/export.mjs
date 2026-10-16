// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada
// 書き出し（/api/export/*）の検証。PDF は Chromium があるときだけ中身まで見る（無ければ 501 を確かめる）。
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import { createFixture } from "./helpers/fixture.mjs";
import { onlyInlineImages, withCsp } from "../src/export.mjs";

const TOKEN = "export-test-token";
const PORT = 3046;
const fx = await createFixture("memo-export-");
const haveChromium = (() => {
  try {
    execFileSync(process.env.MEMO_CHROMIUM || "chromium", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

// 1x1 の PNG
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const HTML = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<h1>書き出し</h1><p>日本語の<strong>本文</strong>です。</p>
<table><tr><th>名前</th><th>数</th></tr><tr><td>りんご</td><td>3</td></tr></table>
<p><img src="${PNG}" alt="dot"></p></body></html>`;

let proc;
before(async () => {
  await fs.mkdir(path.join(fx.tmp, "idx-export"), { recursive: true });
  proc = spawn("node", ["src/http.mjs"], {
    cwd: new URL("..", import.meta.url).pathname,
    env: {
      ...process.env,
      MEMO_MCP_TOKEN: TOKEN,
      MEMO_MCP_PORT: String(PORT),
      MEMO_SPACES: fx.spacesEnv,
      MEMO_EMBED: "off",
      MEMO_INDEX_DIR: path.join(fx.tmp, "idx-export"),
    },
    stdio: "ignore",
  });
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${PORT}/healthz`)).ok) return;
    } catch { /* まだ */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("サーバーが起動しない");
});
after(async () => {
  proc?.kill();
  await fx.cleanup?.();
});

const post = (format, body, token = TOKEN) =>
  fetch(`http://127.0.0.1:${PORT}/api/export/${format}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

test("Word: a .docx (a zip with the document part) comes back", async () => {
  const r = await post("docx", { title: "書き出し", html: HTML });
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type"), /wordprocessingml/);
  const bytes = Buffer.from(await r.arrayBuffer());
  assert.equal(bytes.subarray(0, 2).toString(), "PK");
  assert.ok(bytes.includes(Buffer.from("word/document.xml")));
});

test("PDF: a PDF when Chromium is there, 501 when it is not", { timeout: 120_000 }, async () => {
  const r = await post("pdf", { title: "書き出し", html: HTML });
  if (!haveChromium) {
    assert.equal(r.status, 501);
    return;
  }
  assert.equal(r.status, 200);
  const bytes = Buffer.from(await r.arrayBuffer());
  assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
});

test("PDF: the page's own scripts do not run", { timeout: 120_000, skip: !haveChromium }, async () => {
  const html = `<html><head></head><body><p id="t">本文のまま</p><script>document.getElementById("t").textContent = "SCRIPT RAN"</script></body></html>`;
  const r = await post("pdf", { title: "t", html });
  assert.equal(r.status, 200);
  const pdf = path.join(fx.tmp, "script.pdf");
  await fs.writeFile(pdf, Buffer.from(await r.arrayBuffer()));
  let text;
  try {
    text = execFileSync("pdftotext", [pdf, "-"], { encoding: "utf8" });
  } catch {
    return; // pdftotext が無い環境では中身までは見ない
  }
  assert.match(text, /本文のまま/);
  assert.doesNotMatch(text, /SCRIPT RAN/);
});

test("the token, the method and the body are checked", async () => {
  assert.equal((await post("docx", { html: HTML }, "wrong")).status, 401);
  assert.equal((await fetch(`http://127.0.0.1:${PORT}/api/export/docx`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  })).status, 405);
  assert.equal((await post("docx", "{broken")).status, 400);
  assert.equal((await post("docx", { html: " " })).status, 400);
  assert.equal((await post("rtf", { html: HTML })).status, 404);
});

// 幅 w・高さ h の白い PNG（data: URL）
function bigPng(w, h) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // grayscale
  const raw = Buffer.alloc((w + 1) * h, 0xff);
  for (let y = 0; y < h; y++) raw[y * (w + 1)] = 0;
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  return `data:image/png;base64,${png.toString("base64")}`;
}

test("print HTML loses meta refresh, base, links and embeds, and gets charset + CSP", () => {
  const out = withCsp(
    `<html><head><meta http-equiv="refresh" content="0;url=file:///proc/self/environ"></head><body><p>x</p>` +
      `<META HTTP-EQUIV=refresh content="0;url=file:///etc/passwd"><base href="file:///"><link rel=stylesheet href="file:///x">` +
      `<iframe src="file:///etc/passwd"></iframe><embed src="file:///x"><script>1</script></body></html>`,
  );
  assert.doesNotMatch(out, /refresh|<base|<link|<iframe|<embed|<script/i);
  assert.match(out, /<head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy"/);
  assert.match(out, /<p>x<\/p>/);
});

test("Word conversion only keeps embedded (data:) images", () => {
  const out = onlyInlineImages(`<img src="http://127.0.0.1:3002/x.png"><img alt=a src='data:image/png;base64,AA=='><IMG SRC=https://e/x>`);
  assert.equal(out, `<img alt=a src='data:image/png;base64,AA=='>`);
});

test("Word: a wide photo is fitted to the page width", async () => {
  const html = `<html><body><p><img src="${bigPng(4000, 1000)}"></p></body></html>`;
  const r = await post("docx", { title: "wide", html });
  assert.equal(r.status, 200);
  const dir = path.join(fx.tmp, "wide");
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, "wide.docx");
  await fs.writeFile(file, Buffer.from(await r.arrayBuffer()));
  let xml;
  try {
    xml = execFileSync("unzip", ["-p", file, "word/document.xml"], { encoding: "utf8" });
  } catch {
    return; // unzip が無い環境では寸法までは見ない
  }
  const cx = Number(xml.match(/<wp:extent cx="(\d+)"/)?.[1]);
  // A4 縦・余白 1 インチの本文幅 ≒ 6.27 インチ（914400 EMU/インチ）
  assert.ok(cx > 0 && cx <= 6.3 * 914400, `image width ${cx} EMU is wider than the page`);
});

test("PDF: a meta refresh in the page cannot print another file", { timeout: 120_000, skip: !haveChromium }, async () => {
  const html = `<html><head></head><body><p>本文のまま</p><meta http-equiv="refresh" content="0;url=file:///proc/self/environ"></body></html>`;
  const r = await post("pdf", { title: "t", html });
  assert.equal(r.status, 200);
  const pdf = path.join(fx.tmp, "refresh.pdf");
  await fs.writeFile(pdf, Buffer.from(await r.arrayBuffer()));
  let text;
  try {
    text = execFileSync("pdftotext", [pdf, "-"], { encoding: "utf8" });
  } catch {
    return;
  }
  assert.match(text, /本文のまま/);
  assert.doesNotMatch(text, new RegExp(TOKEN));
});
