import { describe, expect, test } from "vitest";
import type { DbRow, Spec } from "../../src/model.ts";
import type { WriteResult } from "../../src/functions.ts";
import {
  initialState,
  type PendingUndo,
  UNDO_MS,
  visibleCount,
} from "./db_mediator.ts";
import {
  createDbRunner,
  type DbRunnerDeps,
  restoreEvent,
} from "./db_runner.ts";

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
    async updatePageValue(page, key, kind, input, modified, database) {
      log.push(
        `page ${page} ${key}=${String(input)} (${kind}) @${modified}${database ? ` db=${database}` : ""}`,
      );
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
    async deleteRow() {
      throw new Error("deleteRow was not expected");
    },
    async archiveRow() {
      throw new Error("archiveRow was not expected");
    },
    async duplicateRow() {
      throw new Error("duplicateRow was not expected");
    },
    async renameRow() {
      throw new Error("renameRow was not expected");
    },
    async saveView() {
      throw new Error("saveView was not expected");
    },
    async indexedModified() {
      // The index has caught up with the write ("m2") by the time it is asked.
      return "m2";
    },
    sleep: async () => {},
    async navigate(target) {
      log.push(`navigate ${target}`);
    },
    async editSource() {
      return true;
    },
    async confirm() {
      return true;
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
      message: "The page changed. Reloaded.",
    }));
    runner.emit({
      type: "cell.commit",
      rowId: "A",
      column: "status",
      value: "done",
    });
    await settle();
    expect(runner.getState().notice?.text).toBe("The page changed. Reloaded.");
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
    expect(runner.getState().notice?.text).toContain("Done and Due");
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

  test("Edit source puts the cursor in the block that drew the view", async () => {
    const asked: string[] = [];
    const runner = createDbRunner(
      initialState({
        spec,
        rows: [],
        truncated: false,
        today: "2026-10-02",
        block: { page: "P", body: "source: tasks" },
      }),
      {
        async editSource(page: string, body: string) {
          asked.push(`${page}|${body}`);
          return true;
        },
        onState: () => {},
      } as unknown as DbRunnerDeps,
    );
    runner.emit({ type: "view.menu" });
    runner.emit({ type: "source.edit" });
    await settle();
    expect(asked).toEqual(["P|source: tasks"]);
    expect(runner.getState().mode.kind).toBe("idle");
    expect(runner.getState().notice).toBeNull();
  });

  test("Edit source says so when the block is gone", async () => {
    const runner = createDbRunner(
      initialState({
        spec,
        rows: [],
        truncated: false,
        today: "2026-10-02",
        block: { page: "P", body: "source: tasks" },
      }),
      {
        async editSource() {
          return false;
        },
        onState: () => {},
      } as unknown as DbRunnerDeps,
    );
    runner.emit({ type: "source.edit" });
    await settle();
    expect(runner.getState().notice?.level).toBe("error");
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

  test("a row made in place carries its values and does not open", async () => {
    const seen: unknown[] = [];
    const { runner, log } = setup(
      [row("A")],
      undefined,
      {
        async createRow(_s, title, values) {
          seen.push(values);
          return { ok: true, page: `Projects/${title}`, modified: "m2" };
        },
        async indexedModified() {
          return "m2";
        },
      },
      { ...withDb, view: "board" },
    );
    runner.emit({ type: "create.open", at: "someday" });
    runner.emit({ type: "row.create", title: "Idea" });
    await settle();
    expect(seen).toEqual([{ status: "someday" }]);
    expect(log).toEqual(["query"]);
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
            message: "A page named Projects/Launch already exists.",
          };
        },
      },
      withDb,
    );
    runner.emit({ type: "create.open" });
    runner.emit({ type: "row.create", title: "Launch" });
    await settle();
    expect(log).toEqual([]);
    // The input comes back with what was typed, and the reason beneath it.
    expect(runner.getState().mode).toEqual({
      kind: "creating",
      title: "Launch",
      error: "A page named Projects/Launch already exists.",
    });
    expect(runner.getState().notice).toBeNull();
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
    expect(runner.getState().mode).toMatchObject({
      kind: "creating",
      title: "Launch",
      error: "disk full",
    });
  });
});

