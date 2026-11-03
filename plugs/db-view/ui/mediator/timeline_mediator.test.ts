// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada
import { describe, expect, test } from "vitest";
import type { DatabaseSpec, DbRow, Spec } from "../../src/model.ts";
import {
  type DbEffect,
  type DbEvent,
  type DbState,
  initialState,
  selectView,
  transition,
  viewDirty,
} from "./db_mediator.ts";
import { dateChanges, spanLabel } from "./timeline_mediator.ts";

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
  modified: "m1",
  ...over,
});

const database: DatabaseSpec = {
  name: "todos",
  tag: "todo",
  folder: "Tasks/",
  properties: [{ key: "due", type: "date" }],
};

const spec = (over: Partial<Spec> = {}): Spec => ({
  source: { kind: "tag", tag: "todo" },
  view: "timeline",
  group: "status",
  date: "due",
  where: {},
  limit: 500,
  weekStart: 0,
  ...over,
});

const rows = [
  row("A", { start: "2026-10-01", due: "2026-10-05", status: "next" }),
  row("B", { start: "2026-10-06", due: "2026-10-08", blockedBy: ["[[A]]"] }),
  row("U", { status: "inbox" }),
];

const start = (over: Partial<Spec> = {}, r = rows, children: DbRow[] = []) =>
  initialState({
    spec: spec(over),
    rows: r,
    children,
    truncated: false,
    today: "2026-10-02",
  });

function run(events: DbEvent[], from: DbState = start()) {
  let state = from;
  const effects: DbEffect[] = [];
  for (const event of events) {
    const next = transition(state, event);
    state = next.state;
    effects.push(...next.effects);
  }
  return { state, effects };
}

const writesOf = (effects: DbEffect[]) =>
  effects.flatMap((e) =>
    e.type === "writeMany"
      ? e.writes.map(
          (w) =>
            `${w.row.id} ${w.changes.map((c) => `${c.key}=${JSON.stringify(c.value)}`).join(" ")}`,
        )
      : [],
  );

describe("opening", () => {
  test("opens at week zoom on today, with the table shown", () => {
    const s = start();
    expect(s.timeline).toMatchObject({
      zoom: "week",
      showTable: true,
      focus: { day: "2026-10-02" },
    });
    expect(s.timeline.window.from <= "2026-09-17").toBe(true);
    expect(s.timeline.group).toBeUndefined();
  });

  test("groups only when the block names a group", () => {
    expect(start({ grouped: true }).timeline.group).toBe("status");
    expect(start({ zoom: "month" }).timeline.zoom).toBe("month");
  });

  test("paints lines in start order, the undated last, and its arrows", () => {
    const view = selectView(start()).timeline!;
    expect(
      view.lines.map((l) => (l.type === "row" ? l.row.id : l.key)),
    ).toEqual(["A", "B", "U"]);
    expect(view.edges).toEqual([
      { from: "A", to: "B", late: false, fromLine: 0, toLine: 1 },
    ]);
    expect(view.undated.map((r) => r.id)).toEqual(["U"]);
    expect(view.todayX).not.toBeNull();
  });
});

describe("dragging a bar", () => {
  test("a move writes both dates and pushes what it now blocks", () => {
    const { state, effects } = run([
      { type: "tl.bar.drag", rowId: "A", edge: "move" },
      { type: "tl.bar.over", delta: 2 },
    ]);
    // While dragging, the preview shows both bars where they will go.
    const preview = selectView(state).timeline!.preview;
    expect(preview.get("A")).toEqual({
      start: "2026-10-03",
      end: "2026-10-07",
    });
    expect(preview.get("B")).toEqual({
      start: "2026-10-08",
      end: "2026-10-10",
    });
    expect(effects).toEqual([]);
    const done = run([{ type: "tl.bar.drop" }], state);
    expect(done.state.mode.kind).toBe("writing");
    expect(writesOf(done.effects)).toEqual([
      'A start="2026-10-03" due="2026-10-07"',
      'B start="2026-10-08" due="2026-10-10"',
    ]);
    expect(done.state.pending?.label).toBe(
      "Moved to Oct 3 – Oct 7 · 1 pushed later",
    );
  });

  test("an end dragged back stops at the start; nothing moved writes nothing", () => {
    const { effects } = run([
      { type: "tl.bar.drag", rowId: "A", edge: "end" },
      { type: "tl.bar.over", delta: -9 },
      { type: "tl.bar.drop" },
    ]);
    expect(writesOf(effects)).toEqual([
      'A start="2026-10-01" due="2026-10-01"',
    ]);
    const none = run([
      { type: "tl.bar.drag", rowId: "A", edge: "move" },
      { type: "tl.bar.drop" },
    ]);
    expect(none.effects).toEqual([]);
    expect(none.state.mode.kind).toBe("idle");
  });

  test("an undated row cannot be dragged as a bar; Esc cancels a drag", () => {
    expect(
      run([{ type: "tl.bar.drag", rowId: "U", edge: "move" }]).state.mode.kind,
    ).toBe("idle");
    const { state } = run([
      { type: "tl.bar.drag", rowId: "A", edge: "move" },
      { type: "tl.bar.over", delta: 3 },
      { type: "tl.cancel" },
    ]);
    expect(state.mode.kind).toBe("idle");
  });

  test("the keyboard nudges a day", () => {
    const { effects } = run([
      { type: "tl.bar.nudge", rowId: "B", edge: "end", delta: 1 },
    ]);
    expect(writesOf(effects)).toEqual([
      'B start="2026-10-06" due="2026-10-09"',
    ]);
  });

  test("a one-day row keeps to its due date unless it grows", () => {
    const r = row("D", { due: "2026-10-04" });
    expect(
      dateChanges(
        r,
        {
          start: "start",
          end: "due",
          parent: "parent",
          dependsOn: "blockedBy",
        },
        {
          start: "2026-10-05",
          end: "2026-10-05",
        },
      ),
    ).toEqual([{ key: "due", kind: "date", value: "2026-10-05" }]);
    expect(spanLabel({ start: "2026-10-05", end: "2026-10-05" })).toBe("Oct 5");
  });
});

