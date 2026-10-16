// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada

/** Turns `.fs/images/<name>` sources into data URLs from `dataUrls`. */
export function inlineImages(
  html: string,
  dataUrls: Map<string, string>,
): string {
  return html.replace(
    // The renderer writes the tag name as the DOM reports it: `<IMG`.
    /(<img\b[^>]*?\ssrc=")(?:\.fs\/)?images\/([^"]+)"/gi,
    (whole, head: string, name: string) => {
      const url = dataUrls.get(decodeURIComponentSafe(name));
      return url ? `${head}${url}"` : whole;
    },
  );
}

function decodeURIComponentSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!,
  );
}

const STYLE = `
@page { size: A4; margin: 18mm 16mm; }
html { font-family: "Noto Sans CJK JP", "Noto Sans JP", "Hiragino Sans", "Yu Gothic", sans-serif; font-size: 10.5pt; line-height: 1.7; color: #1c2128; }
body { margin: 0; }
h1, h2, h3, h4 { line-height: 1.3; margin: 1.4em 0 0.5em; break-after: avoid; }
h1.sb-export-title { margin-top: 0; font-size: 20pt; }
h1 { font-size: 17pt; } h2 { font-size: 14pt; } h3 { font-size: 12pt; } h4 { font-size: 10.5pt; }
p, ul, ol, table, pre, blockquote { margin: 0 0 0.8em; }
img { max-width: 100%; height: auto; break-inside: avoid; }
table { border-collapse: collapse; width: 100%; break-inside: auto; }
th, td { border: 1px solid #c9ced6; padding: 4px 8px; text-align: left; vertical-align: top; }
th { background: #f2f4f7; }
code, pre { font-family: "Noto Sans Mono CJK JP", "DejaVu Sans Mono", monospace; font-size: 9pt; }
pre { background: #f6f7f8; padding: 8px 10px; white-space: pre-wrap; border-radius: 4px; }
blockquote { border-left: 3px solid #c9ced6; padding-left: 10px; color: #4b5563; }
a { color: #2456b0; text-decoration: none; }
hr { border: 0; border-top: 1px solid #c9ced6; }
`;

/**
 * Drops what could act rather than show: scripts, embeds, and `<meta>` /
 * `<base>` / `<link>` (a `meta refresh` would navigate the print page away).
 * The sidecar strips the same again; this keeps the request clean too.
 */
export function stripActive(html: string): string {
  return html
    .replace(
      /<(script|iframe|frame|frameset|object|embed|noscript|template)\b[\s\S]*?<\/\1\s*>/gi,
      "",
    )
    .replace(
      /<\/?(script|meta|base|link|iframe|frame|frameset|object|embed|portal)\b[^>]*>/gi,
      "",
    );
}

/** A standalone page for print and for Word: title, body, no scripts. */
export function htmlDocument(title: string, bodyHtml: string): string {
  const body = stripActive(bodyHtml);
  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>${STYLE}</style></head>
<body><h1 class="sb-export-title">${escapeHtml(title)}</h1>
${body}
</body></html>`;
}
