import { describe, expect, test } from "vitest";
import {
  cellKind,
  columnsFor,
  dueState,
  filterRows,
  groupRows,
  matchesWhere,
  monthGrid,
  normalizeDate,
  rowsByDate,
  selectOptions,
  shiftMonth,
  sortRows,
} from "./derive.ts";
import type { DatabaseSpec, DbRow, Spec } from "./model.ts";

const row = (
  title: string,
  values: Record<string, unknown> = {},
  over: Partial<DbRow> = {},
): DbRow => ({
  id: title,
  kind: "page",
  page: title,
  title,
  values,
  modified: "t",
  ...over,
});

const spec = (over: Partial<Spec> = {}): Spec => ({
  source: { kind: "projects" },
  view: "table",
  group: "status",
  date: "due",
  where: {},
  limit: 500,
  weekStart: 0,
  ...over,
});

describe("dates", () => {
  test("normalizeDate takes ISO dates, with or without a time, and nothing else", () => {
    expect(normalizeDate("2026-10-02")).toBe("2026-10-02");
    expect(normalizeDate("2026-10-02T09:00:00Z")).toBe("2026-10-02");
    expect(normalizeDate(" 2026-10-02 ")).toBe("2026-10-02");
    for (const bad of [
      "2026-02-30",
      "10/02/2026",
      "",
      null,
      undefined,
      20261002,
    ]) {
      expect(normalizeDate(bad)).toBeUndefined();
    }
  });

  test("dueState", () => {
    const today = "2026-10-02";
    expect(dueState("2026-10-01", today)).toBe("overdue");
    expect(dueState("2026-10-02", today)).toBe("today");
    expect(dueState("2026-10-05", today)).toBe("soon");
    expect(dueState("2026-10-06", today)).toBe("later");
    expect(dueState(undefined, today)).toBe("none");
    expect(dueState("garbage", today)).toBe("none");
    expect(dueState("2026-11-05", "2026-10-30")).toBe("later"); // across a month end
    expect(dueState("2026-11-01", "2026-10-31")).toBe("soon");
    expect(dueState("2027-01-01", "2026-12-31")).toBe("soon"); // across a year end
  });
});

describe("sortRows", () => {
  const rows = [
    row("b", { due: "2026-10-05" }),
    row("a", { due: "2026-10-01" }),
    row("none"),
    row("c", { due: "2026-10-09" }),
  ];
  test("ascending, with the rows that have no value last", () => {
    expect(
      sortRows(rows, { key: "due", desc: false }).map((r) => r.title),
    ).toEqual(["a", "b", "c", "none"]);
  });
  test("descending keeps the empty ones last too", () => {
    expect(
      sortRows(rows, { key: "due", desc: true }).map((r) => r.title),
    ).toEqual(["c", "b", "a", "none"]);
  });
  test("by title, numbers in the text sorting as numbers", () => {
    const named = [row("item 10"), row("item 2"), row("item 1")];
    expect(
      sortRows(named, { key: "title", desc: false }).map((r) => r.title),
    ).toEqual(["item 1", "item 2", "item 10"]);
  });
  test("no sort keeps the order, and never changes the input", () => {
    const input = [row("z"), row("y")];
    expect(sortRows(input, undefined).map((r) => r.title)).toEqual(["z", "y"]);
    sortRows(input, { key: "title", desc: false });
    expect(input.map((r) => r.title)).toEqual(["z", "y"]);
  });
  test("numbers and booleans", () => {
    const nums = [row("a", { n: 10 }), row("b", { n: 9 })];
    expect(
      sortRows(nums, { key: "n", desc: false }).map((r) => r.title),
    ).toEqual(["b", "a"]);
    const bools = [row("t", { d: true }), row("f", { d: false })];
    expect(
      sortRows(bools, { key: "d", desc: false }).map((r) => r.title),
    ).toEqual(["f", "t"]);
  });
});

describe("filterRows and matchesWhere", () => {
  const rows = [
    row("Android release", {
      area: "プロダクト開発",
      tags: ["project", "app"],
    }),
    row("Denim page", { area: "オンライン販売" }),
  ];
  test("every word must be somewhere in the row", () => {
    expect(filterRows(rows, "android 開発").map((r) => r.title)).toEqual([
      "Android release",
    ]);
    expect(filterRows(rows, "app").map((r) => r.title)).toEqual([
      "Android release",
    ]);
    expect(filterRows(rows, "zzz")).toEqual([]);
    expect(filterRows(rows, "  ")).toHaveLength(2);
  });
  test("where compares as text, and looks inside lists", () => {
    expect(matchesWhere(rows[0], { area: "プロダクト開発" })).toBe(true);
    expect(matchesWhere(rows[0], { tags: "app" })).toBe(true);
    expect(matchesWhere(rows[1], { tags: "app" })).toBe(false);
    expect(matchesWhere(row("x", { done: false }), { done: false })).toBe(true);
    expect(matchesWhere(row("x"), {})).toBe(true);
  });
});