describe("landing and Undo", () => {
  test("the written values show, then Undo writes the old ones back", () => {
    const moved = run([
      { type: "tl.bar.drag", rowId: "A", edge: "move" },
      { type: "tl.bar.over", delta: 2 },
      { type: "tl.bar.drop" },
      {
        type: "tl.written",
        results: [
          {
            rowId: "A",
            modified: "m2",
            changes: [
              { key: "start", kind: "date", value: "2026-10-03" },
              { key: "due", kind: "date", value: "2026-10-07" },
            ],
          },
          {
            rowId: "B",
            modified: "m3",
            changes: [
              { key: "start", kind: "date", value: "2026-10-08" },
              { key: "due", kind: "date", value: "2026-10-10" },
            ],
          },
        ],
      },
    ]);
    const a = moved.state.rows.find((r) => r.id === "A")!;
    expect(a.values.due).toBe("2026-10-07");
    expect(a.modified).toBe("m2");
    expect(moved.state.undo?.label).toBe(
      "Moved to Oct 3 – Oct 7 · 1 pushed later",
    );
    expect(moved.effects.map((e) => e.type)).toContain("timer");

    const undone = run([{ type: "undo.run" }], moved.state);
    expect(writesOf(undone.effects)).toEqual([
      'A start="2026-10-01" due="2026-10-05"',
      'B start="2026-10-06" due="2026-10-08"',
    ]);
    const effect = undone.effects[0] as Extract<
      DbEffect,
      { type: "writeMany" }
    >;
    expect(effect.writes[0].row.modified).toBe("m2");
    // The undo's own write offers no further Undo.
    expect(undone.state.pending).toBeUndefined();
  });

  test("a failed write leaves the rows as they were", () => {
    const { state } = run([
      { type: "tl.bar.nudge", rowId: "A", edge: "move", delta: 1 },
      { type: "write.failed", reason: "stale", message: "changed" },
    ]);
    expect(state.mode.kind).toBe("idle");
    expect(state.pending).toBeUndefined();
    expect(state.rows[0].values.due).toBe("2026-10-05");
  });
});

describe("dates for the undated, and new rows", () => {
  test("placing an undated row sets its due date", () => {
    const click = run([{ type: "tl.place", rowId: "U", day: "2026-10-09" }]);
    expect(writesOf(click.effects)).toEqual(['U due="2026-10-09"']);
    const drag = run([
      { type: "tl.place.drag", rowId: "U" },
      { type: "tl.place.over", day: "2026-10-12" },
      { type: "tl.place.drop" },
    ]);
    expect(writesOf(drag.effects)).toEqual(['U due="2026-10-12"']);
  });

  test("drawing on the lane opens the new-row input with the span", () => {
    const s = start({ database });
    const { state } = run(
      [
        { type: "tl.draw.start", day: "2026-10-12" },
        { type: "tl.draw.over", day: "2026-10-09" },
      ],
      s,
    );
    expect(selectView(state).timeline!.drawing).toEqual({
      start: "2026-10-09",
      end: "2026-10-12",
    });
    const done = run([{ type: "tl.draw.drop" }], state);
    expect(done.state.mode).toEqual({
      kind: "creating",
      at: "timeline",
      values: { start: "2026-10-09", due: "2026-10-12" },
    });
    const created = run([{ type: "row.create", title: "New" }], done.state);
    expect(created.effects).toEqual([
      {
        type: "create",
        title: "New",
        values: { start: "2026-10-09", due: "2026-10-12" },
        open: false,
      },
    ]);
  });

  test("no drawing without a database", () => {
    expect(
      run([{ type: "tl.draw.start", day: "2026-10-12" }]).state.mode.kind,
    ).toBe("idle");
  });
});

