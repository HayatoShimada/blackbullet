import { describe, expect, test } from "vitest";
import type { DatabaseSpec, DbRow, Spec } from "../../src/model.ts";
import {
  type DbEvent,
  type DbState,
  initialState,
  selectView,
  transition,
} from "./db_mediator.ts";

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

const spec = (over: Partial<Spec> = {}): Spec => ({
  source: { kind: "projects" },
  view: "board",
  group: "status",
  date: "due",
  where: {},
  limit: 500,
  weekStart: 0,
  ...over,
});

const rows = [
  row("A", { status: "active", due: "2026-10-05" }),
  row("B", { status: "done" }),
  row("C", { status: "active", due: "2026-10-01" }),
];

const start = (over: Partial<Spec> = {}, r = rows) =>
  initialState({
    spec: spec(over),
    rows: r,
    truncated: false,
    today: "2026-10-02",
  });

function run(events: DbEvent[], from: DbState = start()) {
  let state = from;
  const effects = [];
  for (const event of events) {
    const next = transition(state, event);
    state = next.state;
    effects.push(...next.effects);
  }
  return { state, effects };
}

describe("view state", () => {
  test("starts on the spec's view, in today's month", () => {
    const s = start({ view: "calendar" });
    expect(s.view).toBe("calendar");
    expect(s.month).toEqual({ year: 2026, month: 10 });
  });
  test("the view, the phrase and the month change", () => {
    const s = run([
      { type: "view.set", view: "table" },
      { type: "phrase.set", phrase: "A" },
      { type: "month.shift", delta: 3 },
    ]).state;
    expect(s).toMatchObject({
      view: "table",
      phrase: "A",
      month: { year: 2027, month: 1 },
    });
    expect(
      run([{ type: "month.shift", delta: -10 }, { type: "month.today" }]).state
        .month,
    ).toEqual({
      year: 2026,
      month: 10,
    });
  });
  test("a sort goes ascending, descending, then off", () => {
    const toggle = (s: DbState) =>
      transition(s, { type: "sort.toggle", key: "due" }).state;
    const a = toggle(start());
    expect(a.sort).toEqual({ key: "due", desc: false });
    const b = toggle(a);
    expect(b.sort).toEqual({ key: "due", desc: true });
    expect(toggle(b).sort).toBeUndefined();
    const other = transition(a, { type: "sort.toggle", key: "title" }).state;
    expect(other.sort).toEqual({ key: "title", desc: false });
  });
});

describe("editing a cell", () => {
  test("only an editable cell can be edited", () => {
    const s = start({ view: "table" });
    expect(
      run([{ type: "cell.edit", rowId: "A", column: "status" }], s).state.mode,
    ).toEqual({
      kind: "editing",
      rowId: "A",
      column: "status",
    });
    expect(
      run([{ type: "cell.edit", rowId: "A", column: "title" }], s).state.mode,
    ).toEqual({ kind: "idle" });
    expect(
      run([{ type: "cell.edit", rowId: "nope", column: "status" }], s).state
        .mode,
    ).toEqual({ kind: "idle" });
  });

  test("committing a change writes it, and nothing else can start meanwhile", () => {
    const { state, effects } = run([
      { type: "cell.edit", rowId: "A", column: "status" },
      { type: "cell.commit", rowId: "A", column: "status", value: "done" },
    ]);
    expect(state.mode).toEqual({ kind: "writing" });
    expect(effects).toEqual([
      {
        type: "write",
        row: rows[0],
        column: "status",
        kind: "select",
        value: "done",
      },
    ]);
    expect(
      transition(state, { type: "cell.edit", rowId: "B", column: "status" })
        .state,
    ).toBe(state);
    expect(
      transition(state, {
        type: "cell.commit",
        rowId: "B",
        column: "status",
        value: "x",
      }).effects,
    ).toEqual([]);
    expect(transition(state, { type: "card.drag", rowId: "B" }).state).toBe(
      state,
    );
  });

  test("committing what is already there writes nothing", () => {
    const { state, effects } = run([
      { type: "cell.edit", rowId: "A", column: "status" },
      { type: "cell.commit", rowId: "A", column: "status", value: "active" },
    ]);
    expect(state.mode).toEqual({ kind: "idle" });
    expect(effects).toEqual([]);
  });

  test("an empty text over an empty cell is no change either", () => {
    expect(
      run([{ type: "cell.commit", rowId: "B", column: "due", value: " " }])
        .effects,
    ).toEqual([]);
  });

  test("cancelling leaves the cell alone", () => {
    const { state, effects } = run([
      { type: "cell.edit", rowId: "A", column: "status" },
      { type: "cell.cancel" },
    ]);
    expect(state.mode).toEqual({ kind: "idle" });
    expect(effects).toEqual([]);
  });

  test("a checkbox is committed straight away, without an edit mode", () => {
    const tasks = [
      row("T1", { done: false }, { kind: "task", range: [3, 9], state: " " }),
    ];
    const { effects, state } = run(
      [{ type: "cell.commit", rowId: "T1", column: "done", value: true }],
      start({ source: { kind: "tasks" }, view: "table" }, tasks),
    );
    expect(state.mode).toEqual({ kind: "writing" });
    expect(effects[0]).toMatchObject({
      type: "write",
      column: "done",
      kind: "boolean",
      value: true,
    });
  });
});

