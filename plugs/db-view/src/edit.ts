import type { CellKind, DatabaseProperty } from "./model.ts";
import { normalizeDate } from "./derive.ts";

export type EditResult =
  | { ok: true; text: string }
  | { ok: false; reason: "stale" | "not-a-task" };

/** `- [ ]`, `* [x]`, `1. [-]`: the marker, then the state character. */
const TASK_LINE = /^(\s*(?:[-*+]|\d+[.)])\s+\[)(.)(\])/;

function lineBounds(text: string, pos: number): { start: number; end: number } {
  const start = text.lastIndexOf("\n", pos - 1) + 1;
  const next = text.indexOf("\n", pos);
  return { start, end: next === -1 ? text.length : next };
}

/**
 * Sets a task done or not. `expectedState` is the state character the index
 * saw: if the line no longer shows it, the page has changed since and nothing
 * is written.
 */
export function setTaskDone(
  text: string,
  pos: number,
  expectedState: string,
  done: boolean,
): EditResult {
  if (pos < 0 || pos > text.length) return { ok: false, reason: "stale" };
  const { start, end } = lineBounds(text, pos);
  const line = text.slice(start, end);
  const m = TASK_LINE.exec(line);
  if (!m) return { ok: false, reason: "not-a-task" };
  if (m[2] !== expectedState) return { ok: false, reason: "stale" };
  const at = start + m[1].length;
  return {
    ok: true,
    text: text.slice(0, at) + (done ? "x" : " ") + text.slice(at + 1),
  };
}

/** An inline `[key: value]` attribute of a task line; `key` is a plain
 * attribute name (letters, digits, `_`). */
const attributeOf = (key: string) =>
  new RegExp(String.raw`\s*\[${key}:\s*[^\]]*\]`);

/** Sets (or, given null, clears) the `[key: value]` attributes of a task's
 * first line: an existing one is replaced where it is, a new one goes at the
 * end of the line, in the order given. */
export function setTaskAttributes(
  text: string,
  pos: number,
  expectedState: string,
  values: Record<string, string | null>,
): EditResult {
  if (pos < 0 || pos > text.length) return { ok: false, reason: "stale" };
  const { start, end } = lineBounds(text, pos);
  const line = text.slice(start, end);
  const m = TASK_LINE.exec(line);
  if (!m) return { ok: false, reason: "not-a-task" };
  if (m[2] !== expectedState) return { ok: false, reason: "stale" };
  let next = line;
  for (const [key, value] of Object.entries(values)) {
    if (!/^[A-Za-z_]\w*$/.test(key)) return { ok: false, reason: "not-a-task" };
    const re = attributeOf(key);
    if (re.test(next)) {
      next = next.replace(re, value ? ` [${key}: ${value}]` : "");
    } else if (value) {
      next = `${next.replace(/\s+$/, "")} [${key}: ${value}]`;
    }
  }
  return { ok: true, text: text.slice(0, start) + next + text.slice(end) };
}

/** Sets or clears the `[due: ...]` of a task's first line. */
export function setTaskDue(
  text: string,
  pos: number,
  expectedState: string,
  due: string | null,
): EditResult {
  return setTaskAttributes(text, pos, expectedState, { due });
}

export type ParsedValue =
  | { ok: true; value: string | number | boolean | string[] | null }
  | { ok: false; error: string };

/** What an edited cell becomes in the frontmatter. An empty cell clears the
 * attribute (`null`). */
export function parseCellInput(
  kind: CellKind,
  input: string | boolean,
): ParsedValue {
  if (kind === "boolean")
    return { ok: true, value: input === true || input === "true" };
  const text = String(input).trim();
  if (text === "") return { ok: true, value: null };
  if (kind === "date") {
    const iso = normalizeDate(text);
    return iso
      ? { ok: true, value: iso }
      : { ok: false, error: "Use a date like 2026-10-02" };
  }
  if (kind === "pages") return { ok: true, value: pageLinks(text) };
  if (kind === "number") {
    const n = Number(text);
    return Number.isFinite(n)
      ? { ok: true, value: n }
      : { ok: false, error: "Use a number" };
  }
  return { ok: true, value: text };
}

/** `[[A]], B|b` as links: `["[[A]]", "[[B|b]]"]`. Commas inside `[[ ]]`
 * belong to the link. */
export function pageLinks(text: string): string[] {
  const out: string[] = [];
  for (const part of text.match(/\s*\[\[[^\]]*\]\]|[^,]+/g) ?? []) {
    const t = part.trim();
    if (t === "") continue;
    const link = t.startsWith("[[") ? t : `[[${t}]]`;
    if (!out.includes(link)) out.push(link);
  }
  return out;
}

/** A write is stale when the page changed after the row was read. */
export function isStale(rowModified: string, currentModified: string): boolean {
  return rowModified !== currentModified;
}

/** The cell kind a declared property is edited as. */
export function propertyKind(p: DatabaseProperty): CellKind {
  return p.type === "page" ? "text" : p.type;
}

/**
 * Like `parseCellInput`, for a declared property: its type is the kind, and a
 * select takes only one of its options (or nothing, which clears it).
 */
export function parsePropertyInput(
  p: DatabaseProperty,
  input: string | boolean,
): ParsedValue {
  const parsed = parseCellInput(propertyKind(p), input);
  if (
    parsed.ok &&
    p.type === "select" &&
    typeof parsed.value === "string" &&
    p.options &&
    !p.options.includes(parsed.value)
  ) {
    return {
      ok: false,
      error: `${p.label ?? p.key} must be one of: ${p.options.join(", ")}`,
    };
  }
  return parsed;
}