describe("dependencies", () => {
  test("pulling a link from A to U makes U wait for A", () => {
    const { effects } = run([
      { type: "tl.link.start", rowId: "A" },
      { type: "tl.link.over", target: "U" },
      { type: "tl.link.drop" },
    ]);
    expect(writesOf(effects)).toEqual(['U blockedBy=["[[A]]"]']);
  });

  test("a link that exists, or would close a loop, is not written", () => {
    const again = run([
      { type: "tl.link.start", rowId: "A" },
      { type: "tl.link.over", target: "B" },
      { type: "tl.link.drop" },
    ]);
    expect(again.effects).toEqual([]);
    const loop = run([
      { type: "tl.link.start", rowId: "B" },
      { type: "tl.link.over", target: "A" },
      { type: "tl.link.drop" },
    ]);
    expect(loop.effects).toEqual([]);
    expect(loop.state.notice?.text).toContain("loop");
  });

  test("an arrow's menu removes it", () => {
    const { state, effects } = run([
      { type: "tl.dep.menu", from: "A", to: "B" },
      { type: "tl.dep.remove" },
    ]);
    expect(writesOf(effects)).toEqual(["B blockedBy=null"]);
    expect(state.pending?.label).toBe("B no longer waits for A");
  });
});

describe("projects and their tasks", () => {
  const projects = [row("Projects/P", { status: "active" })];
  const children = [
    row(
      "Tasks/T1",
      { start: "2026-10-03", due: "2026-10-06", status: "done" },
      { parentId: "Projects/P" },
    ),
    row(
      "Projects/P@10",
      { due: "2026-10-20", done: false },
      {
        kind: "task",
        page: "Projects/P",
        parentId: "Projects/P",
        range: [10, 30],
      },
    ),
  ];

  test("a project rolls its tasks up, folded until opened", () => {
    const s = start({ source: { kind: "projects" } }, projects, children);
    let view = selectView(s).timeline!;
    expect(view.lines).toHaveLength(1);
    expect(view.lines[0]).toMatchObject({
      children: 2,
      collapsed: true,
      rollup: {
        span: { start: "2026-10-03", end: "2026-10-20" },
        done: 1,
        total: 2,
      },
    });
    expect(view.undated).toEqual([]);
    const opened = run([{ type: "tl.fold", key: "r:Projects/P" }], s).state;
    view = selectView(opened).timeline!;
    expect(
      view.lines.map((l) => (l.type === "row" ? `${l.depth}${l.row.id}` : "")),
    ).toEqual(["0Projects/P", "1Tasks/T1", "1Projects/P@10"]);
  });

  test("a task under a project is written on its line; a reload keeps the children", () => {
    const s = start({ source: { kind: "projects" } }, projects, children);
    const { effects } = run(
      [
        {
          type: "tl.bar.nudge",
          rowId: "Projects/P@10",
          edge: "move",
          delta: 1,
        },
      ],
      s,
    );
    expect(writesOf(effects)).toEqual(['Projects/P@10 due="2026-10-21"']);
    const loaded = run(
      [
        {
          type: "rows.loaded",
          rows: projects,
          children: children.slice(0, 1),
          truncated: false,
          today: "2026-10-02",
        },
      ],
      s,
    ).state;
    expect(loaded.children.map((r) => r.id)).toEqual(["Tasks/T1"]);
  });
});

describe("toolbar and Save view", () => {
  test("zoom, today, table width and grouping", () => {
    const { state } = run([
      { type: "tl.zoom", zoom: "month" },
      { type: "tl.today" },
      { type: "tl.table.width", width: 9000 },
      { type: "tl.group", key: "status" },
      { type: "tl.undated" },
    ]);
    expect(state.timeline).toMatchObject({
      zoom: "month",
      tableWidth: 640,
      group: "status",
      showUndated: true,
    });
    expect(state.timeline.focus.seq).toBe(3);
    expect(selectView(state).timeline!.lines[0]).toMatchObject({
      type: "group",
      key: "next",
    });
  });

  test("a new zoom is something to save, with the grouping", () => {
    const s = { ...start(), block: { page: "P", body: "view: timeline" } };
    const { state } = run([{ type: "tl.zoom", zoom: "quarter" }], s);
    expect(viewDirty(state)).toBe(true);
    const saved = run(
      [{ type: "tl.group", key: "status" }, { type: "view.save" }],
      state,
    );
    expect(saved.effects).toEqual([
      {
        type: "saveView",
        view: "timeline",
        sort: undefined,
        filter: "",
        zoom: "quarter",
        group: "status",
      },
    ]);
    const after = run([{ type: "view.saved", body: "x" }], saved.state).state;
    expect(after.spec).toMatchObject({
      zoom: "quarter",
      group: "status",
      grouped: true,
    });
    expect(viewDirty(after)).toBe(false);
  });
});
