// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada
import {
  config,
  editor,
  markdown,
  space,
  system,
} from "@silverbulletmd/silverbullet/syscalls";
import { syscall } from "@silverbulletmd/silverbullet/syscall";
import type { ParseTree } from "@silverbulletmd/silverbullet/lib/tree";
import { base64Encode } from "@silverbulletmd/silverbullet/lib/crypto";
import { parseToRef } from "@silverbulletmd/silverbullet/lib/ref";
import {
  isLocalURL,
  resolveMarkdownLink,
} from "@silverbulletmd/silverbullet/lib/resolve";
import type { Transclusion } from "@silverbulletmd/silverbullet/lib/transclusion";
import {
  type ExportImage,
  type ImageSource,
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
import { createZip } from "./zip.ts";

export type Format = "pdf" | "docx" | "zip";

/** What `Export: Page Or Selection` hands an exporter. */
type ExportData = { pageMeta?: { name?: string }; text?: string };

const FORMATS: { format: Format; name: string; description: string }[] = [
  { format: "pdf", name: "PDF", description: "For reading and printing" },
  { format: "docx", name: "Word", description: "To edit in Word (.docx)" },
  {
    format: "zip",
    name: "Markdown with images",
    description: "The page and its images in a .zip",
  },
];

const FORMAT_LABEL: Record<Format, string> = {
  pdf: "PDF",
  docx: "Word",
  zip: "Markdown",
};

type SidecarConfig = { url?: string; token?: string; space?: string };

// The sidecar makes one PDF at a time and keeps at most one waiting, each up
// to 90 s (packages/memo-mcp/src/export.mjs): wait a little longer than both.
const SIDECAR_TIMEOUT_MS = 200_000;
// One slow or silent image host must not hold the whole export.
const IMAGE_TIMEOUT_MS = 15_000;

const READ_ONLY_MESSAGE =
  "PDF and Word need write access (they are made by the sidecar); Markdown with images works read-only";

/** `Export: PDF`, `Export: Word`, `Export: Markdown with Images`. */
export const exportPdf = () => exportPage("pdf");
export const exportWord = () => exportPage("docx");
export const exportZip = () => exportPage("zip");

/** The tree's `Export…`: asks which format, then exports that page. */
export async function chooseFormat(pageName?: string): Promise<void> {
  // Read-only: the sidecar is out of reach, so only the .zip is offered.
  const readOnly = (await system.getMode()) === "ro";
  const formats = readOnly
    ? FORMATS.filter((f) => f.format === "zip")
    : FORMATS;
  const choice = await editor.filterBox(
    "Export",
    formats.map((f) => ({ name: f.name, description: f.description })),
    readOnly ? "Read-only: PDF and Word need write access" : "Choose a format",
  );
  const format = formats.find((f) => f.name === choice?.name)?.format;
  if (format) await exportPage(format, { pageMeta: { name: pageName } });
}

/**
 * Exports a page (the current one unless `data` names another; `data.text`
 * is a selection to export instead of the whole page) and downloads it.
 */
export async function exportPage(
  format: Format,
  data: ExportData = {},
): Promise<void> {
  try {
    if (format !== "zip" && (await system.getMode()) === "ro") {
      throw new Error(READ_ONLY_MESSAGE);
    }
    const current = await editor.getCurrentPage();
    const pageName = data.pageMeta?.name || current;
    let text = data.text;
    if (text === undefined) {
      if (pageName === current) {
        await editor.save();
        text = await editor.getText();
      } else {
        text = await space.readPage(pageName);
      }
    }
    const title = pageName.split("/").pop() || pageName;
    const fileBase = safeFileName(title);
    await editor.flashNotification(`Exporting ${FORMAT_LABEL[format]}…`);
    const loader = imageLoader(pageName);
    const load = (t: Transclusion) => loader(t);
    // Queries and transclusions become their results; the page's own tasks
    // stay as written (no `[[Page@pos]]` back-references).
    let tree: ParseTree = await syscall(
      "markdown.expandMarkdown",
      await markdown.parseMarkdown(text),
      { rewriteTasks: false },
    );
    if (format === "zip") {
      const images = await rewriteImages(tree, load, keepNames());
      const md = await markdown.renderParseTree(tree);
      const zip = createZip([
        { name: `${fileBase}.md`, data: new TextEncoder().encode(md) },
        ...images.map((i) => ({
          name: `images/${i.name}`,
          data: i.source.bytes,
        })),
      ]);
      await download(`${fileBase}.zip`, "application/zip", zip);
      return;
    }
    tree = withoutFrontmatter(tree);
    const images = await rewriteImages(tree, load, numberedNames());
    const body = await markdown.markdownToHtml(
      await markdown.renderParseTree(tree),
    );
    const html = htmlDocument(title, inlineImages(body, dataUrls(images)));
    const bytes = await renderOnSidecar(format, title, html);
    await download(
      `${fileBase}.${format}`,
      format === "pdf"
        ? "application/pdf"
        : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      bytes,
    );
  } catch (e: any) {
    await editor.flashNotification(
      `Could not export ${FORMAT_LABEL[format]}: ${e?.message ?? e}`,
      "error",
    );
  }
}

function dataUrls(images: ExportImage[]): Map<string, string> {
  return new Map(
    images.map((i) => [
      i.name,
      `data:${i.source.mime};base64,${base64Encode(i.source.bytes)}`,
    ]),
  );
}

async function download(
  filename: string,
  mime: string,
  bytes: Uint8Array,
): Promise<void> {
  await editor.downloadFile(
    filename,
    `data:${mime};base64,${base64Encode(bytes)}`,
  );
}

/** Rejects with `message` after `ms`; the timer never outlives the race. */
async function withTimeout<T>(
  work: Promise<T>,
  ms: number,
  message: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Reads the images a page shows: embedded data URLs, files in the space, or
 * the web through the proxy. One loader per export, so the space is listed at
 * most once.
 */
function imageLoader(
  pageName: string,
): (t: Transclusion) => Promise<ImageSource | null> {
  let names: Promise<string[]> | undefined;
  return async (t) => {
    if (/^data:/i.test(t.url)) return parseDataUrl(t.url);
    if (!isLocalURL(t.url)) {
      return withTimeout(
        (async () => {
          const resp = await fetch(t.url);
          if (!resp.ok) return null;
          const kind = remoteImageKind(resp.headers.get("content-type"), t.url);
          if (!kind) return null;
          return { bytes: new Uint8Array(await resp.arrayBuffer()), ...kind };
        })(),
        IMAGE_TIMEOUT_MS,
        `image timed out: ${t.url}`,
      );
    }
    let path =
      t.linktype === "wikilink"
        ? (parseToRef(t.url)?.path ?? t.url)
        : resolveMarkdownLink(pageName, decodeURI(t.url));
    const kind = imageMime(path);
    if (!kind) return null;
    if (!(await space.fileExists(path))) {
      // A wiki link that names the file alone (`![[pic.png]]`) finds it
      // wherever it sits, as it does in the editor. A path, or a Markdown
      // link, means that file: a miss keeps the original link.
      if (t.linktype !== "wikilink" || path.includes("/")) return null;
      names ??= space.listFiles().then((fs) => fs.map((f) => f.name));
      const found = (await names).find((n) => n.split("/").pop() === path);
      if (!found) return null;
      path = found;
    }
    return { bytes: await space.readFile(path), ...kind };
  };
}

/** PDF and Word are made by the search sidecar from the page's HTML. */
async function renderOnSidecar(
  format: "pdf" | "docx",
  title: string,
  html: string,
): Promise<Uint8Array> {
  const cfg = await config.get<SidecarConfig | null>("memoSidecar", null);
  if (!cfg?.url) {
    throw new Error("PDF and Word need the search sidecar (memoSidecar)");
  }
  const base = cfg.url
    .replace(/^https?:\/\//, "")
    .replace(/^\/?\.proxy\//, "")
    .replace(/^\/+|\/+$/g, "");
  const resp = await withTimeout(
    fetch(`http://${base}/api/export/${format}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(cfg.token ? { Authorization: `Bearer ${cfg.token}` } : {}),
      },
      body: JSON.stringify({ title, html }),
    }),
    SIDECAR_TIMEOUT_MS,
    "the sidecar did not answer in time",
  );
  if (!resp.ok) {
    let message = `the sidecar answered HTTP ${resp.status}`;
    try {
      const body = await resp.json();
      if (body?.error) message = body.error;
    } catch {
      // not JSON: keep the status
    }
    throw new Error(message);
  }
  return new Uint8Array(await resp.arrayBuffer());
}
