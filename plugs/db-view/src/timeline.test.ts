// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada
import { describe, expect, test } from "vitest";
import type { DbRow } from "./model.ts";
import {
  addDays,
  applyDrag,
  cascade,
  dayAt,
  daysFor,
  dependencyEdges,
  extendWindow,
  initialWindow,
  layoutRows,
  linkTarget,
  linkTargets,
  type Line,
  spanOf,
  ticks,
  type TimelineKeys,
  weekStartOf,
  windowAround,
  withDependency,
  xOf,
} from "./timeline.ts";

const keys: TimelineKeys = {
  start: "start",
  end: "due",
  parent: "parent",
  dependsOn: "blockedBy",
};

const row = (
  id: string,
  values: Record<string, unknown> = {},
  over: Partial<DbRow> = {},
): DbRow => ({
  id,
  kind: "page",
  page: id,
  title: id,
  values,
  modified: "m",
  ...over,
});

const ids = (lines: Line[]) =>
  lines.map((l) =>
    l.type === "group" ? `#${l.key}` : `${"  ".repeat(l.depth)}${l.row.id}`,
  );

describe("dates", () => {
  test("adds days across months and years", () => {
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  test("a week starts on Sunday or Monday", () => {
    // 2026-10-29 is a Thursday.
    expect(weekStartOf("2026-10-29", 0)).toBe("2026-10-25");
    expect(weekStartOf("2026-10-29", 1)).toBe("2026-10-26");
    expect(weekStartOf("2026-10-26", 1)).toBe("2026-10-26");
  });
});

describe("spanOf", () => {
  test("both dates, one of them, or none", () => {
    expect(
      spanOf(row("a", { start: "2026-10-01", due: "2026-10-05" }), keys),
    ).toEqual({
      start: "2026-10-01",
      end: "2026-10-05",
    });
    expect(spanOf(row("a", { due: "2026-10-05" }), keys)).toEqual({
      start: "2026-10-05",
      end: "2026-10-05",
    });
    expect(spanOf(row("a", { start: "2026-10-01" }), keys)).toEqual({
      start: "2026-10-01",
      end: "2026-10-01",
    });
    expect(spanOf(row("a", { due: "soon" }), keys)).toBeUndefined();
  });

  test("a start after the end reads the other way round", () => {
    expect(
      spanOf(row("a", { start: "2026-10-09", due: "2026-10-02" }), keys),
    ).toEqual({
      start: "2026-10-02",
      end: "2026-10-09",
    });
  });
});

describe("scale and window", () => {
  test("x and the day under it agree", () => {
    const w = { from: "2026-10-01", days: 60 };
    expect(xOf("2026-10-11", w, "week")).toBe(220);
    expect(dayAt(220, w, "week")).toBe("2026-10-11");
    expect(dayAt(241, w, "week")).toBe("2026-10-11");
    expect(daysFor(30, "week")).toBe(1);
    expect(daysFor(-50, "week")).toBe(-2);
    expect(daysFor(3, "week")).toBe(0);
  });

  test("opens on every bar and today, from a week start, a screen wide", () => {
    const w = initialWindow(
      [{ start: "2026-11-10", end: "2026-12-20" }],
      "2026-10-29",
      "week",
    );
    expect(w.from <= addDays("2026-10-29", -14)).toBe(true);
    expect(weekStartOf(w.from, 0)).toBe(w.from);
    expect(addDays(w.from, w.days) > "2026-12-20").toBe(true);
    expect(w.days * 22).toBeGreaterThanOrEqual(1600);
  });

  test("wider zooms start on a month; far-off bars do not stretch it", () => {
    const w = initialWindow(
      [{ start: "2019-01-01", end: "2019-02-01" }],
      "2026-10-29",
      "month",
    );
    expect(w.from.endsWith("-01")).toBe(true);
    expect(w.from > "2024-01-01").toBe(true);
  });

  test("extends either side, and recentres on a day out of reach", () => {
    const w = { from: "2026-10-01", days: 100 };
    const before = extendWindow(w, "before", "week");
    expect(before.days).toBeGreaterThan(100);
    expect(addDays(before.from, before.days)).toBe(addDays(w.from, w.days));
    expect(extendWindow(w, "after", "week").from).toBe(w.from);
    expect(windowAround("2026-11-15", w, "week")).toBe(w);
    const far = windowAround("2027-06-01", w, "week");
    expect(far.days).toBe(100);
    expect(
      far.from < "2027-06-01" && addDays(far.from, 100) > "2027-06-01",
    ).toBe(true);
  });
});

describe("ticks", () => {
  test("week zoom: months over days, weekends banded", () => {
    const t = ticks({ from: "2026-10-30", days: 4 }, "week");
    expect(t.upper.map((x) => x.label)).toEqual(["Oct 2026", "Nov 2026"]);
    expect(t.upper[0]).toMatchObject({ x: 0, width: 44 });
    expect(t.lower.map((x) => x.label)).toEqual(["30", "31", "1", "2"]);
    // Oct 31 is a Saturday, Nov 1 a Sunday.
    expect(t.weekends.map((x) => x.start)).toEqual([
      "2026-10-31",
      "2026-11-01",
    ]);
  });

  test("quarter zoom: years over months, no weekend bands", () => {
    const t = ticks({ from: "2026-11-01", days: 92 }, "quarter");
    expect(t.upper.map((x) => x.label)).toEqual(["2026", "2027"]);
    expect(t.lower.map((x) => x.label)).toEqual(["Nov", "Dec", "Jan"]);
    expect(t.weekends).toEqual([]);
  });

  test("month zoom: the first week is cut at the window's edge", () => {
    const t = ticks({ from: "2026-10-01", days: 31 }, "month");
    expect(t.lower[0]).toMatchObject({ start: "2026-09-27", x: 0, width: 21 });
  });
});

describe("applyDrag", () => {
  const span = { start: "2026-10-05", end: "2026-10-09" };
  test("moves whole, or one end, never below a day", () => {
    expect(applyDrag(span, "move", 3)).toEqual({
      start: "2026-10-08",
      end: "2026-10-12",
    });
    expect(applyDrag(span, "start", -2)).toEqual({
      start: "2026-10-03",
      end: "2026-10-09",
    });
    expect(applyDrag(span, "start", 9)).toEqual({
      start: "2026-10-09",
      end: "2026-10-09",
    });
    expect(applyDrag(span, "end", -9)).toEqual({
      start: "2026-10-05",
      end: "2026-10-05",
    });
  });
});

describe("links", () => {
  test("reads the forms a link takes", () => {
    expect(linkTarget("[[Tasks/A|a]]")).toBe("Tasks/A");
    expect(linkTarget("[[Tasks/A]]")).toBe("Tasks/A");
    expect(linkTarget(" Tasks/A ")).toBe("Tasks/A");
    expect(linkTarget("")).toBeUndefined();
    expect(linkTargets(["[[A]]", "A", "[[B]]"])).toEqual(["A", "B"]);
    expect(linkTargets("[[A]]")).toEqual(["A"]);
  });

  test("adds and removes a dependency", () => {
    expect(withDependency(undefined, "A", true)).toEqual(["[[A]]"]);
    expect(withDependency(["[[A]]", "[[B|b]]"], "B", false)).toEqual(["[[A]]"]);
    expect(withDependency("[[A]]", "A", true)).toEqual(["[[A]]"]);
  });
});

describe("layoutRows", () => {
  const none = () => false;

  test("children under their parent, a loop cut", () => {
    const rows = [
      row("P"),
      row("C1", { parent: "[[P]]" }),
      row("G", { parent: "[[C1]]" }),
      row("X", { parent: "[[Y]]" }),
      row("Y", { parent: "[[X]]" }),
      row("T", {}, { kind: "task", parentId: "P" }),
    ];
    expect(ids(layoutRows(rows, { keys, collapsed: none }))).toEqual([
      "P",
      "  C1",
      "    G",
      "  T",
      // Each of a loop's rows leads back to itself: both stay on top.
      "X",
      "Y",
    ]);
  });

  test("a folded row hides its children and says how many", () => {
    const rows = [row("P"), row("C", { parent: "P" })];
    const lines = layoutRows(rows, { keys, collapsed: (k) => k === "r:P" });
    expect(ids(lines)).toEqual(["P"]);
    expect(lines[0]).toMatchObject({ children: 1, collapsed: true });
  });

  test("rolls children's spans and progress up", () => {
    const rows = [
      row("P"),
      row("C1", {
        parent: "P",
        start: "2026-10-03",
        due: "2026-10-04",
        status: "done",
      }),
      row("C2", { parent: "P", due: "2026-10-20" }),
      row(
        "T",
        { done: true, due: "2026-09-30" },
        { kind: "task", parentId: "C2" },
      ),
    ];
    const [p] = layoutRows(rows, { keys, collapsed: none });
    expect(p).toMatchObject({
      type: "row",
      rollup: {
        span: { start: "2026-09-30", end: "2026-10-20" },
        done: 2,
        total: 3,
      },
    });
    expect(p.type === "row" && p.span).toBeFalsy();
  });

  test("groups top-level rows; a folded group shows only its heading", () => {
    const rows = [
      row("A", { status: "active" }),
      row("B", { status: "done" }),
      row("C", { parent: "A", status: "done" }),
    ];
    const lines = layoutRows(rows, {
      keys,
      group: "status",
      collapsed: (k) => k === "g:done",
    });
    expect(ids(lines)).toEqual(["#active", "A", "  C", "#done"]);
    expect(lines[3]).toMatchObject({ count: 1, collapsed: true });
  });
});

describe("dependencies", () => {
  const rows = [
    row("A", { start: "2026-10-01", due: "2026-10-05" }),
    row("B", { start: "2026-10-06", due: "2026-10-08", blockedBy: ["[[A]]"] }),
    row("C", { start: "2026-10-09", due: "2026-10-10", blockedBy: "[[B]]" }),
    row("D", { due: "2026-10-04", blockedBy: ["[[A]]", "[[Gone]]", "[[D]]"] }),
    row("U", { blockedBy: ["[[A]]"] }),
  ];

  test("arrows between drawn rows; late when the blocked starts too early", () => {
    expect(dependencyEdges(rows, keys)).toEqual([
      { from: "A", to: "B", late: false },
      { from: "B", to: "C", late: false },
      { from: "A", to: "D", late: true },
    ]);
  });

  test("a move pushes what it now overlaps, down the chain", () => {
    const moved = cascade(rows, keys, "A", {
      start: "2026-10-03",
      end: "2026-10-07",
    });
    expect(Object.fromEntries(moved)).toEqual({
      B: { start: "2026-10-08", end: "2026-10-10" },
      C: { start: "2026-10-11", end: "2026-10-12" },
      D: { start: "2026-10-08", end: "2026-10-08" },
    });
  });

  test("a move that leaves room pushes nothing; a loop ends", () => {
    expect(
      cascade(rows, keys, "A", { start: "2026-09-20", end: "2026-09-21" }).size,
    ).toBe(0);
    const loop = [
      row("X", { start: "2026-10-01", due: "2026-10-02", blockedBy: "[[Y]]" }),
      row("Y", { start: "2026-10-03", due: "2026-10-04", blockedBy: "[[X]]" }),
    ];
    const moved = cascade(loop, keys, "X", {
      start: "2026-10-03",
      end: "2026-10-04",
    });
    expect([...moved.keys()]).toEqual(["Y"]);
  });
});
