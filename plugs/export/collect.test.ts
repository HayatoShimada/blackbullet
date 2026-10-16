// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada
import { expect, test } from "vitest";
import type { ParseTree } from "@silverbulletmd/silverbullet/lib/tree";
import { renderToText } from "@silverbulletmd/silverbullet/lib/tree";
import {
  imageLabel,
  imageMime,
  keepNames,
  numberedNames,
  parseDataUrl,
  remoteImageKind,
  rewriteImages,
  safeFileName,
  withoutFrontmatter,
} from "./collect.ts";
import { htmlDocument, inlineImages } from "./html.ts";

const image = (text: string): ParseTree => ({
  type: "Image",
  children: [{ text }],
});

function page(...images: string[]): ParseTree {
  return {
    type: "Document",
    children: [
      { type: "FrontMatter", children: [{ text: "---\ntags: x\n---\n" }] },
      ...images.flatMap((i) => [image(i), { text: "\n" }]),
    ],
  };
}

const png = { bytes: new Uint8Array([1]), mime: "image/png", ext: "png" };

test("images point at images/<name>; one file per URL; misses keep their link", async () => {
  const tree = page(
    "![cat](Images/my cat.png)",
    "![[Images/my cat.png|again]]",
    "![[other.png]]",
    "![[elsewhere/other.png]]",
    "![gone](missing.png)",
  );
  const seen: string[] = [];
  const files = await rewriteImages(
    tree,
    async (t) => {
      seen.push(t.url);
      return t.url.includes("missing") ? null : png;
    },
    keepNames(),
  );
  // The wiki link names the first image's file again: read once, one copy.
  expect(seen).toEqual([
    "Images/my cat.png",
    "other.png",
    "elsewhere/other.png",
    "missing.png",
  ]);
  expect(files.map((f) => f.name)).toEqual([
    "my cat.png",
    "other.png",
    "other-2.png",
  ]);
  const text = renderToText(tree);
  expect(text).toContain("![cat](<images/my cat.png>)");
  expect(text).toContain("![again](<images/my cat.png>)");
  expect(text).toContain("![](images/other.png)");
  expect(text).toContain("![](images/other-2.png)");
  expect(text).toContain("![gone](missing.png)");
});

test("numbered names survive HTML escaping and are inlined as data URLs", async () => {
  const tree = page("![a](x.png)", "![b](y.png)");
  const files = await rewriteImages(tree, async () => png, numberedNames());
  expect(files.map((f) => f.name)).toEqual(["image-1.png", "image-2.png"]);
  const html = inlineImages(
    '<p><IMG src=".fs/images/image-1.png" alt="a"><img src=".fs/images/image-9.png"></p>',
    new Map([["image-1.png", "data:image/png;base64,AA=="]]),
  );
  expect(html).toBe(
    '<p><IMG src="data:image/png;base64,AA==" alt="a"><img src=".fs/images/image-9.png"></p>',
  );
});

test("frontmatter is dropped for documents; names and types are safe", () => {
  expect(withoutFrontmatter(page()).children).toEqual([]);
  expect(safeFileName('a/b:c*?"<>|')).toBe("a_b_c______");
  expect(safeFileName("..")).toBe("page");
  expect(imageMime("Images/x.JPG")).toEqual({ mime: "image/jpeg", ext: "jpg" });
  expect(imageMime("notes.pdf")).toBeNull();
});

test("the document carries the title and no scripts", () => {
  const doc = htmlDocument("A & B", "<p>x</p><script>alert(1)</script>");
  expect(doc).toContain('<h1 class="sb-export-title">A &amp; B</h1>');
  expect(doc).not.toContain("<script>");
});

test("the size and an escaped alias survive the rewrite", async () => {
  const tree = page(
    "![Diagram|300x200](pic.png)",
    "![[a.png|400]]",
    "![[b.png|x]b]]",
  );
  await rewriteImages(tree, async () => png, numberedNames());
  const text = renderToText(tree);
  expect(text).toContain("![Diagram|300x200](images/image-1.png)");
  expect(text).toContain("![|400](images/image-2.png)");
  expect(imageLabel("a]b", { height: 50 })).toBe("a\\]b|x50");
  expect(imageLabel("plain")).toBe("plain");
});

test("data URLs are read in place; fetched images trust their Content-Type", () => {
  expect(parseDataUrl("data:image/png;base64,AQI=")).toEqual({
    bytes: new Uint8Array([1, 2]),
    mime: "image/png",
    ext: "png",
  });
  expect(parseDataUrl("data:text/html;base64,AQI=")).toBeNull();
  expect(parseDataUrl("data:image/png,raw")).toBeNull();
  expect(remoteImageKind("image/jpeg; q=1", "https://h/a.png")?.ext).toBe(
    "jpg",
  );
  expect(remoteImageKind("text/html", "https://h/a.png")).toBeNull();
  expect(remoteImageKind(null, "https://h/a.png")?.ext).toBe("png");
  expect(
    remoteImageKind("application/octet-stream", "https://h/a.gif")?.ext,
  ).toBe("gif");
});

test("the document drops meta refresh, base, links and embeds", () => {
  const doc = htmlDocument(
    "t",
    '<p>x</p><meta http-equiv="refresh" content="0;url=file:///proc/self/environ"><BASE href="file:///"><link rel=import href=x><iframe src="file:///etc/passwd"></iframe><object data=x></object>',
  );
  expect(doc).not.toMatch(/refresh|<base|<link|<iframe|<object/i);
  expect(doc).toContain("<p>x</p>");
});
