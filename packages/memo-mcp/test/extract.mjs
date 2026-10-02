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
  // シート構成が読めない（想定外の）ブックでは、文字列だけを 1 単位で返す
  const u = await extractDoc(xlsx);
  assert.equal(u[0].label, "文字列");
  assert.match(u[0].text, /alpha\nR&D \u{1F600} &#65; &#99999999;/u);

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
  assert.equal((await extractDoc(csv))[0].text, "r1: a | b\nr2: a: 1 | b: 2");
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

test("文書の取り込み状況: ok / empty / too_large が記録され、stats と docList に出る", async () => {
  const { extractDocStatus, EXTRACT_SIGNATURE } = await import("../src/extract.mjs");
  assert.ok(EXTRACT_SIGNATURE.length > 0);
  const spaces = parseSpaces(fx2.env.MEMO_SPACES);
  await put("St/ok.txt", "readable text");
  await put("St/empty.txt", "   ");
  await put("St/big.txt", "z".repeat(5000));
  assert.equal((await extractDocStatus(path.join(fx2.notes, "St/big.txt"))).status, "too_large");
  assert.equal((await extractDocStatus(path.join(fx2.notes, "St/empty.txt"))).status, "empty");
  assert.equal((await extractDocStatus(path.join(fx2.notes, "St/ok.txt"))).status, "ok");

  const idx = await new SpaceIndex(spaces, "notes").open();
  await idx.refresh();
  const by = Object.fromEntries(idx.docList().map((d) => [d.page, d.status]));
  assert.equal(by["St/ok.txt"], "ok");
  assert.equal(by["St/empty.txt"], "empty");
  assert.equal(by["St/big.txt"], "too_large");
  const st = idx.stats();
  assert.equal(st.docs_pending, 0);
  assert.ok(st.docs_unreadable >= 2);
  assert.ok(st.unreadable.some((u) => u.page === "St/big.txt" && u.status === "too_large"));
  assert.ok(idx.docList("too_large").some((d) => d.page === "St/big.txt"));
  assert.ok(idx.docList("too_large").every((d) => d.status === "too_large"));
});

test("reindex は mtime が同じでも再抽出し、page 指定は 1 件だけ、消えた文書は状況から消える", async () => {
  const spaces = parseSpaces(fx2.env.MEMO_SPACES);
  const f = await put("Re/a.txt", "alpha original");
  const g = await put("Re/b.txt", "beta original");
  const idx = await new SpaceIndex(spaces, "notes").open();
  await idx.refresh();
  const old = new Date(Date.now() - 60_000);
  for (const x of [f, g]) {
    await fs.writeFile(x, (await fs.readFile(x, "utf-8")).replace("original", "changed"));
    await fs.utimes(x, old, old);
  }
  await idx.refresh(); // 戻した mtime は索引時と違うので一度取り込ませ、次に同じ mtime のまま中身だけ変える
  for (const x of [f, g]) await fs.writeFile(x, (await fs.readFile(x, "utf-8")).replace("changed", "rebuilt"));
  for (const x of [f, g]) await fs.utimes(x, old, old);
  assert.equal((await idx.refresh()).changed, 0);
  assert.match(idx.document("Re/a.txt").body, /changed/);
  const r = await idx.reindex("Re/a.txt");
  assert.equal(r.changed, 1);
  assert.match(idx.document("Re/a.txt").body, /rebuilt/);
  assert.match(idx.document("Re/b.txt").body, /changed/, "page 指定なら他は触らない");
  await idx.reindex();
  assert.match(idx.document("Re/b.txt").body, /rebuilt/);
  await fs.rm(f);
  await idx.refresh();
  assert.ok(!idx.docList().some((d) => d.page === "Re/a.txt"));
});

test("一時的な失敗は再試行待ちから reindex で即やり直せる", async () => {
  const spaces = parseSpaces(fx2.env.MEMO_SPACES);
  await put("Tr/a.txt", "retry me");
  const idx = await new SpaceIndex(spaces, "notes").open();
  idx.retryAfter.set("Tr/a.txt", Date.now() + 3_600_000);
  idx.docStatus.set("Tr/a.txt", { status: "tool_missing" });
  await idx.refresh();
  assert.equal(idx.rows("select 1 x from pages where page = 'Tr/a.txt'").length, 0, "待機中は触らない");
  await idx.reindex("Tr/a.txt");
  assert.match(idx.document("Tr/a.txt").body, /retry me/);
  assert.equal(idx.docStatus.get("Tr/a.txt").status, "ok");
});

test("予算切れの未処理は pending、削除・改名されたら状況も消える。索引済みの文書は pending にしない", async () => {
  const spaces = parseSpaces(fx2.env.MEMO_SPACES);
  const f = await put("Pd/a.txt", "pending doc");
  const idx = await new SpaceIndex(spaces, "notes").open();
  process.env.MEMO_EXTRACT_BUDGET = "-1";
  try {
    await idx.refresh();
    assert.equal(idx.docStatus.get("Pd/a.txt").status, "pending");
    await fs.rm(f);
    await idx.refresh();
    assert.ok(!idx.docStatus.has("Pd/a.txt"), "消えた pending は残さない");
    delete process.env.MEMO_EXTRACT_BUDGET;
    await put("Pd/b.txt", "indexed doc");
    await idx.refresh();
    assert.equal(idx.docStatus.get("Pd/b.txt").status, "ok");
    idx.known.set("Pd/b.txt", "stale-signature"); // 署名が変わった状態
    process.env.MEMO_EXTRACT_BUDGET = "-1";
    await idx.refresh();
    assert.equal(idx.docStatus.get("Pd/b.txt").status, "ok", "検索できる文書は pending に落とさない");
  } finally {
    delete process.env.MEMO_EXTRACT_BUDGET;
  }
  idx.docStatus.set("Pd/gone.pdf", { status: "tool_missing" });
  idx.retryAfter.set("Pd/gone.pdf", Date.now() + 1e6);
  await idx.refresh();
  assert.ok(!idx.docStatus.has("Pd/gone.pdf") && !idx.retryAfter.has("Pd/gone.pdf"));
});

test("署名が変わった文書は再抽出される。reindex は未知のページに not_found を返し、.md は読み直さない", async () => {
  const spaces = parseSpaces(fx2.env.MEMO_SPACES);
  const f = await put("Sg/a.txt", "sig original");
  const idx = await new SpaceIndex(spaces, "notes").open();
  await idx.refresh();
  const st = await fs.stat(f);
  await fs.writeFile(f, "sig changed");
  await fs.utimes(f, st.atime, st.mtime); // mtime はそのまま
  idx.known.set("Sg/a.txt", `${st.mtimeMs}:old-signature`);
  assert.equal((await idx.refresh()).changed, 1);
  assert.match(idx.document("Sg/a.txt").body, /sig changed/);
  const r = await idx.reindex("Nope/x.pdf");
  assert.equal(r.warning, "not_found");
  assert.equal((await idx.reindex()).changed >= 1, true);
});

test("抽出の失敗理由: コマンド無しは tool_missing、文書の消失は error、壊れた zip は取れない", async () => {
  const { extractDocStatus } = await import("../src/extract.mjs");
  const gone = await extractDocStatus(path.join(fx2.notes, "Fl/missing.txt"));
  assert.equal(gone.status, "error");
  await put("Fl/bad.docx", "not a zip");
  const bad = await extractDocStatus(path.join(fx2.notes, "Fl/bad.docx"));
  assert.ok(["error", "empty"].includes(bad.status), bad.status);
  const saved = process.env.PATH;
  process.env.PATH = "/nonexistent";
  try {
    assert.equal((await extractDocStatus(path.join(fx2.notes, "Fl/bad.docx"))).status, "tool_missing");
  } finally {
    process.env.PATH = saved;
  }
});

/** 上の MAX_CHARS=60 は切り詰めの試験用。構造の試験では外す。 */
function maybeWide(name, fn) {
  maybe(name, async (t) => {
    const prev = process.env.MEMO_EXTRACT_MAX_CHARS;
    process.env.MEMO_EXTRACT_MAX_CHARS = "400000";
    try {
      await fn(t);
    } finally {
      process.env.MEMO_EXTRACT_MAX_CHARS = prev;
    }
  });
}
// ---- xlsx の行構造 / csv / pptx ノート / docx 見出し・注釈 / 文書情報 / OCR ----
const CORE = (title, creator) =>
  `<cp:coreProperties xmlns:cp="x" xmlns:dc="y"><dc:title>${title}</dc:title><dc:creator>${creator}</dc:creator></cp:coreProperties>`;

maybeWide("xlsx はシートごと・行ごとに「見出し: 値」で数値も含め、単位ラベルは Sheet1 r12", async () => {
  const rowsXml = Array.from({ length: 25 }, (_, i) => {
    const r = i + 2;
    return `<row r="${r}"><c r="A${r}" t="s"><v>${1 + (i % 2)}</v></c><c r="B${r}"><v>${r * 100}</v></c><c r="C${r}" t="inlineStr"><is><t>memo${r}</t></is></c><c r="D${r}"/></row>`;
  }).join("");
  const f = await put(
    "Docs/sales.xlsx",
    storedZip({
      "docProps/core.xml": CORE("Q3 sales", "Hanako"),
      "xl/workbook.xml": '<workbook><sheets><sheet name="Sales" sheetId="1" r:id="rId7"/><sheet name="Empty" sheetId="2" r:id="rId8"/></sheets></workbook>',
      "xl/_rels/workbook.xml.rels": '<Relationships><Relationship Id="rId7" Target="worksheets/sheet1.xml"/><Relationship Id="rId8" Target="worksheets/sheet2.xml"/></Relationships>',
      "xl/sharedStrings.xml": "<sst><si><t>Region</t></si><si><t>East</t></si><si><t>West</t></si></sst>",
      "xl/worksheets/sheet1.xml": `<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="inlineStr"><is><t>Revenue</t></is></c><c r="C1" t="inlineStr"><is><t>Note</t></is></c></row>${rowsXml}<row r="40"/></sheetData></worksheet>`,
      "xl/worksheets/sheet2.xml": "<worksheet><sheetData/></worksheet>",
    })
  );
  const u = await extractDoc(f);
  assert.equal(u[0].label, "info");
  assert.match(u[0].text, /title: Q3 sales\nauthor: Hanako/);
  assert.deepEqual(u.slice(1).map((x) => x.label), ["Sales r1-20", "Sales r21-26"].slice(0, u.length - 1), JSON.stringify(u.map((x) => x.label)));
  const all = u.map((x) => x.text).join("\n");
  assert.match(all, /r12: Region: East \| Revenue: 1200 \| Note: memo12/);
  assert.match(all, /r1: Region \| Revenue \| Note/);
});

maybeWide("csv は 1 行目を見出しに、行を「見出し: 値」でまとめ、引用符・空セルを扱う", async () => {
  const lines = ['name,amount,"note, long"'];
  for (let i = 0; i < 45; i++) lines.push(`item${i},${i * 10},"line ""q""${i}"`);
  lines.push("last,,");
  const u = await extractDoc(await put("Docs/big.csv", `﻿${lines.join("\r\n")}\r\n`));
  assert.deepEqual(u.map((x) => x.label), ["r1-20", "r21-40", "r41-47"]);
  assert.match(u[0].text, /r1: name \| amount \| note, long/);
  assert.match(u[0].text, /r3: name: item1 \| amount: 10 \| note, long: line "q"1/);
  assert.match(u[2].text, /r47: name: last$/);
  // 見出しだけ・空の CSV は従来どおり素のテキスト（空なら単位なし）
  assert.deepEqual((await extractDoc(await put("Docs/empty.csv", ""))).length, 0);
});

maybeWide("pptx はスピーカーノートをスライドの単位に足し、docProps の題名を拾う", async () => {
  const f = await put(
    "Docs/talk.pptx",
    storedZip({
      "docProps/core.xml": CORE("Keynote", "Taro"),
      "ppt/slides/slide1.xml": "<p><a:p><a:t>bullet</a:t></a:p></p>",
      "ppt/slides/_rels/slide1.xml.rels": '<Relationships><Relationship Id="r1" Target="../notesSlides/notesSlide4.xml"/></Relationships>',
      "ppt/notesSlides/notesSlide4.xml": '<p><a:p><a:t>explain deeply</a:t></a:p><a:p><a:fld id="x" type="slidenum"><a:t>1</a:t></a:fld></a:p></p>',
      "ppt/slides/slide2.xml": "<p><a:p><a:t>plain</a:t></a:p></p>",
    })
  );
  const u = await extractDoc(f);
  assert.deepEqual(u.map((x) => x.label), ["info", "slide.1", "slide.2"]);
  assert.equal(u[0].text, "title: Keynote\nauthor: Taro");
  assert.equal(u[1].text, "bullet\n\nnotes: explain deeply");
  assert.equal(u[2].text, "plain");
});

maybeWide("docx は見出しごとの単位、脚注・コメント・ヘッダ/フッタ、題名を返す", async () => {
  const p = (t, style) => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ""}<w:r><w:t>${t}</w:t></w:r></w:p>`;
  const f = await put(
    "Docs/report.docx",
    storedZip({
      "docProps/core.xml": CORE("Annual report", "Jiro"),
      "word/document.xml": `<w:document ${W}><w:body>${p("preface")}${p("Pricing", "Heading1")}${p("price body")}${p("Tiers", "Heading2")}${p("tier body")}${p("Next", "Heading1")}${p("next body")}</w:body></w:document>`,
      "word/footnotes.xml": `<w:footnotes ${W}><w:footnote w:id="0"/>${p("defined term")}</w:footnotes>`,
      "word/comments.xml": `<w:comments ${W}>${p("check this")}</w:comments>`,
      "word/header1.xml": `<w:hdr ${W}>${p("CONFIDENTIAL")}</w:hdr>`,
      "word/footer1.xml": `<w:ftr ${W}>${p("Acme Corp")}</w:ftr>`,
    })
  );
  const u = await extractDoc(f);
  assert.deepEqual(u.map((x) => x.label), ["info", null, "Pricing", "Pricing > Tiers", "Next", "footnotes", "comments", "header", "footer"]);
  assert.match(u[2].text, /^Pricing\nprice body$/);
  assert.equal(u[3].text, "Tiers\ntier body");
  assert.equal(u[5].text, "defined term");
  assert.equal(u[7].text, "CONFIDENTIAL");
});

maybeWide("PDF の題名・作成者は info 単位になる", async () => {
  const pdf = minimalPdf("body text");
  const withInfo = Buffer.from(pdf.toString("latin1").replace("/Root 1 0 R", "/Root 1 0 R /Info << /Title (Spec Sheet) /Author (Ken) >>"), "latin1");
  const u = await extractDoc(await put("Docs/info.pdf", withInfo));
  assert.equal(u[0].label, "info");
  assert.match(u[0].text, /title: Spec Sheet\nauthor: Ken/);
  assert.equal(u.at(-1).label, "p.1");
});

test("OCR は MEMO_OCR=on のときだけ画像を種別として認める", () => {
  const prev = process.env.MEMO_OCR;
  try {
    delete process.env.MEMO_OCR;
    assert.equal(kindOf("a/photo.PNG"), null);
    process.env.MEMO_OCR = "on";
    assert.equal(kindOf("a/photo.PNG"), "image");
    assert.equal(kindOf("scan.jpeg"), "image");
    assert.equal(kindOf("scan.pdf"), "pdf");
  } finally {
    if (prev === undefined) delete process.env.MEMO_OCR;
    else process.env.MEMO_OCR = prev;
  }
});

maybeWide("OCR: 画像と、テキスト層の無い PDF だけが tesseract に回り、コマンド無しは tool_missing", async () => {
  const bin = await fs.mkdtemp(path.join((await import("node:os")).tmpdir(), "fake-tess-"));
  const fake = path.join(bin, "tesseract");
  await fs.writeFile(fake, '#!/bin/sh\necho "OCR[$4]:$(basename "$1")"\n', { mode: 0o755 });
  const saved = { ...process.env };
  try {
    process.env.MEMO_OCR = "on";
    process.env.MEMO_TESSERACT = fake;
    const img = await put("Images/receipt.png", "not really a png");
    const u = await extractDoc(img, "image");
    assert.equal(u[0].label, "ocr");
    assert.equal(u[0].text, "OCR[jpn+eng]:receipt.png");

    // テキスト層のある PDF は OCR しない
    const textPdf = await extractDoc(await put("Docs/withtext.pdf", minimalPdf("real text layer here ok")));
    assert.match(textPdf[0].text, /real text layer/);
    assert.doesNotMatch(textPdf[0].text, /OCR/);
    // 空の PDF は pdftoppm → tesseract
    const scan = await extractDoc(await put("Docs/scan.pdf", minimalPdf("", "")));
    assert.deepEqual(scan.map((x) => x.label), ["p.1", "p.2"]);
    assert.match(scan[0].text, /^OCR\[jpn\+eng\]:pg-/);
    // ページ上限
    process.env.MEMO_OCR_PAGES = "1";
    assert.equal((await extractDoc(await put("Docs/scan2.pdf", minimalPdf("", "", "")))).length, 1);
    // OCR off なら PDF は空のまま
    delete process.env.MEMO_OCR;
    assert.deepEqual(await extractDoc(await put("Docs/scan3.pdf", minimalPdf(""))), []);
    // コマンド無し
    process.env.MEMO_OCR = "on";
    process.env.MEMO_TESSERACT = path.join(bin, "absent");
    const { extractDocStatus } = await import("../src/extract.mjs");
    assert.deepEqual(await extractDocStatus(img, "image"), { units: null, status: "tool_missing" });
  } finally {
    for (const k of ["MEMO_OCR", "MEMO_TESSERACT", "MEMO_OCR_PAGES"]) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    await fs.rm(bin, { recursive: true, force: true });
  }
});

maybeWide("上限を超える巨大なシートは先頭の行まで索引し（一時失敗にしない）、題名だけの文書は empty", async () => {
  const { extractDocStatus } = await import("../src/extract.mjs");
  const row = (r) => `<row r="${r}"><c r="A${r}" t="inlineStr"><is><t>${"x".repeat(80)}${r}</t></is></c></row>`;
  const big = Array.from({ length: 110_000 }, (_, i) => row(i + 1)).join("");
  const f = await put(
    "Docs/huge.xlsx",
    storedZip({
      "xl/workbook.xml": '<workbook><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>',
      "xl/_rels/workbook.xml.rels": '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
      "xl/worksheets/sheet1.xml": `<worksheet><sheetData>${big}</sheetData></worksheet>`,
    })
  );
  const r = await extractDocStatus(f);
  assert.equal(r.status, "ok");
  assert.ok(r.units && r.units.length > 0);
  // 題名だけで本文の無い文書は ok にしない
  const t = await put(
    "Docs/titleonly.xlsx",
    storedZip({
      "docProps/core.xml": CORE("Only a title", "Someone"),
      "xl/workbook.xml": '<workbook><sheets><sheet name="E" sheetId="1" r:id="rId1"/></sheets></workbook>',
      "xl/_rels/workbook.xml.rels": '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
      "xl/worksheets/sheet1.xml": "<worksheet><sheetData/></worksheet>",
    })
  );
  assert.deepEqual(await extractDocStatus(t), { units: [], status: "empty" });
});

// ---- OpenDocument / HTML / 旧式バイナリ ----
test("kindOf は odt/ods/odp と html、旧式 doc/xls/ppt を認識する", () => {
  assert.equal(kindOf("a.odt"), "odf");
  assert.equal(kindOf("a.ODS"), "odf");
  assert.equal(kindOf("a.odp"), "odf");
  assert.equal(kindOf("a.html"), "html");
  assert.equal(kindOf("a.htm"), "html");
  assert.equal(kindOf("a.doc"), "legacy");
  assert.equal(kindOf("a.xls"), "legacy");
  assert.equal(kindOf("a.ppt"), "legacy");
});

maybe("odt / ods / odp を content.xml から抽出する", async () => {
  const META = '<office:document-meta><office:meta><dc:title>Plan &amp; Budget</dc:title><dc:creator>Aki</dc:creator></office:meta></office:document-meta>';
  const odt = await put(
    "Docs/a.odt",
    storedZip({
      "meta.xml": META,
      "content.xml":
        "<office:document-content><office:body><office:text><text:h>Intro</text:h><text:p>A<text:tab/>b<text:line-break/>c &amp; d</text:p>" +
        "<text:p>Para two</text:p></office:text></office:body></office:document-content>",
    })
  );
  const t = await extractDoc(odt);
  assert.equal(t[0].label, "info");
  assert.match(t[0].text, /title: Plan & Budget/);
  assert.equal(t[1].text, "Intro\nA b\nc & d\nPara two");

  const ods = await put(
    "Docs/a.ods",
    storedZip({
      "content.xml":
        '<office:spreadsheet><table:table table:name="Sales"><table:table-row><table:table-cell><text:p>Region</text:p></table:table-cell><table:table-cell><text:p>East</text:p></table:table-cell></table:table-row></table:table>' +
        '<table:table table:name="Empty"><table:table-row><table:table-cell/></table:table-row></table:table></office:spreadsheet>',
    })
  );
  const s = await extractDoc(ods);
  assert.deepEqual(s.map((u) => u.label), ["Sales"]);
  assert.match(s[0].text, /Region\s+East/);

  const odp = await put(
    "Docs/a.odp",
    storedZip({
      "content.xml":
        '<office:presentation><draw:page draw:name="p1"><text:p>Slide one</text:p></draw:page><draw:page draw:name="p2"><text:p>Slide two</text:p></draw:page></office:presentation>',
    })
  );
  const p = await extractDoc(odp);
  assert.deepEqual(p.map((u) => [u.label, u.text]), [["slide.1", "Slide one"], ["slide.2", "Slide two"]]);
});

test("html は script/style/コメントを除き、ブロックを改行にして title を info にする", async () => {
  const f = await put(
    "Docs/page.html",
    '<!doctype html><html><head><title>My &amp; Page</title><style>p{color:red}</style></head><body><!-- hidden --><h1>Head</h1><p>one&nbsp;two</p><script>var secret=1;</script><ul><li>a</li><li>b</li></ul></body></html>'
  );
  const u = await extractDoc(f);
  assert.equal(u[0].label, "info");
  assert.match(u[0].text, /title: My & Page/);
  assert.match(u[1].text, /^Head\n+one two\n+a\n+b$/);
  assert.doesNotMatch(JSON.stringify(u), /secret|hidden|color/);
});

test("旧式 .doc/.xls/.ppt は unsupported として報告され、索引には載らない", async () => {
  const { extractDocStatus } = await import("../src/extract.mjs");
  const f = await put("Docs/old.doc", "\xd0\xcf\x11\xe0 binary");
  assert.deepEqual(await extractDocStatus(f), { units: [], status: "unsupported" });
  const idx = await new SpaceIndex(parseSpaces(fx2.spacesEnv), "notes").open();
  await idx.refresh();
  assert.equal(idx.rows("select count(*) n from pages where page = ?", ["Docs/old.doc"])[0].n, 0);
  assert.equal(idx.docStatus.get("Docs/old.doc")?.status, "unsupported");
  assert.ok(idx.docReport().unreadable.some((x) => x.page === "Docs/old.doc" && x.status === "unsupported"));
});
