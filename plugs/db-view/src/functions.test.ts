import { beforeEach, describe, expect, test } from "vitest";
import { createMockSystem } from "../../../plug-api/system_mock.ts";
import { extractFrontmatter, patchFrontmatter } from "../../index/api.ts";
import {
  createRow,
  loadRows,
  updatePageValue,
  updateTask,
} from "./functions.ts";
import type { DatabaseSpec, Spec } from "./model.ts";

const call = (name: string, ...args: unknown[]) =>
  (globalThis as any).syscall(name, ...args);

beforeEach(() => {
  const mock = createMockSystem();
  // The index plug is not loaded here: stand in for the functions used.
  mock.system.registerSyscalls([], {
    "system.invokeFunction": async (
      _ctx: unknown,
      name: string,
      ...args: any[]
    ) => {
      if (name === "index.patchFrontmatter")
        return patchFrontmatter(args[0], args[1]);
      if (name === "index.extractFrontmatter")
        return extractFrontmatter(args[0], args[1]);
      throw new Error(`unexpected ${name}`);
    },
  });
});

async function writePage(name: string, text: string): Promise<string> {
  const meta = await call("space.writePage", name, text);
  return String(meta.lastModified);
}

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

async function index(objects: Record<string, unknown>[], page = "Seed") {
  await call("index.indexObjects", page, objects);
}

describe("updatePageValue", () => {
  const original =
    "---\nstatus: active\ndue: 2026-10-01\narea: 発信\ntags: project\n---\n\n# P\n";

  test("sets one attribute and keeps the rest", async () => {
    const modified = await writePage("Projects/A", original);
    const r = await updatePageValue(
      "Projects/A",
      "status",
      "select",
      "done",
      modified,
    );
    expect(r.ok).toBe(true);
    const text = await call("space.readPage", "Projects/A");
    expect(text).toContain("status: done");
    expect(text).toContain("due: 2026-10-01");
    expect(text).toContain("area: 発信");
    expect(text).toContain("# P");
    if (r.ok)
      expect(r.modified).toBe(
        String((await call("space.getPageMeta", "Projects/A")).lastModified),
      );
  });

  test("an empty cell removes the attribute", async () => {
    const modified = await writePage("Projects/A", original);
    const r = await updatePageValue(
      "Projects/A",
      "area",
      "text",
      "  ",
      modified,
    );
    expect(r.ok).toBe(true);
    expect(await call("space.readPage", "Projects/A")).not.toContain("area:");
  });

  test("a page that changed since the row was read is not written", async () => {
    const modified = await writePage("Projects/A", original);
    await new Promise((r) => setTimeout(r, 5));
    await writePage("Projects/A", original.replace("# P", "# P edited"));
    const r = await updatePageValue(
      "Projects/A",
      "status",
      "select",
      "done",
      modified,
    );
    expect(r).toMatchObject({ ok: false, reason: "stale" });
    const text = await call("space.readPage", "Projects/A");
    expect(text).toContain("status: active");
    expect(text).toContain("# P edited");
  });

  test("a bad date is refused before anything is read", async () => {
    const modified = await writePage("Projects/A", original);
    const r = await updatePageValue(
      "Projects/A",
      "due",
      "date",
      "next week",
      modified,
    );
    expect(r).toMatchObject({ ok: false, reason: "invalid" });
    expect(await call("space.readPage", "Projects/A")).toBe(original);
  });

  test("writing the value that is already there writes nothing", async () => {
    const modified = await writePage("Projects/A", original);
    const r = await updatePageValue(
      "Projects/A",
      "status",
      "select",
      "active",
      modified,
    );
    expect(r).toEqual({ ok: true, modified });
  });
});

describe("updateTask", () => {
  const text = "# Plan\n\n- [ ] first #next\n- [x] second [due: 2026-10-01]\n";
  const posFirst = text.indexOf("- [ ] first");
  const posSecond = text.indexOf("- [x] second");

  test("ticks a task", async () => {
    const modified = await writePage("Plan", text);
    const r = await updateTask(
      "Plan",
      posFirst,
      " ",
      { type: "done", done: true },
      modified,
    );
    expect(r.ok).toBe(true);
    expect(await call("space.readPage", "Plan")).toBe(
      text.replace("- [ ] first", "- [x] first"),
    );
  });

  test("changes a due date", async () => {
    const modified = await writePage("Plan", text);
    const r = await updateTask(
      "Plan",
      posSecond,
      "x",
      { type: "due", due: "2026-12-24" },
      modified,
    );
    expect(r.ok).toBe(true);
    expect(await call("space.readPage", "Plan")).toContain("[due: 2026-12-24]");
  });

  test("a task whose page changed is not touched", async () => {
    const modified = await writePage("Plan", text);
    await new Promise((r) => setTimeout(r, 5));
    await writePage("Plan", `intro\n\n${text}`);
    const r = await updateTask(
      "Plan",
      posFirst,
      " ",
      { type: "done", done: true },
      modified,
    );
    expect(r).toMatchObject({ ok: false, reason: "stale" });
    expect(await call("space.readPage", "Plan")).toBe(`intro\n\n${text}`);
  });

  test("a position that is no longer a task is refused", async () => {
    const modified = await writePage("Plan", text);
    const r = await updateTask(
      "Plan",
      0,
      " ",
      { type: "done", done: true },
      modified,
    );
    expect(r).toMatchObject({ ok: false, reason: "not-a-task" });
  });

  test("a bad due date is refused", async () => {
    const modified = await writePage("Plan", text);
    const r = await updateTask(
      "Plan",
      posFirst,
      " ",
      { type: "due", due: "someday" },
      modified,
    );
    expect(r).toMatchObject({ ok: false, reason: "invalid" });
  });
});