describe("dragging a card", () => {
  test("onto a board column sets the group's attribute", () => {
    const { state, effects } = run([
      { type: "card.drag", rowId: "A" },
      { type: "card.over", target: "done" },
      { type: "card.drop", target: "done" },
    ]);
    expect(state.mode).toEqual({ kind: "writing" });
    expect(effects).toEqual([
      {
        type: "write",
        row: rows[0],
        column: "status",
        kind: "select",
        value: "done",
      },
    ]);
  });

  test("onto the empty column clears it", () => {
    expect(
      run([
        { type: "card.drag", rowId: "A" },
        { type: "card.drop", target: "" },
      ]).effects[0],
    ).toMatchObject({ column: "status", value: "" });
  });

  test("onto a calendar day sets the date's attribute", () => {
    const { effects } = run(
      [
        { type: "card.drag", rowId: "A" },
        { type: "card.drop", target: "2026-10-20" },
      ],
      start({ view: "calendar", date: "due" }),
    );
    expect(effects).toEqual([
      {
        type: "write",
        row: rows[0],
        column: "due",
        kind: "date",
        value: "2026-10-20",
      },
    ]);
  });

  test("dropped where it already is, nothing is written", () => {
    expect(
      run([
        { type: "card.drag", rowId: "A" },
        { type: "card.drop", target: "active" },
      ]).effects,
    ).toEqual([]);
  });

  test("a table has nowhere to drop", () => {
    expect(
      run(
        [
          { type: "card.drag", rowId: "A" },
          { type: "card.drop", target: "done" },
        ],
        start({ view: "table" }),
      ).effects,
    ).toEqual([]);
  });

  test("the card being over a place is remembered, cancelling forgets it", () => {
    const over = run([
      { type: "card.drag", rowId: "A" },
      { type: "card.over", target: "done" },
    ]).state;
    expect(over.mode).toEqual({ kind: "dragging", rowId: "A", over: "done" });
    expect(transition(over, { type: "card.over", target: "done" }).state).toBe(
      over,
    );
    expect(transition(over, { type: "card.cancel" }).state.mode).toEqual({
      kind: "idle",
    });
  });

  test("a drop that never started is ignored", () => {
    expect(run([{ type: "card.drop", target: "done" }]).effects).toEqual([]);
  });
});

