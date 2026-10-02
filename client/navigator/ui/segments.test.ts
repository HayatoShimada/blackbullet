import { expect, test } from "vitest";
import {
  applySegment,
  revealedNames,
  cycleSegmentIndex,
  defaultSegmentIndex,
  emptySegmentText,
  type SegmentMasks,
  segmentIndexFor,
} from "./segments.ts";
import type { Row, SegmentMeta } from "../types.ts";

const segments: SegmentMeta[] = [
  { label: "All", hasWhere: false },
  { label: "Pages", hasWhere: true, default: true },
  { label: "Documents", hasWhere: true },
];

function row(name: string): Row {
  return { obj: { name }, primary: name };
}

/** `masks[i]` lines up with `rows[i]`, each entry parallel to `segments`. */
function masksFor(rows: Row[], masks: boolean[][]): SegmentMasks {
  const out: SegmentMasks = new WeakMap();
  rows.forEach((r, i) => out.set(r, masks[i]));
  return out;
}

test("the default segment is the flagged one, else the first", () => {
  expect(defaultSegmentIndex(segments)).toBe(1);
  expect(defaultSegmentIndex([{ label: "A", hasWhere: false }])).toBe(0);
  expect(defaultSegmentIndex(undefined)).toBe(0);
  expect(defaultSegmentIndex([])).toBe(0);
});

test("a persisted label resolves to its segment, or to nothing", () => {
  expect(segmentIndexFor(segments, "Documents")).toBe(2);
  expect(segmentIndexFor(segments, "Gone")).toBe(-1);
  expect(segmentIndexFor(segments, undefined)).toBe(-1);
  expect(segmentIndexFor(undefined, "All")).toBe(-1);
});

test("cycling wraps in both directions", () => {
  expect(cycleSegmentIndex(0, 3, 1)).toBe(1);
  expect(cycleSegmentIndex(2, 3, 1)).toBe(0);
  expect(cycleSegmentIndex(0, 3, -1)).toBe(2);
  expect(cycleSegmentIndex(0, 0, 1)).toBe(0);
});

test("a segment without a predicate passes every row through", () => {
  const rows = [row("a"), row("b")];
  // No masks at all: the pass-through segment must not need any.
  expect(applySegment(rows, 0, segments)).toEqual(rows);
});

test("a segment with a predicate keeps only the rows its mask admits", () => {
  const rows = [row("a"), row("b"), row("c")];
  const masks = masksFor(rows, [
    [true, true, false],
    [true, false, true],
    [true, true, true],
  ]);
  expect(applySegment(rows, 1, segments, masks).map((r) => r.primary)).toEqual([
    "a",
    "c",
  ]);
  expect(applySegment(rows, 2, segments, masks).map((r) => r.primary)).toEqual([
    "b",
    "c",
  ]);
});

test("a row with no mask is dropped, not admitted", () => {
  const rows = [row("a"), row("b")];
  // Only the first row was masked -- e.g. the batch failed, or the row arrived
  // after it.
  const masks = masksFor([rows[0]], [[true, true, true]]);
  expect(applySegment(rows, 1, segments, masks).map((r) => r.primary)).toEqual([
    "a",
  ]);
  expect(applySegment(rows, 1, segments, undefined)).toEqual([]);
});

const hiding: SegmentMeta[] = [
  {
    label: "Pages",
    hasWhere: false,
    hiddenNames: ["Library/", "Templates/", "Trash/", "CONFIG"],
  },
];

test("a segment keeps its hidden folders and pages out of the way", () => {
  const rows = [
    "Notes",
    "Library/Std/Docs",
    "Templates/Project",
    "Trash/Old",
    "CONFIG",
    "CONFIG Backup",
  ].map(row);
  expect(applySegment(rows, 0, hiding).map((r) => r.obj.name)).toEqual([
    "Notes",
    "CONFIG Backup",
  ]);
});

test("typing a hidden prefix brings those rows back", () => {
  const rows = ["Notes", "Library/Std/Docs", "Trash/Old"].map(row);
  const revealed = revealedNames(hiding[0], "library/st");
  expect(revealed).toEqual(["Library/"]);
  expect(
    applySegment(rows, 0, hiding, undefined, revealed).map((r) => r.obj.name),
  ).toEqual(["Notes", "Library/Std/Docs"]);
  expect(revealedNames(hiding[0], "")).toEqual([]);
  expect(revealedNames(hiding[0], "Lib")).toEqual([]);
});

test("an empty segment that cannot hold a page says so instead of offering +", () => {
  expect(emptySegmentText("All")).toBeUndefined();
  expect(emptySegmentText("Pages")).toBeUndefined();
  expect(emptySegmentText(undefined)).toBeUndefined();
  expect(emptySegmentText("Documents")).toBe("No documents yet.");
  expect(emptySegmentText("Meta")).toBe("No meta pages yet.");
});