describe("db runner row actions", () => {
  const withDb: Spec = {
    ...spec,
    source: { kind: "tag", tag: "project" },
  };
  test("delete calls the plug, waits for the page to be gone, reloads", async () => {
    const asked: string[] = [];
    const { runner, log } = setup(
      [row("A")],
      undefined,
      {
        async deleteRow(_s, page, modified) {
          log2.push(`delete ${page} @${modified}`);
          return { ok: true, page, modified: null };
        },
        async indexedModified(page) {
          asked.push(page);
          return null;
        },
      },
      withDb,
    );
    const log2: string[] = [];
    runner.emit({ type: "row.menu", rowId: "A" });
    // The host's dialog asks; its "yes" deletes.
    runner.emit({ type: "row.delete.ask", rowId: "A" });
    expect(runner.getState().mode).toEqual({ kind: "confirming", rowId: "A" });
    await settle();
    expect(log2).toEqual(["delete A @m1"]);
    expect(log).toEqual(["query"]);
    expect(asked).toEqual(["A"]);
    expect(runner.getState().mode).toEqual({ kind: "idle" });
    expect(runner.getState().notice?.text).toBe(
      "Moved to trash. You can restore it from Trash.",
    );
  });
  test("the dialog names the row and the consequence; No leaves it alone", async () => {
    const asked: [string, unknown][] = [];
    const { runner, log } = setup(
      [row("Spring Launch")],
      undefined,
      {
        async confirm(message, options) {
          asked.push([message, options]);
          return false;
        },
        async deleteRow() {
          throw new Error("must not delete");
        },
      },
      withDb,
    );
    runner.emit({ type: "row.menu", rowId: "Spring Launch" });
    runner.emit({ type: "row.delete.ask", rowId: "Spring Launch" });
    await settle();
    expect(asked).toEqual([
      [
        "Move Spring Launch to trash? You can restore it from Trash.",
        { destructive: true, okLabel: "Move to trash" },
      ],
    ]);
    expect(runner.getState().mode).toEqual({ kind: "idle" });
    expect(log).toEqual([]);
  });
  test("rename waits for the old name to go and the new one to show", async () => {
    const asked: string[] = [];
    const { runner } = setup(
      [row("Projects/A")],
      undefined,
      {
        async renameRow(_s, _page, title) {
          return { ok: true, page: `Projects/${title}`, modified: "m9" };
        },
        async indexedModified(page) {
          asked.push(page);
          return page === "Projects/A" ? null : "m9";
        },
      },
      withDb,
    );
    runner.emit({ type: "row.menu", rowId: "Projects/A" });
    runner.emit({ type: "row.rename.start", rowId: "Projects/A" });
    runner.emit({ type: "row.rename", rowId: "Projects/A", title: "B" });
    await settle();
    expect(asked.sort()).toEqual(["Projects/A", "Projects/B"]);
    expect(runner.getState().reloading).toBe(false);
  });
  test("archive and duplicate pass what the plug needs; a refusal is shown", async () => {
    const calls: string[] = [];
    const { runner } = setup(
      [row("A")],
      undefined,
      {
        async archiveRow(_s, page, archived, modified) {
          calls.push(`archive ${page} ${archived} @${modified}`);
          return { ok: true, page, modified: "m2" };
        },
        async duplicateRow() {
          return { ok: false, reason: "failed", message: "disk full" };
        },
        // The Undo offer stays up for the length of the test.
        sleep: (n: number) =>
          n === 8000 ? new Promise<void>(() => {}) : Promise.resolve(),
      },
      withDb,
    );
    runner.emit({ type: "row.menu", rowId: "A" });
    runner.emit({ type: "row.archive", rowId: "A" });
    await settle();
    expect(calls).toEqual(["archive A true @m1"]);
    // Archiving offers Undo in the view; Undo restores it with the fresh stamp.
    expect(runner.getState().undo?.label).toBe("Archived");
    runner.emit({ type: "undo.run" });
    await settle();
    expect(calls).toEqual(["archive A true @m1", "archive A false @m2"]);
    expect(runner.getState().notice).toEqual({
      level: "info",
      text: "Restored",
    });
    runner.emit({ type: "row.menu", rowId: "A" });
    runner.emit({ type: "row.duplicate", rowId: "A" });
    await settle();
    expect(runner.getState().notice).toEqual({
      level: "error",
      text: "disk full",
    });
  });
  test("a throwing action is a failure, not a crash", async () => {
    const { runner } = setup(
      [row("A")],
      undefined,
      {
        async duplicateRow() {
          throw new Error("boom");
        },
      },
      withDb,
    );
    runner.emit({ type: "row.menu", rowId: "A" });
    runner.emit({ type: "row.duplicate", rowId: "A" });
    await settle();
    expect(runner.getState().notice?.text).toBe("boom");
    expect(runner.getState().mode).toEqual({ kind: "idle" });
  });
});

