// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada

/**
 * The character offset of the first line inside the ```db block of `text`
 * whose body is `body` (compared without trailing blank space), or -1. A
 * cursor there shows the block's source in place of the widget. The same
 * match `replaceBlock` makes for "Save view"; when several blocks are
 * identical the first one wins (editing is harmless, writing is not).
 */
export function blockBodyOffset(text: string, body: string): number {
  const lines = text.split("\n");
  let offset = 0;
  for (let i = 0; i < lines.length; i++) {
    const start = offset;
    offset += lines[i].length + 1;
    if (!/^```db\s*$/.test(lines[i])) continue;
    let end = i + 1;
    while (end < lines.length && !/^```\s*$/.test(lines[end])) end++;
    if (end >= lines.length) return -1;
    if (
      lines
        .slice(i + 1, end)
        .join("\n")
        .trimEnd() === body.trimEnd()
    ) {
      return start + lines[i].length + 1;
    }
    for (let j = i + 1; j <= end; j++) offset += lines[j].length + 1;
    i = end;
  }
  return -1;
}
