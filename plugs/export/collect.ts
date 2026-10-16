// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada
import type { ParseTree } from "@silverbulletmd/silverbullet/lib/tree";
import {
  collectNodesOfType,
  renderToText,
} from "@silverbulletmd/silverbullet/lib/tree";
import { base64Decode } from "@silverbulletmd/silverbullet/lib/crypto";
import {
  type ContentDimensions,
  parseTransclusion,
  type Transclusion,
} from "@silverbulletmd/silverbullet/lib/transclusion";

/** An image a page shows, read from the space or the web. */
export type ImageSource = { bytes: Uint8Array; mime: string; ext: string };

export type ImageLoader = (t: Transclusion) => Promise<ImageSource | null>;

/** A file the export carries next to the text, under `images/`. */
export type ExportImage = { name: string; source: ImageSource };

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  avif: "image/avif",
  bmp: "image/bmp",
};

export function imageMime(path: string): { mime: string; ext: string } | null {
  const ext = path.split(/[?#]/)[0].split(".").pop()?.toLowerCase() ?? "";
  const mime = MIME_BY_EXT[ext];
  return mime ? { mime, ext } : null;
}

export function extForMime(mime: string): string | null {
  const type = mime.split(";")[0].trim().toLowerCase();
  const found = Object.entries(MIME_BY_EXT).find(([, m]) => m === type);
  return found ? found[0] : null;
}

/** An image embedded in the page as `data:image/…;base64,…`. */
export function parseDataUrl(url: string): ImageSource | null {
  const m = /^data:([^;,]+)((?:;[^;,]*)*?);base64,(.*)$/is.exec(url.trim());
  if (!m) return null;
  const ext = extForMime(m[1]);
  if (!ext) return null;
  try {
    return {
      bytes: base64Decode(m[3].replace(/\s+/g, "")),
      mime: MIME_BY_EXT[ext],
      ext,
    };
  } catch {
    return null;
  }
}

/**
 * The kind of a fetched image. A response that says what it is decides: an
 * image type we know, or nothing (an HTML error or login page is no image).
 * Only an unlabelled or generic response falls back to the URL's extension.
 */
export function remoteImageKind(
  contentType: string | null,
  url: string,
): { mime: string; ext: string } | null {
  const type = (contentType ?? "").split(";")[0].trim().toLowerCase();
  if (type && type !== "application/octet-stream") {
    const ext = extForMime(type);
    return ext ? { mime: MIME_BY_EXT[ext], ext } : null;
  }
  return imageMime(url);
}

/** A file name safe on every system, keeping the page's own wording. */
export function safeFileName(name: string): string {
  const cleaned = name
    // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what it removes
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
    .replace(/^\.+/, "")
    .trim();
  return cleaned || "page";
}

/** The original base name, numbered when two images share one. */
export function keepNames(): (t: Transclusion, source: ImageSource) => string {
  const used = new Set<string>();
  return (t, source) => {
    const last = t.url.split(/[?#]/)[0].split("/").pop() ?? "";
    let base = safeFileName(decodeURIComponentSafe(last)).replace(
      /\.[^.]*$/,
      "",
    );
    if (!base || base === "page") base = "image";
    let name = `${base}.${source.ext}`;
    for (let n = 2; used.has(name.toLowerCase()); n++) {
      name = `${base}-${n}.${source.ext}`;
    }
    used.add(name.toLowerCase());
    return name;
  };
}

/** `image-1.png`, `image-2.jpg`…: names that survive any URL escaping. */
export function numberedNames(): (
  t: Transclusion,
  source: ImageSource,
) => string {
  let n = 0;
  return (_t, source) => `image-${++n}.${source.ext}`;
}

function decodeURIComponentSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function linkTarget(path: string): string {
  return /[\s()<>]/.test(path) ? `<${path}>` : path;
}

/** `![alt|300x200](…)`'s text part: the alias escaped, the size kept. */
export function imageLabel(
  alias: string,
  dimension?: ContentDimensions,
): string {
  const alt = alias.replace(/[\\[\]]/g, (c) => `\\${c}`);
  if (!dimension || (!dimension.width && !dimension.height)) return alt;
  const size = `${dimension.width ?? ""}${dimension.height ? `x${dimension.height}` : ""}`;
  return `${alt}|${size}`;
}

/**
 * Points every image the tree shows at `images/<name>` and returns the files
 * to carry along. An image that cannot be read keeps its original link.
 */
export async function rewriteImages(
  tree: ParseTree,
  load: ImageLoader,
  nameFor: (t: Transclusion, source: ImageSource) => string,
): Promise<ExportImage[]> {
  const files: ExportImage[] = [];
  const byUrl = new Map<string, string | null>();
  for (const node of collectNodesOfType(tree, "Image")) {
    const t = parseTransclusion(renderToText(node));
    if (!t) continue;
    let name = byUrl.get(t.url);
    if (name === undefined) {
      const source = await load(t).catch(() => null);
      name = source ? nameFor(t, source) : null;
      if (source && name) files.push({ name, source });
      byUrl.set(t.url, name);
    }
    if (!name) continue;
    node.children = [
      {
        text: `![${imageLabel(t.alias, t.dimension)}](${linkTarget(`images/${name}`)})`,
      },
    ];
  }
  return files;
}

/** Drops the frontmatter: a document for reading shows no YAML. */
export function withoutFrontmatter(tree: ParseTree): ParseTree {
  return {
    ...tree,
    children: (tree.children ?? []).filter((c) => c.type !== "FrontMatter"),
  };
}
