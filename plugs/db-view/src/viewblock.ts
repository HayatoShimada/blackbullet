/**
 * Saving a view: the reader's tab, sort and filter phrase written back into
 * the ```db block they came from. Pure text work, so it is tested alone; the
 * plug reads and writes the page. Only the three keys are touched: comments,
 * order and every other line of the block stay as they were.
 */
import type { ViewKind } from "./model.ts";

export type SavedView = {
  view: ViewKind;
  sort?: { key: string; desc: boolean };
  /** The filter phrase; empty removes the key. */
  filter: string;
};

/** A YAML scalar: plain when that is safe, double-quoted otherwise. */
function scalar(text: string): string {
  return /^[A-Za-z_][\w .\u0080-￿-]*$/.test(text) &&
    !/^(true|false|yes|no|on|off|null|y|n)$/i.test(text) &&
    !/\s$/.test(text) &&
    !/\s(#|-\s)/.test(text)
    ? text
    : JSON.stringify(text);
}

/** `sort: -due` style value. */
const sortText = (sort: { key: string; desc: boolean }) =>
  scalar(sort.key).startsWith('"')
    ? JSON.stringify(sort.desc ? `-${sort.key}` : sort.key)
    : `${sort.desc ? "-" : ""}${scalar(sort.key)}`;

/** Sets (value given) or removes (undefined) a top-level `key:` line. The
 * old line is replaced in place; a new one goes at the end. */
function setKey(lines: string[], key: string, value: string | undefined) {
  const at = lines.findIndex((l) => l.startsWith(`${key}:`));
  if (at < 0) {
    if (value === undefined) return;
    // Keep a trailing blank line last.
    let end = lines.length;
    while (end > 0 && lines[end - 1].trim() === "") end--;
    lines.splice(end, 0, `${key}: ${value}`);
    return;
  }
  // The key's own continuation lines (indented, not comments) go with it.
  let to = at + 1;
  while (
    to < lines.length &&
    /^[ \t]+\S/.test(lines[to]) &&
    !/^[ \t]+#/.test(lines[to])
  )
    to++;
  // An inline comment after the old value stays.
  const comment = lines[at]
    .slice(key.length + 1)
    .match(/^\s*(?:"(?:[^"\\]|\\.)*"|'[^']*'|[^#"']*?)(\s+#.*)$/)?.[1];
  lines.splice(
    at,
    to - at,
    ...(value === undefined ? [] : [`${key}: ${value}${comment ?? ""}`]),
  );
}

/** The block body with the view's three keys set to `saved`. */
export function patchBlockBody(body: string, saved: SavedView): string {
  const lines = body.split("\n");
  setKey(lines, "view", saved.view);
  setKey(lines, "sort", saved.sort ? sortText(saved.sort) : undefined);
  setKey(
    lines,
    "filter",
    saved.filter.trim() === "" ? undefined : JSON.stringify(saved.filter),
  );
  return lines.join("\n");
}

export type ReplaceResult =
  | { ok: true; text: string }
  | { ok: false; reason: "missing" | "ambiguous" };

/**
 * Replaces the body of the one ```db block of `text` whose body is `oldBody`
 * (compared without trailing blank space). It is also the stale check: when
 * the block was edited since the widget drew it, nothing matches and nothing
 * is written.
 */
export function replaceBlock(
  text: string,
  oldBody: string,
  newBody: string,
): ReplaceResult {
  const lines = text.split("\n");
  const found: { from: number; to: number }[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/^```db\s*$/.test(lines[i])) continue;
    let end = i + 1;
    while (end < lines.length && !/^```\s*$/.test(lines[end])) end++;
    if (end >= lines.length) break;
    const body = lines.slice(i + 1, end).join("\n");
    if (body.trimEnd() === oldBody.trimEnd())
      found.push({ from: i + 1, to: end });
    i = end;
  }
  if (found.length === 0) return { ok: false, reason: "missing" };
  if (found.length > 1) return { ok: false, reason: "ambiguous" };
  const { from, to } = found[0];
  lines.splice(from, to - from, ...newBody.trimEnd().split("\n"));
  return { ok: true, text: lines.join("\n") };
}