describe("what comes back from a write", () => {
  const writing = run([
    { type: "cell.commit", rowId: "A", column: "status", value: "done" },
  ]).state;

  test("a write that landed updates the row and reads everything again", () => {
    const { state, effects } = transition(writing, {
      type: "write.done",
      rowId: "A",
      column: "status",
      value: "done",
      modified: "m2",
    });
    expect(state.mode).toEqual({ kind: "idle" });
    expect(state.rows.find((r) => r.id === "A")).toMatchObject({
      values: { status: "done" },
      modified: "m2",
    });
    expect(effects).toEqual([{ type: "reload" }]);
  });

  test("clearing a value removes it from the row", () => {
    const { state } = transition(writing, {
      type: "write.done",
      rowId: "A",
      column: "due",
      value: null,
      modified: "m2",
    });
    expect(state.rows.find((r) => r.id === "A")!.values).not.toHaveProperty(
      "due",
    );
  });

  test("a conflict says so, and reads again so the screen is no longer old", () => {
    const { state, effects } = transition(writing, {
      type: "write.failed",
      reason: "stale",
      message: "ページが変わっています",
    });
    expect(state.mode).toEqual({ kind: "idle" });
    expect(state.notice).toEqual({
      level: "error",
      text: "ページが変わっています",
    });
    expect(effects).toEqual([{ type: "reload" }]);
    // The row on screen is as it was.
    expect(state.rows.find((r) => r.id === "A")!.values.status).toBe("active");
  });

  test("another failure only says so", () => {
    const { effects, state } = transition(writing, {
      type: "write.failed",
      reason: "invalid",
      message: "x",
    });
    expect(effects).toEqual([]);
    expect(state.notice?.text).toBe("x");
  });

  test("a failure that asks for no read leaves a read in flight alone", () => {
    const reading = { ...writing, reloading: true };
    const { state, effects } = transition(reading, {
      type: "write.failed",
      reason: "invalid",
      message: "x",
    });
    expect(state.reloading).toBe(true);
    expect(effects).toEqual([]);
    // And when it was not reading, it still is not.
    expect(
      transition(writing, {
        type: "write.failed",
        reason: "invalid",
        message: "x",
      }).state.reloading,
    ).toBe(false);
  });

  test("a fresh read replaces the rows", () => {
    const { state } = transition(
      { ...writing, reloading: true },
      {
        type: "rows.loaded",
        rows: [row("Z")],
        truncated: true,
        today: "2026-10-03",
      },
    );
    expect(state).toMatchObject({
      rows: [row("Z")],
      truncated: true,
      today: "2026-10-03",
      reloading: false,
    });
  });

  test("a failed read says so", () => {
    expect(
      transition(start(), { type: "rows.failed", message: "boom" }).state.notice
        ?.text,
    ).toBe("boom");
  });

  test("reload asks once, and not while a write is in flight", () => {
    const asked = transition(start(), { type: "reload" });
    expect(asked.effects).toEqual([{ type: "reload" }]);
    expect(transition(asked.state, { type: "reload" }).effects).toEqual([]);
    expect(transition(writing, { type: "reload" }).effects).toEqual([]);
  });

  test("a notice can be dismissed", () => {
    const s = transition(start(), { type: "rows.failed", message: "x" }).state;
    expect(transition(s, { type: "notice.dismiss" }).state.notice).toBeNull();
  });
});

describe("opening a row", () => {
  test("a page opens as itself, a task where it is written", () => {
    expect(run([{ type: "row.open", rowId: "A" }]).effects).toEqual([
      { type: "navigate", target: "A" },
    ]);
    const tasks = [
      row("T", {}, { kind: "task", page: "Plan", range: [42, 60] }),
    ];
    expect(
      run(
        [{ type: "row.open", rowId: "T" }],
        start({ source: { kind: "tasks" } }, tasks),
      ).effects,
    ).toEqual([{ type: "navigate", target: "Plan@42" }]);
    expect(run([{ type: "row.open", rowId: "none" }]).effects).toEqual([]);
  });
});

describe("selectView", () => {
  test("the board: columns in status order, each by due date", () => {
    const view = selectView(start());
    expect(view.groups.map((g) => [g.key, g.rows.map((r) => r.id)])).toEqual([
      ["active", ["C", "A"]],
      ["someday", []],
      ["done", ["B"]],
    ]);
  });
  test("the phrase filters every view", () => {
    const s = run([{ type: "phrase.set", phrase: "done" }]).state;
    expect(selectView(s).rows.map((r) => r.id)).toEqual(["B"]);
    expect(
      selectView(s)
        .groups.flatMap((g) => g.rows)
        .map((r) => r.id),
    ).toEqual(["B"]);
  });
  test("the table sorts", () => {
    const s = run([{ type: "sort.toggle", key: "due" }]).state;
    expect(selectView(s).rows.map((r) => r.id)).toEqual(["C", "A", "B"]);
  });
  test("the calendar puts rows on their day and keeps the rest apart", () => {
    const view = selectView(start({ view: "calendar" }));
    expect(view.byDay.get("2026-10-05")!.map((r) => r.id)).toEqual(["A"]);
    expect(view.undated.map((r) => r.id)).toEqual(["B"]);
    expect(view.weeks.flat().some((d) => d.iso === "2026-10-05")).toBe(true);
  });
});

