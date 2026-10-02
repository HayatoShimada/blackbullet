// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada
// PDF / Office 文書の索引: 拡張子つきのページ名・kind・単位ラベルの見出しパス・FTS・除外ディレクトリ
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createFixture } from "./helpers/fixture.mjs";

const fx = await createFixture("memo-extract-");
process.env.MEMO_EXTRACT_MAX_BYTES = "4096"; // extract.mjs は import 時に読む
process.env.MEMO_EXTRACT_MAX_CHARS = "60";
process.env.MEMO_EMBED = "off"; // embed.mjs は import 時に環境を読むので、動的 import の前に入れる
const { SpaceIndex } = await import("../src/index.mjs");
const { parseSpaces } = await import("../src/space.mjs");
const { searchSpace } = await import("../src/search.mjs");
const { extractDoc, kindOf, docIndexable } = await import("../src/extract.mjs");

after(() => fx.cleanup());

/** PATH 上にコマンドがあるか。pdftotext / unzip は Docker イメージには入っているが、素のホストには無いことがある。 */
async function hasCommand(cmd) {
  for (const dir of (process.env.PATH ?? "").split(path.delimiter).filter(Boolean)) {
    try {
      await fs.access(path.join(dir, cmd), fs.constants.X_OK);
      return true;
    } catch {
      /* 次のディレクトリへ */
    }
  }
  return false;
}
const toolsReady = (await hasCommand("pdftotext")) && (await hasCommand("unzip"));
const maybe = toolsReady ? test : test.skip;

/** 最小の PDF。texts の要素ごとに 1 ページ。xref のオフセットは実際に計算する。 */
function minimalPdf(...texts) {
  const n = texts.length;
  const fontId = 3 + 2 * n;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${texts.map((_, i) => `${3 + 2 * i} 0 R`).join(" ")}] /Count ${n} >>`,
  ];
  texts.forEach((text, i) => {
    const content = `BT /F1 12 Tf 10 50 Td (${text}) Tj ET`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Contents ${4 + 2 * i} 0 R /Resources << /Font << /F1 ${fontId} 0 R >> >> >>`,
      `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`
    );
  });
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  let out = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

// ---- 無圧縮 (stored) の zip を手で組む。zip コマンドに依存せず .docx を作るため ----
const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function storedZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, text] of Object.entries(entries)) {
    const nameBuf = Buffer.from(name, "utf-8");
    const data = Buffer.from(text, "utf-8");
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // utf-8 名前
    local.writeUInt16LE(0, 8); // stored
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, data);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + data.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(entries).length, 8);
  eocd.writeUInt16LE(Object.keys(entries).length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, eocd]);
}

function minimalDocx(text) {
  return storedZip({
    "[Content_Types].xml":
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      "</Types>",
    "word/document.xml":
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
      `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>` +
      "</w:body></w:document>",
  });
}

const PDF = path.join(fx.notes, "Images", "report.pdf");
const DOCX = path.join(fx.notes, "Resources", "memo.docx");
const SKIPPED = path.join(fx.notes, "Templates", "skip.pdf");
for (const [file, data] of [
  [PDF, minimalPdf("hello pdf")],
  [DOCX, minimalDocx("hello docx")],
  [SKIPPED, minimalPdf("template pdf")],
]) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, data);
}

test("kindOf は拡張子で種別を返し、未知の拡張子は null", () => {
  assert.equal(kindOf("Images/report.pdf"), "pdf");
  assert.equal(kindOf("a/B.DOCX"), "docx");
  assert.equal(kindOf("notes.csv"), "text");
  assert.equal(kindOf("page.md"), null);
  assert.equal(kindOf("photo.png"), null);
});

maybe("extractDoc は PDF をページ単位、docx を 1 単位で返す", async () => {
  const pdf = await extractDoc(PDF);
  assert.equal(pdf.length, 1);
  assert.equal(pdf[0].label, "p.1");
  assert.match(pdf[0].text, /hello pdf/);
  const docx = await extractDoc(DOCX);
  assert.equal(docx.length, 1);
  assert.equal(docx[0].text, "hello docx");
  assert.deepEqual(await extractDoc(path.join(fx.notes, "Projects", "Demo.md")), []);
});