describe("loadRows", () => {
  const page = (name: string, extra: Record<string, unknown>) => ({
    ref: name,
    tag: "page",
    name,
    tags: ["project"],
    lastModified: "2026-10-01T00:00:00Z",
    ...extra,
  });
  const task = (n: number, pageName: string, done: boolean) => ({
    ref: `${pageName}@${n}`,
    tag: "task",
    name: `task ${n}`,
    text: `task ${n}`,
    page: pageName,
    pos: n,
    range: [n, n + 5],
    state: done ? "x" : " ",
    done,
    tags: ["task"],
    pageLastModified: "2026-10-01T00:00:00Z",
  });

  test("projects: the tagged pages, with their task counts", async () => {
    await index([
      page("Projects/A", { status: "active", due: "2026-10-05" }),
      page("Projects/B", { status: "done" }),
      { ...page("Notes/N", {}), tags: ["note"] },
      task(1, "Projects/A", false),
      task(2, "Projects/A", false),
      task(3, "Projects/A", true),
    ]);
    const { rows, truncated } = await loadRows(spec());
    expect(truncated).toBe(false);
    expect(rows.map((r) => r.id).sort()).toEqual(["Projects/A", "Projects/B"]);
    const a = rows.find((r) => r.id === "Projects/A")!;
    expect(a).toMatchObject({
      kind: "page",
      title: "A",
      openTasks: 2,
      doneTasks: 1,
    });
    expect(a.values).toMatchObject({ status: "active", due: "2026-10-05" });
    expect(rows.find((r) => r.id === "Projects/B")).toMatchObject({
      openTasks: 0,
      doneTasks: 0,
    });
  });

  test("where and limit", async () => {
    await index([
      page("P/1", { status: "active" }),
      page("P/2", { status: "active" }),
      page("P/3", { status: "done" }),
    ]);
    const active = await loadRows(spec({ where: { status: "active" } }));
    expect(active.rows).toHaveLength(2);
    const limited = await loadRows(spec({ limit: 2 }));
    expect(limited).toMatchObject({ truncated: true });
    expect(limited.rows).toHaveLength(2);
  });

  test("tasks", async () => {
    await index([task(1, "Plan", false), task(2, "Plan", true)]);
    const { rows } = await loadRows(spec({ source: { kind: "tasks" } }));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      kind: "task",
      page: "Plan",
      title: "task 1",
      state: " ",
      range: [1, 6],
    });
    expect(rows[0].values).toMatchObject({ done: false });
    const done = await loadRows(
      spec({ source: { kind: "tasks" }, where: { done: true } }),
    );
    expect(done.rows.map((r) => r.title)).toEqual(["task 2"]);
  });

  test("a tag source", async () => {
    await index([
      { ...page("M/1", { room: "A" }), tags: ["meeting"] },
      page("P/1", {}),
    ]);
    const { rows } = await loadRows(
      spec({ source: { kind: "tag", tag: "meeting" } }),
    );
    expect(rows.map((r) => r.id)).toEqual(["M/1"]);
    expect(rows[0].values.room).toBe("A");
  });

  test("a database keeps only the pages in its folder", async () => {
    await index([
      page("Projects/A", {}),
      page("Projects/Sub/B", {}),
      page("Archive/C", {}),
    ]);
    const { rows } = await loadRows(
      spec({
        source: { kind: "tag", tag: "project" },
        database: projects({ folder: "Projects/" }),
      }),
    );
    expect(rows.map((r) => r.id).sort()).toEqual([
      "Projects/A",
      "Projects/Sub/B",
    ]);
    const anywhere = await loadRows(
      spec({
        source: { kind: "tag", tag: "project" },
        database: projects({ folder: "" }),
      }),
    );
    expect(anywhere.rows).toHaveLength(3);
  });
});

