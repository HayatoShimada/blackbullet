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

const DUE_ATTRIBUTE = /\s*\[due:\s*[^\]]*\]/;

/** Sets or clears the `[due: ...]` of a task's first line. */
export function setTaskDue(
  text: string,
  pos: number,
  expectedState: string,
  due: string | null,
): EditResult {
  if (pos < 0 || pos > text.length) return { ok: false, reason: "stale" };
  const { start, end } = lineBounds(text, pos);
  const line = text.slice(start, end);
  const m = TASK_LINE.exec(line);
  if (!m) return { ok: false, reason: "not-a-task" };
  if (m[2] !== expectedState) return { ok: false, reason: "stale" };
  let next: string;
  if (DUE_ATTRIBUTE.test(line)) {
    next = line.replace(DUE_ATTRIBUTE, due ? ` [due: ${due}]` : "");
  } else {
    next = due ? `${line.replace(/\s+$/, "")} [due: ${due}]` : line;
  }
  return { ok: true, text: text.slice(0, start) + next + text.slice(end) };
}

export type ParsedValue =
  | { ok: true; value: string | number | boolean | null }
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
      : { ok: false, error: "日付は 2026-10-02 の形にしてください" };
  }
  if (kind === "number") {
    const n = Number(text);
    return Number.isFinite(n)
      ? { ok: true, value: n }
      : { ok: false, error: "数にしてください" };
  }
  return { ok: true, value: text };
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
      error: `${p.label ?? p.key} は ${p.options.join(" / ")} のどれかにしてください`,
    };
  }
  return parsed;
}