describe("save view", () => {
  test("the view goes to the block that drew it", async () => {
    const log: string[] = [];
    const rows = [row("A")];
    const runner = createDbRunner(
      initialState({
        spec,
        rows,
        truncated: false,
        today: "2026-10-02",
        block: { page: "Home", body: "source: projects" },
      }),
      {
        async saveView(page: string, body: string, saved: unknown) {
          log.push(`${page}|${body}|${JSON.stringify(saved)}`);
          return { ok: true, body: "NEW" };
        },
        onState: () => {},
      } as unknown as DbRunnerDeps,
    );
    runner.emit({ type: "view.set", view: "board" });
    runner.emit({ type: "phrase.set", phrase: "x" });
    runner.emit({ type: "view.save" });
    await settle();
    expect(log).toEqual([
      'Home|source: projects|{"view":"board","filter":"x"}',
    ]);
    expect(runner.getState().block?.body).toBe("NEW");
    expect(runner.getState().spec.view).toBe("board");
  });

  test("a refusal is shown, and a throw too", async () => {
    for (const saveView of [
      async () => ({
        ok: false as const,
        reason: "stale" as const,
        message: "changed",
      }),
      async () => {
        throw new Error("changed");
      },
    ]) {
      const runner = createDbRunner(
        initialState({
          spec,
          rows: [],
          truncated: false,
          today: "2026-10-02",
          block: { page: "Home", body: "b" },
        }),
        { saveView, onState: () => {} } as unknown as DbRunnerDeps,
      );
      runner.emit({ type: "phrase.set", phrase: "x" });
      runner.emit({ type: "view.save" });
      await settle();
      expect(runner.getState().notice?.text).toBe("changed");
      expect(runner.getState().mode).toEqual({ kind: "idle" });
    }
  });
});

describe("db runner write enforcement", () => {
  test("a page write tells the plug which database it belongs to", async () => {
    const s: Spec = {
      ...spec,
      view: "table",
      source: { kind: "tag", tag: "project" },
      database: {
        name: "projects",
        tag: "project",
        folder: "Projects/",
        properties: [],
      },
    };
    const { runner, log } = setup(
      [row("A", { status: "active" })],
      undefined,
      {},
      s,
    );
    runner.emit({ type: "cell.edit", rowId: "A", column: "status" });
    runner.emit({
      type: "cell.commit",
      rowId: "A",
      column: "status",
      value: "done",
    });
    await settle();
    expect(log[0]).toContain("db=projects");
  });
});