maybe("文書は拡張子つきのページ名と kind で索引され、.md は kind md のまま", async () => {
  const spaces = parseSpaces(fx.env.MEMO_SPACES);
  const idx = await new SpaceIndex(spaces, "notes").open();
  await idx.refresh();

  const pdf = idx.rows("select page, kind, title from pages where page = ?", ["Images/report.pdf"]);
  assert.equal(pdf.length, 1);
  assert.equal(pdf[0].kind, "pdf");
  assert.equal(pdf[0].title, "report.pdf");
  const secs = idx.rows("select heading_path, line_start, line_end, text from sections where page = ? order by n", ["Images/report.pdf"]);
  assert.equal(secs[0].heading_path, "report.pdf p.1");
  assert.equal(secs[0].line_start, 0);
  assert.match(secs[0].text, /hello pdf/);

  assert.equal(idx.rows("select kind from pages where page = ?", ["Resources/memo.docx"])[0].kind, "docx");
  assert.ok(idx.rows("select kind from pages where kind = 'md'").length >= 4);
  assert.equal(idx.rows("select kind from pages where page = ?", ["Projects/Demo"])[0].kind, "md");

  const st = idx.stats();
  assert.equal(st.docs, 2);
  assert.ok(st.pages >= 4);
  assert.equal(idx.rows("select 1 x from pages where page like 'Templates/%'").length, 0, "Templates/ の文書は除外");

  const hitPdf = await searchSpace(idx, { query: "hello pdf", mode: "lexical", limit: 5 });
  assert.ok(hitPdf.some((r) => r.page === "Images/report.pdf"), JSON.stringify(hitPdf.map((r) => r.page)));
  const hitDocx = await searchSpace(idx, { query: "hello docx", mode: "lexical", limit: 5 });
  assert.ok(hitDocx.some((r) => r.page === "Resources/memo.docx"), JSON.stringify(hitDocx.map((r) => r.page)));

  const doc = idx.document("Resources/memo.docx");
  assert.equal(doc.kind, "docx");
  assert.match(doc.body, /hello docx/);
  assert.equal(idx.document("Projects/Demo"), null);

  // 2 回目の refresh は mtime が同じなので何も変わらない
  const again = await idx.refresh();
  assert.equal(again.changed, 0);
  assert.equal(again.removed, 0);
});

// ---- xlsx / pptx / txt / csv / 複数ページ / 上限 / 再抽出 ----
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const fx2 = await createFixture("memo-extract2-");
after(() => fx2.cleanup());
const put = async (name, data) => {
  const f = path.join(fx2.notes, name);
  await fs.mkdir(path.dirname(f), { recursive: true });
  await fs.writeFile(f, data);
  return f;
};

