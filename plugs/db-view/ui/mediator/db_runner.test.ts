import { describe, expect, test } from "vitest";
import type { DbRow, Spec } from "../../src/model.ts";
import type { WriteResult } from "../../src/functions.ts";
import { initialState } from "./db_mediator.ts";
import { createDbRunner, type DbRunnerDeps } from "./db_runner.ts";

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

const spec: Spec = {
  source: { kind: "projects" },
  view: "table",
  group: "status",
  date: "due",
  where: {},
  limit: 500,
  weekStart: 0,
};

function setup(
  rows: DbRow[],
  write: () => WriteResult | Promise<WriteResult> = () => ({
    ok: true,
    modified: "m2",
  }),
  over: Partial<DbRunnerDeps> = {},
  s: Spec = spec,
) {
  const log: string[] = [];
  const deps: DbRunnerDeps = {
    async updatePageValue(page, key, kind, input, modified) {
      log.push(`page ${page} ${key}=${String(input)} (${kind}) @${modified}`);
      return write();
    },
    async updateTask(page, pos, state, edit, modified) {
      log.push(
        `task ${page}@${pos} [${state}] ${JSON.stringify(edit)} @${modified}`,
      );
      return write();
    },
    async query() {
      log.push("query");
      // The index has caught up with the write ("m2") by the time it is read.
      return {
        spec,
        rows: [row("Fresh"), row("A", { status: "done" }, { modified: "m2" })],
        truncated: false,
        today: "2026-10-03",
      };
    },
    async createRow() {
      throw new Error("createRow was not expected");
    },
    async indexedModified() {
      // The index has caught up with the write ("m2") by the time it is asked.
      return "m2";
    },
    sleep: async () => {},
    async navigate(target) {
      log.push(`navigate ${target}`);
    },
    onState: () => {},
    ...over,
  };
  const runner = createDbRunner(
    initialState({ spec: s, rows, truncated: false, today: "2026-10-02" }),
    deps,
  );
  return { runner, log };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe("db runner", () => {
  test("a page edit writes the attribute, then reads everything again", async () => {
    const { runner, log } = setup([row("A", { status: "active" })]);
    runner.emit({
      type: "cell.commit",
      rowId: "A",
      column: "status",
      value: "done",
    });
    await settle();
    expect(log).toEqual(["page A status=done (select) @m1", "query"]);
    expect(runner.getState().rows.map((r) => r.id)).toEqual(["Fresh", "A"]);
    expect(runner.getState().mode).toEqual({ kind: "idle" });
  });

  test("a conflict is shown, and the screen is brought up to date", async () => {
    const { runner, log } = setup([row("A", { status: "active" })], () => ({
      ok: false,
      reason: "stale",
      message: "ページが変わっています",
    }));
    runner.emit({
      type: "cell.commit",
      rowId: "A",
      column: "status",
      value: "done",
    });
    await settle();
    expect(runner.getState().notice?.text).toBe("ページが変わっています");
    expect(log).toEqual(["page A status=done (select) @m1", "query"]);
    expect(runner.getState().rows.map((r) => r.id)).toEqual(["Fresh", "A"]);
  });

  test("a throwing write is a failure, not a crash", async () => {
    const { runner } = setup([row("A", { status: "active" })], () => {
      throw new Error("disk full");
    });
    runner.emit({
      type: "cell.commit",
      rowId: "A",
      column: "status",
      value: "done",
    });
    await settle();
    expect(runner.getState().mode).toEqual({ kind: "idle" });
    expect(runner.getState().notice?.text).toBe("disk full");
  });

  test("a task's checkbox and due date go to the task's own line", async () => {
    const task = row(
      "Plan@10",
      { done: false, due: "2026-10-01" },
      {
        kind: "task",
        page: "Plan",
        range: [10, 30],
        state: " ",
      },
    );
    const { runner, log } = setup(
      [task],
      undefined,
      {},
      { ...spec, source: { kind: "tasks" } },
    );
    runner.emit({
      type: "cell.commit",
      rowId: "Plan@10",
      column: "done",
      value: true,
    });
    await settle();
    runner.emit({
      type: "cell.commit",
      rowId: "Plan@10",
      column: "due",
      value: "2026-12-24",
    });
    await settle();
    // The read that follows the first write replaced the rows with what the
    // index holds (the task is not in it), so the second edit has no row.
    expect(log.filter((l) => l.startsWith("task"))).toEqual([
      'task Plan@10 [ ] {"type":"done","done":true} @m1',
    ]);
  });

  test("a task's due date is written, and an empty one clears it", async () => {
    const task = row(
      "Plan@10",
      { due: "2026-10-01" },
      { kind: "task", page: "Plan", range: [10, 30], state: " " },
    );
    const { runner, log } = setup(
      [task],
      undefined,
      {},
      { ...spec, source: { kind: "tasks" } },
    );
    runner.emit({
      type: "cell.commit",
      rowId: "Plan@10",
      column: "due",
      value: "",
    });
    await settle();
    expect(log[0]).toBe('task Plan@10 [ ] {"type":"due","due":null} @m1');
  });

  test("a task attribute other than done and due cannot be written", async () => {
    const task = row(
      "Plan@10",
      { owner: "me" },
      { kind: "task", page: "Plan", range: [10, 30], state: " " },
    );
    const { runner, log } = setup(
      [task],
      undefined,
      {},
      { ...spec, source: { kind: "tasks" } },
    );
    runner.emit({
      type: "cell.commit",
      rowId: "Plan@10",
      column: "owner",
      value: "you",
    });
    await settle();
    expect(log).toEqual([]);
    expect(runner.getState().notice?.text).toContain("完了と期限");
  });

  test("a failed read is shown", async () => {
    const { runner } = setup([row("A")], undefined, {
      async query() {
        throw new Error("index not ready");
      },
    });
    runner.emit({ type: "reload" });
    await settle();
    expect(runner.getState().notice?.text).toContain("index not ready");
    expect(runner.getState().reloading).toBe(false);
  });

  test("opening a row navigates", async () => {
    const { runner, log } = setup([row("A")]);
    runner.emit({ type: "row.open", rowId: "A" });
    await settle();
    expect(log).toEqual(["navigate A"]);
  });

  test("a board drag ends in one write", async () => {
    const { runner, log } = setup(
      [row("A", { status: "active" })],
      undefined,
      {},
      { ...spec, view: "board" },
    );
    runner.emit({ type: "view.set", view: "board" });
    runner.emit({ type: "card.drag", rowId: "A" });
    runner.emit({ type: "card.drop", target: "done" });
    await settle();
    expect(log[0]).toBe("page A status=done (select) @m1");
  });
});

describe("reading after a write", () => {
  test("waits until the index shows the write, then reads once", async () => {
    let asked = 0;
    const { runner, log } = setup([row("A", { status: "active" })], undefined, {
      async indexedModified() {
        asked++;
        return asked < 3 ? "m1" : "m2"; // two answers behind, the third caught up
      },
    });
    runner.emit({
      type: "cell.commit",
      rowId: "A",
      column: "status",
      value: "done",
    });
    await settle();
    await settle();
    expect(asked).toBe(3);
    expect(log.filter((l) => l === "query")).toHaveLength(1);
    expect(runner.getState().reloading).toBe(false);
  });

  test("never shows the old values back while it waits", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const seen: string[] = [];
    const { runner } = setup([row("A", { status: "active" })], undefined, {
      async indexedModified() {
        await gate;
        return "m2";
      },
      onState: (s) => seen.push(String(s.rows[0]?.values.status)),
    });
    runner.emit({
      type: "cell.commit",
      rowId: "A",
      column: "status",
      value: "done",
    });
    await settle();
    expect(runner.getState().rows[0].values.status).toBe("done"); // the write's own value
    release();
    await settle();
    await settle();
    // Before the write lands the row is as it was; after, never again.
    expect(seen.slice(seen.indexOf("done")).includes("active")).toBe(false);
  });

  test("a row the write moved out of the view does not hold the read up", async () => {
    let asked = 0;
    const { runner } = setup([row("A", { status: "active" })], undefined, {
      async indexedModified() {
        asked++;
        return "m2";
      },
      async query() {
        // The view is `where: status: active`: A is no longer in it.
        return {
          spec,
          rows: [row("Other")],
          truncated: false,
          today: "2026-10-03",
        };
      },
    });
    runner.emit({
      type: "cell.commit",
      rowId: "A",
      column: "status",
      value: "done",
    });
    await settle();
    await settle();
    expect(asked).toBe(1);
    expect(runner.getState().rows.map((r) => r.id)).toEqual(["Other"]);
  });

  test("gives up quietly when the index never catches up, keeping the written value", async () => {
    const { runner } = setup([row("A", { status: "active" })], undefined, {
      async indexedModified() {
        return "m1";
      },
    });
    runner.emit({
      type: "cell.commit",
      rowId: "A",
      column: "status",
      value: "done",
    });
    await settle();
    await settle();
    const state = runner.getState();
    expect(state.rows[0].values.status).toBe("done");
    expect(state.reloading).toBe(false);
    expect(state.notice).toBeNull();
  });

  test("after giving up, a later read does not wait again", async () => {
    let asked = 0;
    const { runner, log } = setup([row("A", { status: "active" })], undefined, {
      async indexedModified() {
        asked++;
        return "m1";
      },
    });
    runner.emit({
      type: "cell.commit",
      rowId: "A",
      column: "status",
      value: "done",
    });
    await settle();
    await settle();
    const askedAtGiveUp = asked;
    runner.emit({ type: "reload" });
    await settle();
    expect(asked).toBe(askedAtGiveUp);
    expect(log.filter((l) => l === "query")).toHaveLength(1);
  });

  test("every page written since the last read is waited for", async () => {
    const asked: string[] = [];
    const rows = [
      row("A", { status: "active" }),
      row("B", { status: "active" }),
    ];
    const { runner } = setup(rows, undefined, {
      async indexedModified(page) {
        asked.push(page);
        return "m2";
      },
    });
    runner.emit({
      type: "cell.commit",
      rowId: "A",
      column: "status",
      value: "done",
    });
    runner.emit({
      type: "cell.commit",
      rowId: "B",
      column: "status",
      value: "done",
    });
    await settle();
    await settle();
    await settle();
    expect(new Set(asked)).toEqual(new Set(["A"]));
  });

  test("a plain reload (no write) takes the first read", async () => {
    const { runner, log } = setup([row("A")]);
    runner.emit({ type: "reload" });
    await settle();
    expect(log).toEqual(["query"]);
  });
});