describe("tick and Undo", () => {
  const tasksSpec: Spec = {
    ...spec,
    source: { kind: "tasks" },
    where: { done: false },
  };
  const task = (n: number) =>
    row(
      `T@${n}`,
      { done: false },
      { kind: "task", page: "Alpha", range: [n * 10, n * 10 + 8], state: " " },
    );
  test("a tick keeps the row, Undo writes the line back, eight seconds end the offer", async () => {
    const ms: number[] = [];
    let release: () => void = () => {};
    const { runner, log } = setup(
      [task(1), task(2)],
      undefined,
      {
        async query() {
          log.push("query");
          return {
            spec: tasksSpec,
            rows: [task(1)],
            truncated: false,
            today: "2026-10-02",
          };
        },
        // Index waits return at once; the Undo timer waits to be released.
        sleep: (n: number) => {
          ms.push(n);
          return n === 8000
            ? new Promise<void>((r) => {
                release = r;
              })
            : Promise.resolve();
        },
      },
      tasksSpec,
    );
    runner.emit({
      type: "cell.commit",
      rowId: "T@2",
      column: "done",
      value: true,
    });
    await settle();
    expect(log).toEqual([
      'task Alpha@20 [ ] {"type":"done","done":true} @m1',
      "query",
    ]);
    // The read no longer lists it; the view still draws it, struck through.
    let state = runner.getState();
    expect(state.rows.map((r) => r.id)).toEqual(["T@1", "T@2"]);
    expect(state.rows[1].values.done).toBe(true);
    expect(state.undo?.label).toBe("Done");
    expect(visibleCount(state)).toBe(1);
    expect(ms).toContain(8000);
    runner.emit({ type: "undo.run" });
    await settle();
    expect(log[2]).toBe('task Alpha@20 [x] {"type":"done","done":false} @m2');
    state = runner.getState();
    expect(state.undo).toBeNull();
    // The timer of the first tick runs out after Undo: nothing happens.
    release();
    await settle();
    expect(runner.getState().undo).toBeNull();
  });
  test("when nothing is done the row goes with the offer", async () => {
    let release: () => void = () => {};
    const { runner } = setup(
      [task(1), task(2)],
      undefined,
      {
        async query() {
          return {
            spec: tasksSpec,
            rows: [task(1)],
            truncated: false,
            today: "2026-10-02",
          };
        },
        sleep: (n: number) =>
          n === 8000
            ? new Promise<void>((r) => {
                release = r;
              })
            : Promise.resolve(),
      },
      tasksSpec,
    );
    runner.emit({
      type: "cell.commit",
      rowId: "T@2",
      column: "done",
      value: true,
    });
    await settle();
    expect(runner.getState().rows).toHaveLength(2);
    release();
    await settle();
    expect(runner.getState().undo).toBeNull();
    expect(runner.getState().rows.map((r) => r.id)).toEqual(["T@1"]);
  });
});

