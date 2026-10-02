import type { Row, SegmentMeta } from "../types.ts";

/** Per-row `where` results, parallel to `meta.segments`. */
export type SegmentMasks = WeakMap<Row, boolean[]>;

/** The segment a view starts on: the `default = true` one, else the first. */
export function defaultSegmentIndex(segments?: SegmentMeta[]): number {
  if (!segments?.length) return 0;
  const index = segments.findIndex((s) => s.default === true);
  return index === -1 ? 0 : index;
}

/** The segment a persisted label names, or -1 when it names none. */
export function segmentIndexFor(
  segments: SegmentMeta[] | undefined,
  label: unknown,
): number {
  if (!segments?.length || typeof label !== "string") return -1;
  return segments.findIndex((s) => s.label === label);
}

export function cycleSegmentIndex(
  current: number,
  count: number,
  delta: number,
): number {
  if (count <= 0) return 0;
  return (((current + delta) % count) + count) % count;
}

/**
 * The rows the active segment admits. A segment without a `where` is a
 * pass-through; one with a `where` that produced no mask (a failed batch, an
 * object added since the last load) drops the row -- the same fail-closed rule
 * action `when` masks follow.
 */
export function applySegment(
  rows: Row[],
  index: number,
  segments?: SegmentMeta[],
  masks?: SegmentMasks,
  revealed: readonly string[] = [],
): Row[] {
  const active = segments?.[index];
  const hidden = (active?.hiddenNames ?? []).filter(
    (entry) => !revealed.includes(entry),
  );
  const shown =
    hidden.length === 0
      ? rows
      : rows.filter((row) => !isHiddenName(String(row.obj.name), hidden));
  if (!active?.hasWhere) return shown;
  if (!masks) return [];
  return shown.filter((row) => masks.get(row)?.[index] === true);
}

function isHiddenName(name: string, hidden: readonly string[]): boolean {
  return hidden.some((entry) =>
    entry.endsWith("/") ? name.startsWith(entry) : name === entry,
  );
}

/** The `hiddenNames` the phrase has started to type, which bring them back. */
export function revealedNames(
  segment: SegmentMeta | undefined,
  phrase: string,
): string[] {
  const typed = phrase.trimStart().toLowerCase();
  if (typed === "") return [];
  return (segment?.hiddenNames ?? []).filter((entry) =>
    typed.startsWith(entry.toLowerCase()),
  );
}

/**
 * What an empty space tree says when its segment cannot hold a new page:
 * undefined on All and Pages (a "+" makes a page there), a plain sentence on
 * Documents and Meta, where a page made "here" would not appear.
 */
export function emptySegmentText(
  label: string | undefined,
): string | undefined {
  switch (label) {
    case undefined:
    case "All":
    case "Pages":
      return undefined;
    case "Documents":
      return "No documents yet.";
    case "Meta":
      return "No meta pages yet.";
    default:
      return `No ${label.toLowerCase()} yet.`;
  }
}