describe("+ New", () => {
  const withDb: Spec = {
    ...spec,
    source: { kind: "tag", tag: "project" },
    database: {
      name: "projects",
      tag: "project",
      folder: "Projects/",
      properties: [],
    },
  };

  test("a row made is navigated to, and the rows are read again", async () => {
    const asked: string[] = [];
    const { runner, log } = setup(
      [row("A")],
      undefined,
      {
        async createRow(s, title) {
          log.push(`create ${s.database?.name} ${title}`);
          return { ok: true, page: `Projects/${title}`, modified: "m2" };
        },
        async indexedModified(page) {
          asked.push(page);
          return "m2";
        },
      },
      withDb,
    );
    runner.emit({ type: "create.open" });
    runner.emit({ type: "row.create", title: "Launch" });
    expect(runner.getState().mode).toEqual({ kind: "writing" });
    await settle();
    expect(log).toEqual([
      "create projects Launch",
      "navigate Projects/Launch",
      "query",
    ]);
    // The read waited for the index to show the new page.
    expect(asked).toEqual(["Projects/Launch"]);
    expect(runner.getState().mode).toEqual({ kind: "idle" });
    expect(runner.getState().reloading).toBe(false);
  });

  test("a refused row is shown, nothing opens", async () => {
    const { runner, log } = setup(
      [row("A")],
      undefined,
      {
        async createRow() {
          return {
            ok: false,
            reason: "exists",
            message: "Projects/Launch はもうあります",
          };
        },
      },
      withDb,
    );
    runner.emit({ type: "create.open" });
    runner.emit({ type: "row.create", title: "Launch" });
    await settle();
    expect(log).toEqual([]);
    expect(runner.getState().mode).toEqual({ kind: "idle" });
    expect(runner.getState().notice?.text).toBe(
      "Projects/Launch はもうあります",
    );
  });

  test("a throwing create is a failure, not a crash", async () => {
    const { runner } = setup(
      [row("A")],
      undefined,
      {
        async createRow() {
          throw new Error("disk full");
        },
      },
      withDb,
    );
    runner.emit({ type: "create.open" });
    runner.emit({ type: "row.create", title: "Launch" });
    await settle();
    expect(runner.getState().notice?.text).toBe("disk full");
    expect(runner.getState().mode).toEqual({ kind: "idle" });
  });
});