maybe("xlsx / pptx / docx 表・改行・数値参照を抽出する", async () => {
  const xlsx = await put(
    "Docs/book.xlsx",
    storedZip({
      "xl/sharedStrings.xml": "<sst><si><t>alpha</t></si><si><t>R&amp;D &#x1F600; &amp;#65; &#99999999;</t></si></sst>",
      "xl/workbook.xml": '<workbook><sheets><sheet name="Q&amp;A" sheetId="1"/></sheets></workbook>',
    })
  );
  const u = await extractDoc(xlsx);
  assert.equal(u[0].label, "文字列");
  assert.match(u[0].text, /alpha\nR&D \u{1F600} &#65; &#99999999;/u);
  assert.equal(u[1].text, "Q&A");

  const pptx = await put(
    "Docs/deck.pptx",
    storedZip({
      "ppt/slides/slide2.xml": "<p><a:p><a:t>second</a:t></a:p></p>",
      "ppt/slides/slide1.xml": "<p><a:p><a:t>first</a:t><a:br/><a:t>line</a:t></a:p></p>",
    })
  );
  const slides = await extractDoc(pptx);
  assert.deepEqual(slides.map((x) => x.label), ["slide.1", "slide.2"]);
  assert.equal(slides[0].text, "first\nline");

  const docx = await put(
    "Docs/table.docx",
    storedZip({
      "word/document.xml": `<w:document ${W}><w:body><w:tbl><w:tr><w:tc><w:p><w:r><w:t>A</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>B</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p><w:r><w:t>x</w:t><w:tab/><w:t>y</w:t><w:br/><w:t>z</w:t></w:r></w:p></w:body></w:document>`,
    })
  );
  const [d] = await extractDoc(docx);
  assert.doesNotMatch(d.text, /AB/);
  assert.match(d.text, /A\s+B/);
  assert.match(d.text, /x\s+y\nz/);
});

maybe("複数ページ PDF はページごとに p.N の節になる", async () => {
  const pdf = await extractDoc(await put("Docs/multi.pdf", minimalPdf("one", "two", "three")));
  assert.deepEqual(pdf.map((x) => x.label), ["p.1", "p.2", "p.3"]);
});

test("txt/csv は読め、MAX_CHARS で切られ、MAX_BYTES 超過は索引しない", async () => {
  const t = await put("Docs/a.txt", "x".repeat(100));
  const [u] = await extractDoc(t);
  assert.equal(u.text.length, 60);
  const csv = await put("Docs/a.csv", "a,b\n1,2\n");
  assert.equal((await extractDoc(csv))[0].text, "a,b\n1,2");
  const big = await put("Docs/big.txt", "y".repeat(5000));
  assert.deepEqual(await extractDoc(big), []);
});

test("docIndexable は雛形・秘密らしい名前を除く", () => {
  assert.equal(docIndexable("Docs/a.txt", "text"), true);
  assert.equal(docIndexable("Images/a.pdf", "pdf"), true);
  assert.equal(docIndexable("Templates/a.pdf", "pdf"), false);
  assert.equal(docIndexable("Library/a.txt", "text"), false);
  assert.equal(docIndexable("Docs/api-token.txt", "text"), false);
  assert.equal(docIndexable("Docs/Passwords.csv", "text"), false);
});

maybe("再抽出・空抽出の mtime スキップ・同名 .md との衝突", async () => {
  const spaces = parseSpaces(fx2.env.MEMO_SPACES);
  const pdf = await put("Docs/live.pdf", minimalPdf("first version"));
  await put("Docs/token.txt", "secret stuff");
  await put("Docs/empty.docx", storedZip({ "word/document.xml": `<w:document ${W}><w:body><w:p/></w:body></w:document>` }));
  await put("Docs/dup.txt", "binary side");
  await put("Docs/dup.txt.md", "# dup\n\n## Sec\n\nmarkdown side\n");
  const idx = await new SpaceIndex(spaces, "notes").open();
  await idx.refresh();
  assert.equal(idx.rows("select 1 x from pages where page = 'Docs/token.txt'").length, 0, "秘密らしい名前は索引しない");
  assert.equal(idx.rows("select 1 x from pages where page = 'Docs/empty.docx'").length, 0, "空抽出は索引に載らない");
  assert.match(idx.document("Docs/live.pdf").body, /Docs\/live\.pdf p\.1|live\.pdf p\.1/);
  assert.equal(idx.document("Docs/dup.txt"), null, "同名 .md が優先され、文書は載らない");
  assert.equal(idx.rows("select kind from pages where page = 'Docs/dup.txt'")[0].kind, "md", "Markdown ページが残る");

  assert.equal((await idx.refresh()).changed, 0, "mtime が同じなら再抽出しない（空抽出も再試行しない）");

  await fs.writeFile(pdf, minimalPdf("second version"));
  const later = new Date(Date.now() + 5000);
  await fs.utimes(pdf, later, later);
  assert.equal((await idx.refresh()).changed, 1);
  assert.match(idx.document("Docs/live.pdf").body, /second version/);
  assert.ok(idx.stats().docs >= 1);
});