describe("groupRows", () => {
  const rows = [
    row("p1", { status: "done" }),
    row("p2", { status: "active" }),
    row("p3", { status: "waiting" }),
    row("p4"),
    row("p5", { status: "active" }),
  ];
  test("status runs active, someday, done, then whatever else, then (なし)", () => {
    const groups = groupRows(rows, "status");
    expect(groups.map((g) => [g.key, g.rows.map((r) => r.title)])).toEqual([
      ["active", ["p2", "p5"]],
      ["someday", []],
      ["done", ["p1"]],
      ["waiting", ["p3"]],
      ["", ["p4"]],
    ]);
    expect(groups.at(-1)!.label).toBe("(なし)");
  });
  test("an explicit order is shown whole, even where empty", () => {
    const groups = groupRows(rows, "status", ["waiting", "active", "later"]);
    expect(groups.map((g) => g.key)).toEqual([
      "waiting",
      "active",
      "later",
      "done",
      "",
    ]);
  });
  test("another field has no default order: first appearance", () => {
    const areas = [
      row("a", { area: "B" }),
      row("b", { area: "A" }),
      row("c", { area: "B" }),
    ];
    expect(groupRows(areas, "area").map((g) => g.key)).toEqual(["B", "A"]);
  });
  test("no empty column when nothing lacks a value", () => {
    expect(
      groupRows([row("a", { status: "active" })], "status").some(
        (g) => g.key === "",
      ),
    ).toBe(false);
  });
  test("a list value goes by its first entry", () => {
    expect(groupRows([row("a", { tags: ["x", "y"] })], "tags")[0].key).toBe(
      "x",
    );
  });
});

