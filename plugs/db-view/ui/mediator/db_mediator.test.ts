import { describe, expect, test } from "vitest";
import type { DatabaseSpec, DbRow, Spec } from "../../src/model.ts";
import {
  type DbEvent,
  type DbState,
  groupKey,
  initialState,
  newRowGroup,
  newRowOf,
  UNDO_MS,
  viewDirty,
  visibleCount,
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

  test("one click or tap edits, with any pointer, but not on a link", () => {
    const s = start({ view: "table" });
    const tap = (onLink = false) =>
      run([{ type: "cell.tap", rowId: "A", column: "status", onLink }], s).state
        .mode.kind;
    expect(tap()).toBe("editing");
    expect(tap(true)).toBe("idle");
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
      message: "The page changed. Reloaded.",
    });
    expect(state.mode).toEqual({ kind: "idle" });
    expect(state.notice).toEqual({
      level: "error",
      text: "The page changed. Reloaded.",
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

  test("Shift+Enter makes the row without opening it", () => {
    const { effects } = run(
      [
        { type: "create.open" },
        { type: "row.create", title: "Launch", stay: true },
      ],
      withDb(),
    );
    expect(effects).toEqual([{ type: "create", title: "Launch", open: false }]);
    const done = transition(start(), {
      type: "create.done",
      page: "P/L",
      open: false,
    });
    expect(done.effects).toEqual([{ type: "reload" }]);
    expect(
      transition(start(), { type: "create.done", page: "P/L" }).effects,
    ).toEqual([{ type: "navigate", target: "P/L" }, { type: "reload" }]);
  });

  test("a board column's + makes a row with its value, and stays", () => {
    const opened = run([{ type: "create.open", at: "someday" }], withDb());
    expect(opened.state.mode).toEqual({
      kind: "creating",
      at: "someday",
      values: { status: "someday" },
    });
    const { effects } = run(
      [{ type: "row.create", title: "Idea" }],
      opened.state,
    );
    expect(effects).toEqual([
      {
        type: "create",
        title: "Idea",
        values: { status: "someday" },
        open: false,
      },
    ]);
  });

  test("the no-value column starts with nothing", () => {
    const { state } = run([{ type: "create.open", at: "" }], withDb());
    expect(state.mode).toEqual({ kind: "creating", at: "" });
  });

  test("a calendar day's + sets the date attribute", () => {
    const from = start({
      view: "calendar",
      source: { kind: "tag", tag: "project" },
      database,
    });
    const { state, effects } = run(
      [
        { type: "create.open", at: "2026-10-09" },
        { type: "row.create", title: "Ship" },
      ],
      from,
    );
    expect(state.mode).toEqual({ kind: "writing" });
    expect(effects).toEqual([
      {
        type: "create",
        title: "Ship",
        values: { due: "2026-10-09" },
        open: false,
      },
    ]);
  });

  test("a + elsewhere moves the open input; a busy view refuses it", () => {
    const a = run([{ type: "create.open", at: "active" }], withDb()).state;
    expect(
      transition(a, { type: "create.open", at: "done" }).state.mode,
    ).toMatchObject({ at: "done" });
    const writing = run(
      [{ type: "create.open" }, { type: "row.create", title: "x" }],
      withDb(),
    ).state;
    expect(transition(writing, { type: "create.open", at: "done" }).state).toBe(
      writing,
    );
  });

  test("a write names the database whose options it is held to", () => {
    const { effects } = run(
      [
        { type: "card.drag", rowId: "A" },
        { type: "card.drop", target: "done" },
      ],
      withDb(),
    );
    expect(effects[0]).toMatchObject({ type: "write", database: "projects" });
    const bare = run([
      { type: "card.drag", rowId: "A" },
      { type: "card.drop", target: "done" },
    ]);
    expect(bare.effects[0]).not.toHaveProperty("database");
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
    expect(effects).toEqual([{ type: "create", title: "Launch", open: true }]);
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
      message: "A page named Projects/Launch already exists.",
    });
    // The input comes back with what was typed and the reason under it.
    expect(state.mode).toEqual({
      kind: "creating",
      title: "Launch",
      error: "A page named Projects/Launch already exists.",
    });
    expect(state.notice).toBeNull();
    expect(newRowOf(state)).toEqual({
      title: "Launch",
      error: "A page named Projects/Launch already exists.",
      busy: false,
    });
    expect(effects).toEqual([]);
  });

  test("the input stays on screen, read-only, while the create runs", () => {
    const writing = run(
      [
        { type: "create.open", at: "active" },
        { type: "row.create", title: "X" },
      ],
      withDb(),
    ).state;
    expect(newRowOf(writing)).toEqual({ at: "active", title: "X", busy: true });
    expect(newRowOf(start())).toBeNull();
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

describe("row menu", () => {
  const menuOn = (id = "A") => run([{ type: "row.menu", rowId: id }]).state;

  test("the menu opens for a page, and the same button closes it", () => {
    expect(menuOn().mode).toEqual({ kind: "menu", rowId: "A" });
    const s = run([
      { type: "row.menu", rowId: "A" },
      { type: "row.menu", rowId: "A" },
    ]).state;
    expect(s.mode).toEqual({ kind: "idle" });
  });
  test("a task has no menu", () => {
    const s = start({}, [row("T", {}, { kind: "task" })]);
    expect(run([{ type: "row.menu", rowId: "T" }], s).state.mode).toEqual({
      kind: "idle",
    });
  });
  test("rename: start, then a new title writes; unchanged or empty does not", () => {
    const r = run([
      { type: "row.menu", rowId: "A" },
      { type: "row.rename.start", rowId: "A" },
      { type: "row.rename", rowId: "A", title: "  " },
    ]);
    expect(r.state.mode).toEqual({ kind: "renaming", rowId: "A" });
    expect(r.effects).toEqual([]);
    const same = run([{ type: "row.rename", rowId: "A", title: "A" }], r.state);
    expect(same.state.mode).toEqual({ kind: "idle" });
    expect(same.effects).toEqual([]);
    const done = run(
      [{ type: "row.rename", rowId: "A", title: " New " }],
      r.state,
    );
    expect(done.state.mode).toEqual({ kind: "writing" });
    expect(done.effects).toEqual([
      { type: "rowAction", action: "rename", row: rows[0], title: "New" },
    ]);
  });
  test("delete asks first, and only the confirmation deletes", () => {
    const asked = run([
      { type: "row.menu", rowId: "B" },
      { type: "row.delete.ask", rowId: "B" },
    ]);
    // The menu closes; the host's dialog asks.
    expect(asked.state.mode).toEqual({ kind: "confirming", rowId: "B" });
    expect(asked.effects).toEqual([{ type: "confirmTrash", row: rows[1] }]);
    const cancelled = run([{ type: "row.menu.close" }], asked.state);
    expect(cancelled.state.mode).toEqual({ kind: "idle" });
    const done = run([{ type: "row.delete.confirm" }], asked.state);
    expect(done.effects).toEqual([
      { type: "rowAction", action: "delete", row: rows[1] },
    ]);
    // Without the ask, confirm does nothing.
    expect(run([{ type: "row.delete.confirm" }]).effects).toEqual([]);
  });
  test("archive toggles by what the row has; duplicate copies", () => {
    const s = start({}, [row("A"), row("Z", { archived: true })]);
    const a = run(
      [
        { type: "row.menu", rowId: "A" },
        { type: "row.archive", rowId: "A" },
      ],
      s,
    );
    expect(a.effects).toMatchObject([{ action: "archive", archived: true }]);
    const z = run(
      [
        { type: "row.menu", rowId: "Z" },
        { type: "row.archive", rowId: "Z" },
      ],
      s,
    );
    expect(z.effects).toMatchObject([{ action: "archive", archived: false }]);
    const d = run([
      { type: "row.menu", rowId: "A" },
      { type: "row.duplicate", rowId: "A" },
    ]);
    expect(d.effects).toMatchObject([{ action: "duplicate" }]);
    expect(d.state.mode).toEqual({ kind: "writing" });
  });
  test("actions need the menu to be open on that row", () => {
    expect(run([{ type: "row.duplicate", rowId: "A" }]).effects).toEqual([]);
    expect(
      run([
        { type: "row.menu", rowId: "A" },
        { type: "row.duplicate", rowId: "B" },
      ]).effects,
    ).toEqual([]);
  });
  test("done reloads and says so; a stale failure reloads too", () => {
    const writing = run([
      { type: "row.menu", rowId: "A" },
      { type: "row.duplicate", rowId: "A" },
    ]).state;
    const ok = transition(writing, {
      type: "row.done",
      message: "Duplicated",
    });
    expect(ok.effects).toEqual([{ type: "reload" }]);
    expect(ok.state.notice).toEqual({ level: "info", text: "Duplicated" });
    const stale = transition(writing, {
      type: "row.failed",
      reason: "stale",
      message: "x",
    });
    expect(stale.effects).toEqual([{ type: "reload" }]);
    expect(stale.state.notice?.level).toBe("error");
    const failed = transition(writing, {
      type: "row.failed",
      reason: "failed",
      message: "x",
    });
    expect(failed.effects).toEqual([]);
    expect(failed.state.mode).toEqual({ kind: "idle" });
  });
});

describe("save view", () => {
  const block = { page: "Home", body: "source: projects" };
  const withBlock = (over: Partial<Spec> = {}) => ({
    ...start(over),
    block,
  });

  test("the block's filter is the phrase to start with", () => {
    expect(start({ filter: "app" }).phrase).toBe("app");
  });
  test("nothing to save until the view differs from the block", () => {
    const s = withBlock({ view: "table" });
    expect(viewDirty(s)).toBe(false);
    expect(run([{ type: "view.save" }], s).effects).toEqual([]);
    expect(viewDirty(run([{ type: "view.set", view: "board" }], s).state)).toBe(
      true,
    );
    expect(viewDirty(run([{ type: "phrase.set", phrase: "x" }], s).state)).toBe(
      true,
    );
    expect(viewDirty(run([{ type: "sort.toggle", key: "due" }], s).state)).toBe(
      true,
    );
  });
  test("saving sends the tab, sort and trimmed phrase, and waits", () => {
    const { state, effects } = run(
      [
        { type: "view.set", view: "calendar" },
        { type: "sort.toggle", key: "due" },
        { type: "phrase.set", phrase: " app " },
        { type: "view.save" },
      ],
      withBlock({ view: "table" }),
    );
    expect(effects).toEqual([
      {
        type: "saveView",
        view: "calendar",
        sort: { key: "due", desc: false },
        filter: "app",
      },
    ]);
    expect(state.mode).toEqual({ kind: "writing" });
  });
  test("without a block there is nowhere to save", () => {
    const s = run([{ type: "view.set", view: "calendar" }]).state;
    expect(run([{ type: "view.save" }], s).effects).toEqual([]);
  });
  test("once saved the view is clean and the block body is the new one", () => {
    const { state } = run(
      [
        { type: "view.set", view: "calendar" },
        { type: "phrase.set", phrase: "x" },
        { type: "view.save" },
        { type: "view.saved", body: "source: projects\nview: calendar" },
      ],
      withBlock({ view: "table" }),
    );
    expect(viewDirty(state)).toBe(false);
    expect(state.mode).toEqual({ kind: "idle" });
    expect(state.block?.body).toBe("source: projects\nview: calendar");
    expect(state.notice?.level).toBe("info");
  });
  test("edits during a save stay dirty: spec records what was written", () => {
    const { state } = run(
      [
        { type: "view.set", view: "calendar" },
        { type: "view.save" },
        { type: "view.set", view: "board" },
        { type: "phrase.set", phrase: "later" },
        { type: "view.saved", body: "source: projects\nview: calendar" },
      ],
      withBlock({ view: "table" }),
    );
    expect(state.spec.view).toBe("calendar");
    expect(state.view).toBe("board");
    expect(viewDirty(state)).toBe(true);
  });
  test("a refused save keeps the view dirty and says why", () => {
    const { state } = run(
      [
        { type: "view.set", view: "calendar" },
        { type: "view.save" },
        { type: "view.save.failed", message: "changed" },
      ],
      withBlock({ view: "table" }),
    );
    expect(viewDirty(state)).toBe(true);
    expect(state.notice).toEqual({ level: "error", text: "changed" });
    expect(state.mode).toEqual({ kind: "idle" });
  });
});

describe("row menu anchor and the view menu", () => {
  const rect = { left: 10, top: 20, right: 30, bottom: 40 };
  test("the row menu remembers the button it hangs from", () => {
    const s = run([{ type: "row.menu", rowId: "A", rect }]).state;
    expect(s.mode).toEqual({ kind: "menu", rowId: "A", anchor: rect });
  });
  test("the view menu opens, toggles and closes", () => {
    const open = run([{ type: "view.menu", rect }]).state;
    expect(open.mode).toEqual({ kind: "viewmenu", anchor: rect });
    expect(run([{ type: "view.menu" }], open).state.mode).toEqual({
      kind: "idle",
    });
    expect(run([{ type: "view.menu.close" }], open).state.mode).toEqual({
      kind: "idle",
    });
    // Nothing opens it over an edit.
    const editing = run([{ type: "cell.edit", rowId: "A", column: "status" }]);
    expect(transition(editing.state, { type: "view.menu" }).state).toBe(
      editing.state,
    );
  });
  test("Reload from the menu closes it and reads again", () => {
    const open = run([{ type: "view.menu", rect }]).state;
    const next = transition(open, { type: "reload" });
    expect(next.state.mode).toEqual({ kind: "idle" });
    expect(next.state.reloading).toBe(true);
    expect(next.effects).toEqual([{ type: "reload" }]);
  });
  test("Save view works from the menu", () => {
    const base = start({ view: "board" });
    const changed = run(
      [
        { type: "view.set", view: "table" },
        { type: "view.menu", rect },
      ],
      { ...base, block: { page: "P", body: "x" } },
    );
    const saved = transition(changed.state, { type: "view.save" });
    expect(saved.state.mode).toEqual({ kind: "writing" });
    expect(saved.effects).toMatchObject([{ type: "saveView", view: "table" }]);
  });
});

describe("tick and Undo", () => {
  const task = (n: number, over: Record<string, unknown> = {}) =>
    row(
      `T@${n}`,
      { done: false, ...over },
      {
        kind: "task",
        page: "Projects/Alpha",
        title: `Task ${n}`,
        range: [n, n + 9],
        state: " ",
      },
    );
  const tasks = () =>
    start(
      { source: { kind: "tasks" }, view: "table", where: { done: false } },
      [task(1), task(2), task(3)],
    );
  const tick = (s: DbState, id = "T@2") =>
    transition(
      transition(s, {
        type: "cell.commit",
        rowId: id,
        column: "done",
        value: true,
      }).state,
      {
        type: "write.done",
        rowId: id,
        column: "done",
        value: true,
        modified: "m2",
      },
    );

  test("ticking keeps the row, offers Undo for eight seconds and counts it done", () => {
    const { state, effects } = tick(tasks());
    expect(state.rows.map((r) => r.id)).toEqual(["T@1", "T@2", "T@3"]);
    expect(state.rows[1].values.done).toBe(true);
    expect(state.rows[1].state).toBe("x");
    expect(state.undo).toMatchObject({ id: 1, label: "Done" });
    expect(state.ghost).toBe("T@2");
    expect(visibleCount(state)).toBe(2);
    expect(effects).toEqual([
      { type: "reload" },
      { type: "timer", id: 1, ms: UNDO_MS },
    ]);
  });

  test("the read that follows does not take the row away", () => {
    const { state } = tick(tasks());
    const loaded = transition(state, {
      type: "rows.loaded",
      rows: [task(1), task(3)],
      truncated: false,
      today: "2026-10-02",
    }).state;
    expect(loaded.rows.map((r) => r.id)).toEqual(["T@1", "T@2", "T@3"]);
    expect(loaded.rows[1].values.done).toBe(true);
    expect(visibleCount(loaded)).toBe(2);
  });

  test("a view that lists done tasks has no ghost and counts as it was", () => {
    const s = start({ source: { kind: "tasks" } }, [task(1), task(2)]);
    const { state } = tick(s);
    expect(state.ghost).toBeUndefined();
    expect(state.undo).not.toBeNull();
    expect(visibleCount(state)).toBe(2);
  });

  test("Undo writes the line back, and the row is open again", () => {
    const ticked = tick(tasks()).state;
    const undone = transition(ticked, { type: "undo.run" });
    expect(undone.state.undo).toBeNull();
    expect(undone.state.mode).toEqual({ kind: "writing" });
    expect(undone.effects).toEqual([
      {
        type: "write",
        row: expect.objectContaining({ id: "T@2", state: "x", modified: "m2" }),
        column: "done",
        kind: "boolean",
        value: false,
      },
    ]);
    const done = transition(undone.state, {
      type: "write.done",
      rowId: "T@2",
      column: "done",
      value: false,
      modified: "m3",
    });
    expect(done.state.ghost).toBeUndefined();
    expect(done.state.undo).toBeNull();
    expect(done.state.rows[1].values.done).toBe(false);
    expect(visibleCount(done.state)).toBe(3);
  });

  test("after eight seconds Undo and the struck-through row go", () => {
    const ticked = tick(tasks()).state;
    // A stale timer (an older tick) does nothing.
    expect(transition(ticked, { type: "undo.expire", id: 99 }).state).toBe(
      ticked,
    );
    const gone = transition(ticked, { type: "undo.expire", id: 1 }).state;
    expect(gone.undo).toBeNull();
    expect(gone.rows.map((r) => r.id)).toEqual(["T@1", "T@3"]);
    expect(visibleCount(gone)).toBe(2);
  });

  test("a second tick replaces the first one's row and Undo", () => {
    const first = tick(tasks()).state;
    const second = tick(first, "T@3").state;
    expect(second.rows.map((r) => r.id)).toEqual(["T@1", "T@3"]);
    expect(second.undo?.id).toBe(2);
    expect(second.ghost).toBe("T@3");
  });

  test("Undo does nothing while something is being written", () => {
    const ticked = tick(tasks()).state;
    const busy: DbState = { ...ticked, mode: { kind: "writing" } };
    expect(transition(busy, { type: "undo.run" }).state).toBe(busy);
  });

  test("archiving offers Undo, which restores the row", () => {
    const row0 = row("A", { status: "active" });
    const ok = transition(
      { ...start(), mode: { kind: "writing" } },
      {
        type: "row.done",
        message: "Archived",
        undo: { label: "Archived", row: { ...row0, modified: "m9" } },
      },
    );
    expect(ok.state.undo).toMatchObject({ label: "Archived" });
    expect(ok.state.notice).toBeNull();
    expect(ok.effects).toEqual([
      { type: "reload" },
      { type: "timer", id: 1, ms: UNDO_MS },
    ]);
    const undone = transition(ok.state, { type: "undo.run" });
    expect(undone.effects).toEqual([
      {
        type: "rowAction",
        action: "archive",
        row: { ...row0, modified: "m9" },
        archived: false,
      },
    ]);
  });
});

describe("a moved card offers Undo", () => {
  const dropped = (target: string, over: Partial<Spec> = {}) =>
    run(
      [
        { type: "card.drag", rowId: "A" },
        { type: "card.drop", target },
      ],
      start(over),
    );
  const landed = (s: DbState, column: string, value: string) =>
    transition(s, {
      type: "write.done",
      rowId: "A",
      column,
      value,
      modified: "m2",
    });

  test("a board drop says where, for eight seconds, once it has landed", () => {
    const drop = dropped("done");
    expect(drop.state.undo).toBeNull();
    const { state, effects } = landed(drop.state, "status", "done");
    expect(state.undo).toMatchObject({ id: 1, label: "Moved to done" });
    expect(state.move).toBeUndefined();
    expect(effects).toEqual([
      { type: "reload" },
      { type: "timer", id: 1, ms: UNDO_MS },
    ]);
  });

  test("Undo writes the previous value back", () => {
    const { state } = landed(dropped("done").state, "status", "done");
    const undone = transition(state, { type: "undo.run" });
    expect(undone.state.undo).toBeNull();
    expect(undone.effects).toEqual([
      {
        type: "write",
        row: expect.objectContaining({ id: "A", modified: "m2" }),
        column: "status",
        kind: "select",
        value: "active",
      },
    ]);
    // The write that undoes it is not itself a move: nothing more to undo.
    const back = landed(undone.state, "status", "active");
    expect(back.state.undo).toBeNull();
  });

  test("a card dropped on 'None' (or 'No date') can come back too", () => {
    const none = landed(dropped("").state, "status", "");
    expect(none.state.undo?.label).toBe("Moved to None");
    expect(
      transition(none.state, { type: "undo.run" }).effects[0],
    ).toMatchObject({ column: "status", value: "active" });
    const day = landed(
      dropped("", { view: "calendar", date: "due" }).state,
      "due",
      "",
    );
    expect(day.state.undo?.label).toBe("Moved to No date");
    expect(
      transition(day.state, { type: "undo.run" }).effects[0],
    ).toMatchObject({ column: "due", value: "2026-10-05" });
  });

  test("a calendar drop names the day", () => {
    const day = dropped("2026-10-20", { view: "calendar", date: "due" });
    const { state } = landed(day.state, "due", "2026-10-20");
    expect(state.undo?.label).toBe("Moved to 2026-10-20");
  });

  test("a value that was empty is written back as empty", () => {
    const d = run(
      [
        { type: "card.drag", rowId: "B" },
        { type: "card.drop", target: "2026-10-20" },
      ],
      start({ view: "calendar", date: "due" }),
    );
    const { state } = transition(d.state, {
      type: "write.done",
      rowId: "B",
      column: "due",
      value: "2026-10-20",
      modified: "m2",
    });
    expect(transition(state, { type: "undo.run" }).effects[0]).toMatchObject({
      column: "due",
      value: "",
    });
  });

  test("a drop that fails offers nothing", () => {
    const failed = transition(dropped("done").state, {
      type: "write.failed",
      reason: "stale",
      message: "Changed",
    }).state;
    expect(failed.undo).toBeNull();
    expect(failed.move).toBeUndefined();
  });

  test("an edit made by hand is not a move", () => {
    const edited = transition(
      transition(start({ view: "table" }), {
        type: "cell.commit",
        rowId: "A",
        column: "status",
        value: "done",
      }).state,
      {
        type: "write.done",
        rowId: "A",
        column: "status",
        value: "done",
        modified: "m2",
      },
    );
    expect(edited.state.undo).toBeNull();
  });
});

describe("an Undo outlives the frame", () => {
  const task = (n: number) =>
    row(
      `T@${n}`,
      { done: false },
      {
        kind: "task",
        page: "P",
        title: `Task ${n}`,
        range: [n, n + 9],
        state: " ",
      },
    );
  const tasks = () =>
    start(
      { source: { kind: "tasks" }, view: "table", where: { done: false } },
      [task(1), task(2), task(3)],
    );
  const ticked = () =>
    transition(
      transition(tasks(), {
        type: "cell.commit",
        rowId: "T@2",
        column: "done",
        value: true,
      }).state,
      {
        type: "write.done",
        rowId: "T@2",
        column: "done",
        value: true,
        modified: "m2",
      },
    ).state;

  test("a rebuilt frame gets the struck-through row and Undo back, for what is left", () => {
    const before = ticked();
    // The frame is rebuilt from the index: the done task is not in it.
    const fresh = start(
      { source: { kind: "tasks" }, view: "table", where: { done: false } },
      [task(1), task(3)],
    );
    const { state, effects } = transition(fresh, {
      type: "undo.restore",
      undo: before.undo!,
      ghost: true,
      ms: 5000,
    });
    expect(state.rows.map((r) => r.id)).toEqual(["T@1", "T@2", "T@3"]);
    expect(state.rows[1].values.done).toBe(true);
    expect(state.ghost).toBe("T@2");
    expect(state.undo).toMatchObject({ id: 1, label: "Done" });
    expect(visibleCount(state)).toBe(2);
    expect(effects).toEqual([{ type: "timer", id: 1, ms: 5000 }]);
    // Undo still works, and the timer ends it.
    expect(transition(state, { type: "undo.run" }).effects[0]).toMatchObject({
      column: "done",
      value: false,
    });
    const gone = transition(state, { type: "undo.expire", id: 1 }).state;
    expect(gone.rows.map((r) => r.id)).toEqual(["T@1", "T@3"]);
  });

  test("a row the index already lists is shown as the tick left it", () => {
    const before = ticked();
    const fresh = tasks();
    const { state } = transition(fresh, {
      type: "undo.restore",
      undo: before.undo!,
      ghost: false,
      ms: 1000,
    });
    expect(state.rows).toHaveLength(3);
    expect(state.rows[1].values.done).toBe(true);
    expect(state.ghost).toBeUndefined();
  });

  test("nothing is restored with no time left, or over a newer Undo", () => {
    const before = ticked();
    const fresh = tasks();
    expect(
      transition(fresh, {
        type: "undo.restore",
        undo: before.undo!,
        ghost: true,
        ms: 0,
      }).state,
    ).toBe(fresh);
    expect(
      transition(before, {
        type: "undo.restore",
        undo: before.undo!,
        ghost: true,
        ms: 3000,
      }).state,
    ).toBe(before);
  });
});

describe("board columns", () => {
  const task = (n: number, page: string) =>
    row(`T@${n}`, { done: false }, { kind: "task", page, title: `T${n}` });
  test("tasks group by their page, named without the folder", () => {
    const s = start({ source: { kind: "tasks" }, view: "board" }, [
      task(1, "Projects/Alpha"),
      task(2, "Projects/Beta"),
      task(3, "Projects/Alpha"),
    ]);
    expect(groupKey(s)).toBe("page");
    const groups = selectView(s).groups;
    expect(groups.map((g) => [g.label, g.rows.length])).toEqual([
      ["Alpha", 2],
      ["Beta", 1],
    ]);
    // Tasks cannot move to another page: no drop writes.
    const drop = run(
      [
        { type: "card.drag", rowId: "T@1" },
        { type: "card.drop", target: "Projects/Beta" },
      ],
      s,
    );
    expect(drop.effects).toEqual([]);
  });
  test("a database board keeps its declared columns, but none empty beside a None column that holds everything", () => {
    const s = start({ order: ["active", "someday", "done"] }, [
      row("A"),
      row("B"),
    ]);
    expect(selectView(s).groups.map((g) => g.key)).toEqual([""]);
    expect(groupKey(s)).toBe("status");
    // With a status somewhere the declared order is kept, empties and all.
    const t = start({ order: ["active", "someday", "done"] });
    expect(selectView(t).groups.map((g) => g.key)).toEqual([
      "active",
      "someday",
      "done",
    ]);
  });
  test("the header's + New lands in the declared default column, else the first", () => {
    const s = start({ order: ["active", "someday", "done"] });
    expect(newRowGroup(s, selectView(s).groups)).toBe("active");
    const db = {
      name: "p",
      tag: "project",
      folder: "Projects/",
      properties: [
        {
          key: "status",
          type: "select",
          options: ["a", "b"],
          default: "someday",
        },
      ],
    } as unknown as DatabaseSpec;
    const d = start({ database: db, order: ["active", "someday", "done"] });
    expect(newRowGroup(d, selectView(d).groups)).toBe("someday");
  });
});
