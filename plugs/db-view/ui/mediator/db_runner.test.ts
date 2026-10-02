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
    runner.emit({ type: "row.delete.ask", rowId: "A" });
    runner.emit({ type: "row.delete.confirm" });
    await settle();
    expect(log2).toEqual(["delete A @m1"]);
    expect(log).toEqual(["query"]);
    expect(asked).toEqual(["A"]);
    expect(runner.getState().mode).toEqual({ kind: "idle" });
    expect(runner.getState().notice?.text).toBe("ゴミ箱へ移しました");
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
      },
      withDb,
    );
    runner.emit({ type: "row.menu", rowId: "A" });
    runner.emit({ type: "row.archive", rowId: "A" });
    await settle();
    expect(calls).toEqual(["archive A true @m1"]);
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