describe("calendar", () => {
  test("a month is whole weeks, padded with the days around it", () => {
    const grid = monthGrid(2026, 10, 0); // October 2026 starts on a Thursday
    expect(grid.every((w) => w.length === 7)).toBe(true);
    expect(grid[0][0]).toEqual({ iso: "2026-09-27", day: 27, inMonth: false });
    expect(grid[0][4]).toEqual({ iso: "2026-10-01", day: 1, inMonth: true });
    expect(grid.at(-1)!.at(-1)!.iso).toBe("2026-10-31");
    expect(grid).toHaveLength(5);
  });
  test("a week can start on Monday", () => {
    const grid = monthGrid(2026, 10, 1);
    expect(grid[0][0].iso).toBe("2026-09-28");
    expect(grid[0][3].iso).toBe("2026-10-01");
  });
  test("a month that needs six weeks has six", () => {
    expect(monthGrid(2026, 8, 0)).toHaveLength(6); // 1 Aug 2026 is a Saturday
  });
  test("February of a leap year", () => {
    const days = monthGrid(2028, 2, 0)
      .flat()
      .filter((d) => d.inMonth);
    expect(days).toHaveLength(29);
  });
  test("shiftMonth crosses years both ways", () => {
    expect(shiftMonth(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
    expect(shiftMonth(2026, 1, -1)).toEqual({ year: 2025, month: 12 });
    expect(shiftMonth(2026, 10, 14)).toEqual({ year: 2027, month: 12 });
    expect(shiftMonth(2026, 3, 0)).toEqual({ year: 2026, month: 3 });
  });
  test("rowsByDate keeps the undated apart", () => {
    const rows = [
      row("a", { due: "2026-10-02" }),
      row("b", { due: "2026-10-02" }),
      row("c"),
      row("d", { due: "soon" }),
    ];
    const { byDay, undated } = rowsByDate(rows, "due");
    expect(byDay.get("2026-10-02")!.map((r) => r.title)).toEqual(["a", "b"]);
    expect(undated.map((r) => r.title)).toEqual(["c", "d"]);
  });
});

describe("columns", () => {
  test("cellKind by name and by what the column holds", () => {
    expect(cellKind("status", [])).toBe("select");
    expect(cellKind("due", [])).toBe("date");
    expect(cellKind("startDate", [])).toBe("date");
    expect(cellKind("done", [row("a", { done: true })])).toBe("boolean");
    expect(cellKind("count", [row("a", { count: 3 })])).toBe("number");
    expect(cellKind("note", [row("a", { note: "x" })])).toBe("text");
    expect(cellKind("note", [])).toBe("text");
  });
  test("projects have their usual columns; the name and the counts cannot be edited in place", () => {
    const cols = columnsFor([row("a", { status: "active" })], spec());
    expect(cols.map((c) => c.key)).toEqual([
      "title",
      "status",
      "due",
      "area",
      "goal",
      "openTasks",
    ]);
    expect(cols.find((c) => c.key === "title")!.editable).toBe(false);
    expect(cols.find((c) => c.key === "openTasks")!.editable).toBe(false);
    expect(cols.find((c) => c.key === "status")).toMatchObject({
      editable: true,
      kind: "select",
      label: "状態",
    });
    expect(cols.find((c) => c.key === "status")!.options).toEqual([
      "active",
      "someday",
      "done",
    ]);
  });
  test("tasks: done is a checkbox", () => {
    const cols = columnsFor([], spec({ source: { kind: "tasks" } }));
    expect(cols.find((c) => c.key === "done")).toMatchObject({
      kind: "boolean",
      editable: true,
    });
  });
  test("a tag source shows what its pages have", () => {
    const cols = columnsFor(
      [row("a", { x: 1 }), row("b", { y: "z" })],
      spec({ source: { kind: "tag", tag: "t" } }),
    );
    expect(cols.map((c) => c.key)).toEqual(["title", "x", "y"]);
  });
  test("the spec's columns win", () => {
    expect(
      columnsFor([], spec({ columns: ["due", "title"] })).map((c) => c.key),
    ).toEqual(["due", "title"]);
  });
  test("selectOptions: the order, the usual, then what is used", () => {
    const rows = [
      row("a", { status: "waiting" }),
      row("b", { status: "active" }),
    ];
    expect(selectOptions("status", rows, {})).toEqual([
      "active",
      "someday",
      "done",
      "waiting",
    ]);
    expect(selectOptions("status", rows, { order: ["waiting"] })).toEqual([
      "waiting",
      "active",
    ]);
  });
});

describe("a database's declared properties", () => {
  const database: DatabaseSpec = {
    name: "projects",
    tag: "project",
    folder: "Projects/",
    properties: [
      { key: "kind", type: "select", options: ["x", "y"], label: "種類" },
      { key: "when", type: "date" },
      { key: "area", type: "page" },
      { key: "size", type: "number" },
      { key: "flag", type: "boolean" },
    ],
  };
  const rows = [
    row("A", { kind: "z", when: "2026-10-01", size: "big", extra: 1 }),
  ];

  test("cellKind is what is declared, a page link being edited as text", () => {
    expect(cellKind("kind", rows, database)).toBe("select");
    expect(cellKind("when", rows, database)).toBe("date");
    expect(cellKind("area", rows, database)).toBe("text");
    expect(cellKind("size", rows, database)).toBe("number"); // not what the rows hold
    expect(cellKind("flag", rows, database)).toBe("boolean");
    // Undeclared keys are still guessed.
    expect(cellKind("extra", rows, database)).toBe("number");
    expect(cellKind("kind", rows)).toBe("text");
  });

  test("selectOptions are the declared ones, nothing else", () => {
    expect(selectOptions("kind", rows, { database })).toEqual(["x", "y"]);
    expect(selectOptions("kind", rows, { order: ["q"], database })).toEqual([
      "x",
      "y",
    ]);
    expect(selectOptions("kind", rows, {})).toEqual(["z"]);
  });

  test("the default columns are the title and the declared keys, labelled", () => {
    const columns = columnsFor(
      rows,
      spec({ source: { kind: "tag", tag: "project" }, database }),
    );
    expect(columns.map((c) => c.key)).toEqual([
      "title",
      "kind",
      "when",
      "area",
      "size",
      "flag",
    ]);
    expect(columns[1]).toEqual({
      key: "kind",
      label: "種類",
      kind: "select",
      editable: true,
      options: ["x", "y"],
    });
    expect(columns[2]).toMatchObject({ label: "when", kind: "date" });
    expect(columns[3]).toMatchObject({
      kind: "text",
      editable: true,
      link: true,
    });
    expect(columns[1].link).toBeUndefined();
  });

  test("the block's own columns still win", () => {
    expect(
      columnsFor(rows, spec({ database, columns: ["title", "extra"] })).map(
        (c) => c.key,
      ),
    ).toEqual(["title", "extra"]);
  });
});