describe("+ New", () => {
  const database: DatabaseSpec = {
    name: "projects",
    tag: "project",
    folder: "Projects/",
    properties: [{ key: "area", type: "page" }],
  };
  const withDb = () =>
    start({ source: { kind: "tag", tag: "project" }, database });

  test("opens only with a database, and only when idle", () => {
    expect(run([{ type: "create.open" }], withDb()).state.mode).toEqual({
      kind: "creating",
    });
    expect(run([{ type: "create.open" }]).state.mode).toEqual({ kind: "idle" });
    const editing = run([{ type: "cell.edit", rowId: "A", column: "area" }], {
      ...withDb(),
      view: "table",
    }).state;
    expect(editing.mode.kind).toBe("editing");
    expect(transition(editing, { type: "create.open" }).state).toBe(editing);
  });

  test("cancelling closes the input", () => {
    const { state, effects } = run(
      [{ type: "create.open" }, { type: "create.cancel" }],
      withDb(),
    );
    expect(state.mode).toEqual({ kind: "idle" });
    expect(effects).toEqual([]);
    const idle = start();
    expect(transition(idle, { type: "create.cancel" }).state).toBe(idle);
  });

  test("a title starts the create, and nothing else can start meanwhile", () => {
    const { state, effects } = run(
      [{ type: "create.open" }, { type: "row.create", title: " Launch " }],
      withDb(),
    );
    expect(state.mode).toEqual({ kind: "writing" });
    expect(effects).toEqual([{ type: "create", title: "Launch" }]);
    expect(
      transition(state, { type: "row.create", title: "Again" }).effects,
    ).toEqual([]);
    expect(
      transition(state, { type: "cell.edit", rowId: "A", column: "status" })
        .state,
    ).toBe(state);
  });

  test("an empty title starts nothing, and the input stays open", () => {
    const opened = run([{ type: "create.open" }], withDb()).state;
    const next = transition(opened, { type: "row.create", title: "  " });
    expect(next.state).toBe(opened);
    expect(next.effects).toEqual([]);
  });

  test("without a database a title is ignored", () => {
    expect(run([{ type: "row.create", title: "Launch" }]).effects).toEqual([]);
  });

  test("a row made opens its page and reads again", () => {
    const writing = run(
      [{ type: "create.open" }, { type: "row.create", title: "Launch" }],
      withDb(),
    ).state;
    const { state, effects } = transition(writing, {
      type: "create.done",
      page: "Projects/Launch",
    });
    expect(state.mode).toEqual({ kind: "idle" });
    expect(state.reloading).toBe(true);
    expect(effects).toEqual([
      { type: "navigate", target: "Projects/Launch" },
      { type: "reload" },
    ]);
  });

  test("a failure says so", () => {
    const writing = run(
      [{ type: "create.open" }, { type: "row.create", title: "Launch" }],
      withDb(),
    ).state;
    const { state, effects } = transition(writing, {
      type: "create.failed",
      message: "Projects/Launch はもうあります",
    });
    expect(state.mode).toEqual({ kind: "idle" });
    expect(state.notice).toEqual({
      level: "error",
      text: "Projects/Launch はもうあります",
    });
    expect(effects).toEqual([]);
  });

  test("a page a cell names opens", () => {
    expect(
      run([{ type: "link.open", target: " Areas/X " }], withDb()).effects,
    ).toEqual([{ type: "navigate", target: "Areas/X" }]);
    expect(run([{ type: "link.open", target: "  " }]).effects).toEqual([]);
  });

  test("a write uses the declared kind", () => {
    const { effects } = run(
      [{ type: "cell.commit", rowId: "A", column: "area", value: "Areas/X" }],
      withDb(),
    );
    expect(effects[0]).toMatchObject({ column: "area", kind: "text" });
  });
});