describe("an Undo outlives a rebuilt frame", () => {
  const tasksSpec: Spec = {
    ...spec,
    source: { kind: "tasks" },
    where: { done: false },
  };
  const task = (n: number) =>
    row(
      `T@${n}`,
      { done: false },
      { kind: "task", page: "Alpha", range: [n * 10, n * 10 + 8], state: " " },
    );
  const tasksQuery = async () => ({
    spec: tasksSpec,
    rows: [task(1)],
    truncated: false,
    today: "2026-10-02",
  });

  test("a tick is remembered with its time, and forgotten when Undo runs", async () => {
    const kept: (PendingUndo | null)[] = [];
    const { runner } = setup(
      [task(1), task(2)],
      undefined,
      {
        query: tasksQuery,
        // The Undo timer never runs out in this test.
        sleep: (n: number) =>
          n === UNDO_MS ? new Promise<void>(() => {}) : Promise.resolve(),
        remember: (p) => kept.push(p),
        now: () => 1000,
      },
      tasksSpec,
    );
    runner.emit({
      type: "cell.commit",
      rowId: "T@2",
      column: "done",
      value: true,
    });
    await settle();
    const last = kept[kept.length - 1];
    expect(last).toMatchObject({
      undo: { label: "Done" },
      ghost: true,
      until: 1000 + UNDO_MS,
    });
    runner.emit({ type: "undo.run" });
    await settle();
    expect(kept[kept.length - 1]).toBeNull();
  });

  test("the frame that comes back shows the tick again for the time left", async () => {
    const kept: (PendingUndo | null)[] = [];
    const first = setup(
      [task(1), task(2)],
      undefined,
      {
        query: tasksQuery,
        sleep: (n: number) =>
          n === UNDO_MS ? new Promise<void>(() => {}) : Promise.resolve(),
        remember: (p) => kept.push(p),
        now: () => 1000,
      },
      tasksSpec,
    );
    first.runner.emit({
      type: "cell.commit",
      rowId: "T@2",
      column: "done",
      value: true,
    });
    await settle();
    const saved = JSON.parse(JSON.stringify(kept[kept.length - 1]));
    // 3 seconds later the editor rebuilds the page: a fresh frame, fresh rows.
    const again = restoreEvent(saved, 4000);
    expect(again).toMatchObject({ type: "undo.restore", ms: UNDO_MS - 3000 });
    const kept2: (PendingUndo | null)[] = [];
    const second = setup(
      [task(1)],
      undefined,
      {
        query: tasksQuery,
        sleep: () => new Promise<void>(() => {}),
        remember: (p) => kept2.push(p),
        now: () => 4000,
      },
      tasksSpec,
    );
    second.runner.emit(again!);
    const state = second.runner.getState();
    expect(state.rows.map((r) => r.id)).toEqual(["T@1", "T@2"]);
    expect(state.undo?.label).toBe("Done");
    expect(visibleCount(state)).toBe(1);
    // It runs out when the first one would have, not eight seconds later.
    expect(kept2[kept2.length - 1]?.until).toBe(1000 + UNDO_MS);
  });

  test("the Undo is remembered when the tick is issued, before its write lands", async () => {
    const kept: (PendingUndo | null)[] = [];
    let land: (r: WriteResult) => void = () => {};
    const { runner } = setup(
      [task(1), task(2)],
      () =>
        new Promise<WriteResult>((r) => {
          land = r;
        }),
      {
        query: tasksQuery,
        sleep: () => new Promise<void>(() => {}),
        remember: (p) => kept.push(p),
        now: () => 1000,
      },
      tasksSpec,
    );
    runner.emit({
      type: "cell.commit",
      rowId: "T@2",
      column: "done",
      value: true,
    });
    await settle();
    // The write has not landed, yet a rebuilt frame could already show Undo.
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatchObject({
      undo: { label: "Done", action: { kind: "untick", index: 1 } },
      ghost: true,
      until: 1000 + UNDO_MS,
    });
    land({ ok: false, reason: "failed", message: "no" });
    await settle();
    // The tick failed: nothing is left on offer.
    expect(kept[kept.length - 1]).toBeNull();
  });

  test("Undo in a rebuilt frame writes with the page's current modification time", async () => {
    const { runner, log } = setup(
      [task(1)],
      undefined,
      {
        query: tasksQuery,
        sleep: () => new Promise<void>(() => {}),
        indexedModified: async () => "m9",
        now: () => 4000,
      },
      tasksSpec,
    );
    const ticked = { ...task(2), values: { done: true }, state: "x" };
    runner.emit({
      type: "undo.restore",
      undo: {
        id: 1,
        label: "Done",
        action: { kind: "untick", row: ticked, index: 1 },
      },
      ghost: true,
      ms: 5000,
    });
    runner.emit({ type: "undo.run" });
    await settle();
    expect(log.find((l) => l.startsWith("task"))).toContain("@m9");
  });

  test("an Undo that has run out is not brought back", () => {
    const pending = {
      undo: {
        id: 1,
        label: "Done",
        action: { kind: "unarchive", row: row("A") },
      },
      ghost: false,
      until: 5000,
    } as PendingUndo;
    expect(restoreEvent(pending, 5000)).toBeNull();
    expect(restoreEvent(pending, 9000)).toBeNull();
    expect(restoreEvent(null, 0)).toBeNull();
    // A time further out than Undo ever lasts is not ours.
    expect(restoreEvent(pending, -UNDO_MS - 1)).toBeNull();
  });
});