const projects = (over: Partial<DatabaseSpec> = {}): DatabaseSpec => ({
  name: "projects",
  tag: "project",
  folder: "Projects/",
  properties: [
    {
      key: "status",
      type: "select",
      options: ["active", "done"],
      default: "active",
    },
    { key: "due", type: "date" },
    { key: "count", type: "number", default: 0 },
  ],
  ...over,
});

describe("createRow", () => {
  // createRow re-reads the database from the config, so the config holds it.
  const withDb = async (over: Partial<DatabaseSpec> = {}) => {
    const db = projects(over);
    await call("config.set", ["databases", db.name], db);
    return spec({ source: { kind: "tag", tag: "project" }, database: db });
  };

  test("makes the page in the folder, tagged, with the defaults", async () => {
    const r = await createRow(await withDb(), " Launch ");
    expect(r).toMatchObject({ ok: true, page: "Projects/Launch" });
    const text = await call("space.readPage", "Projects/Launch");
    expect(text).toBe(
      "---\ntags:\n  - project\nstatus: active\ncount: 0\n---\n\n",
    );
    if (r.ok) {
      expect(r.modified).toBe(
        String(
          (await call("space.getPageMeta", "Projects/Launch")).lastModified,
        ),
      );
    }
  });

  test("the template's body follows, its own frontmatter dropped", async () => {
    await writePage(
      "Templates/Project",
      "---\ntags: template\nstatus: ignored\n---\n# Goal\n\n- [ ] first step\n",
    );
    const r = await createRow(
      await withDb({ template: "Templates/Project" }),
      "Launch",
    );
    expect(r.ok).toBe(true);
    const text = await call("space.readPage", "Projects/Launch");
    expect(text).toContain("tags:\n  - project\nstatus: active\n");
    expect(text).not.toContain("ignored");
    expect(text).toContain("# Goal\n\n- [ ] first step\n");
  });

  test("a page that is there already is left alone", async () => {
    await writePage("Projects/Launch", "mine");
    const r = await createRow(await withDb(), "Launch");
    expect(r).toMatchObject({ ok: false, reason: "exists" });
    expect(await call("space.readPage", "Projects/Launch")).toBe("mine");
  });

  test("no usable title, or no database, is refused", async () => {
    expect(await createRow(await withDb(), " / ")).toMatchObject({
      ok: false,
      reason: "invalid",
    });
    expect(await createRow(spec(), "Launch")).toMatchObject({
      ok: false,
      reason: "invalid",
    });
  });

  test("a title with ref syntax makes a plain page name", async () => {
    const r = await createRow(await withDb(), "a#b [[x]] v1.2");
    expect(r).toMatchObject({ ok: true, page: "Projects/ab x v1" });
  });

  test("what is written follows the config, not the spec sent back", async () => {
    const s = await withDb();
    const forged = { ...s, database: { ...s.database!, folder: "Evil/" } };
    const r = await createRow(forged, "Launch");
    expect(r).toMatchObject({ ok: true, page: "Projects/Launch" });
    const gone = spec({
      database: { ...projects(), name: "nowhere", folder: "Evil/" },
    });
    expect(await createRow(gone, "Launch")).toMatchObject({
      ok: false,
      reason: "invalid",
    });
  });

  test("a failing existence check is a failure, not a go-ahead", async () => {
    const s = await withDb();
    const real = (globalThis as any).syscall;
    (globalThis as any).syscall = (name: string, ...args: unknown[]) =>
      name === "space.getPageMeta"
        ? Promise.reject(new Error("disk on fire"))
        : real(name, ...args);
    try {
      expect(await createRow(s, "Launch")).toMatchObject({
        ok: false,
        reason: "failed",
      });
    } finally {
      (globalThis as any).syscall = real;
    }
    await expect(call("space.readPage", "Projects/Launch")).rejects.toThrow();
  });

  test("a missing template is a failure, and nothing is written", async () => {
    const r = await createRow(
      await withDb({ template: "Templates/None" }),
      "Launch",
    );
    expect(r).toMatchObject({ ok: false, reason: "failed" });
    await expect(call("space.readPage", "Projects/Launch")).rejects.toThrow();
  });
});

describe("indexedModified", () => {
  test("is what the index holds for a page, or null", async () => {
    const { indexedModified } = await import("./functions.ts");
    await call("index.indexObjects", "Seed", [
      {
        ref: "Idx/P",
        tag: "page",
        name: "Idx/P",
        tags: [],
        lastModified: "2026-10-01T00:00:00Z",
      },
    ]);
    expect(await indexedModified("Idx/P")).toBe("2026-10-01T00:00:00Z");
    expect(await indexedModified("Idx/None")).toBeNull();
  });
});
