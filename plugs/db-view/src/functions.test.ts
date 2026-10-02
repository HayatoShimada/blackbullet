import { beforeEach, describe, expect, test } from "vitest";
import { createMockSystem } from "../../../plug-api/system_mock.ts";
import { extractFrontmatter, patchFrontmatter } from "../../index/api.ts";
import {
  archiveRow,
  createRow,
  deleteRow,
  duplicateRow,
  loadRows,
  renameRow,
  restoreTrashed,
  saveView,
  updatePageValue,
  updateTask,
} from "./functions.ts";
import type { DatabaseSpec, Spec } from "./model.ts";

const call = (name: string, ...args: unknown[]) =>
  (globalThis as any).syscall(name, ...args);

let renameMode: "ok" | "refuse" | "throw-after-write" = "ok";

beforeEach(() => {
  renameMode = "ok";
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
      if (name === "index.renamePageCommand") {
        if (renameMode === "refuse") return false;
        const text = await call("space.readPage", args[0].oldPage);
        await call("space.writePage", args[0].page, text);
        if (renameMode === "throw-after-write") throw new Error("boom");
        await call("space.deletePage", args[0].oldPage);
        return true;
      }
      throw new Error(`unexpected ${name}`);
    },
    // The Lua runtime is not loaded here: read the call the plug builds, and
    // expand `${title}` / `${page}` in the text as `database.expandTemplate`.
    "lua.evalExpression": async (_ctx: unknown, expression: string) => {
      const long = /\[(=*)\[\n([\s\S]*?)\]\1\]/g;
      const [text, title, name, page] = [...expression.matchAll(long)].map(
        (m) => m[2],
      );
      if (text.includes("${boom}")) throw new Error("attempt to call nil");
      return text
        .replaceAll("${title}", title)
        .replaceAll("${name}", name)
        .replaceAll("${page}", page);
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

  test("a declared select takes only its options", async () => {
    const db = projects();
    await call("config.set", ["databases", db.name], db);
    const modified = await writePage("Projects/A", original);
    const bad = await updatePageValue(
      "Projects/A",
      "status",
      "select",
      "dnoe",
      modified,
      db.name,
    );
    expect(bad).toMatchObject({ ok: false, reason: "invalid" });
    expect(await call("space.readPage", "Projects/A")).toBe(original);
    const good = await updatePageValue(
      "Projects/A",
      "status",
      "select",
      "done",
      modified,
      db.name,
    );
    expect(good.ok).toBe(true);
  });

  test("a declared type wins over the kind the caller sent", async () => {
    const db = projects();
    await call("config.set", ["databases", db.name], db);
    const modified = await writePage("Projects/A", original);
    const r = await updatePageValue(
      "Projects/A",
      "count",
      "text",
      "many",
      modified,
      db.name,
    );
    expect(r).toMatchObject({ ok: false, reason: "invalid" });
  });

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

  test("tasks on templates, library pages and in the trash are left out", async () => {
    await index([
      task(1, "Plan", false),
      task(2, "Templates/Project", false),
      task(3, "Library/Std/Docs/Fork Guide", false),
      task(4, "Trash/Plan", false),
    ]);
    const { rows } = await loadRows(spec({ source: { kind: "tasks" } }));
    expect(rows.map((r) => r.page)).toEqual(["Plan"]);
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

  test("the template's body follows; the tag and defaults win over its frontmatter", async () => {
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
    // The template's `status: ignored` is overridden by the database's default.
    expect(text).toContain("tags:\n  - project\n");
    expect(text).toContain("status: active\n");
    expect(text).not.toContain("ignored");
    expect(text).toContain("# Goal\n\n- [ ] first step\n");
  });

  test("the template's ${...} is expanded and its frontmatter merged", async () => {
    await writePage(
      "Templates/Project",
      "---\ntags: meta/template/page\narea: work\nnote: for ${title}\nstatus: done\n---\n# ${title}\n\nsee ${page}\n",
    );
    const r = await createRow(
      await withDb({ template: "Templates/Project" }),
      "Launch",
    );
    expect(r.ok).toBe(true);
    const text = await call("space.readPage", "Projects/Launch");
    expect(text).toContain("area: work\n");
    expect(text).toContain("note: for Launch\n");
    // The tag and the defaults win over the template's own values.
    expect(text).toContain("tags:\n  - project\n");
    expect(text).toContain("status: active\n");
    expect(text).not.toContain("meta/template");
    expect(text).toContain("# Launch\n\nsee Projects/Launch\n");
  });

  test("${name} is an alias of ${title}", async () => {
    await writePage(
      "Templates/Project",
      "---\ntags: meta/template/page\n---\n# ${name}\n",
    );
    const r = await createRow(
      await withDb({ template: "Templates/Project" }),
      "Launch",
    );
    expect(r.ok).toBe(true);
    const text = await call("space.readPage", "Projects/Launch");
    expect(text).toContain("# Launch\n");
    expect(text).not.toContain("nil");
  });

  test("a template that cannot be filled in is a failure that names the template", async () => {
    await writePage(
      "Templates/Broken",
      "---\ntags: meta/template/page\n---\n# ${boom}\n",
    );
    const r = await createRow(
      await withDb({ template: "Templates/Broken" }),
      "Launch",
    );
    expect(r).toMatchObject({ ok: false, reason: "failed" });
    if (!r.ok) {
      expect(r.message).toContain("Templates/Broken");
      expect(r.message).toContain("${title}");
    }
    await expect(call("space.readPage", "Projects/Launch")).rejects.toThrow();
  });

  test("a template's frontmatter: key holds the page's own attributes", async () => {
    await writePage(
      "Templates/Project",
      "---\ntags: meta/template/page\nfrontmatter:\n  area: ops\n---\nbody\n",
    );
    await createRow(await withDb({ template: "Templates/Project" }), "Launch");
    const text = await call("space.readPage", "Projects/Launch");
    expect(text).toContain("area: ops\n");
    expect(text).not.toContain("frontmatter");
  });

  test("a date default of today is the day the row is made", async () => {
    const s = await withDb({
      properties: [{ key: "start", type: "date", default: "today" }],
    });
    await createRow(s, "Launch");
    const text = await call("space.readPage", "Projects/Launch");
    expect(text).toMatch(/start: \d{4}-\d{2}-\d{2}\n/);
  });

  test("values are set last, and checked against the property", async () => {
    const s = await withDb();
    const r = await createRow(s, "Launch", {
      status: "done",
      due: "2026-10-05",
    });
    expect(r.ok).toBe(true);
    const text = await call("space.readPage", "Projects/Launch");
    expect(text).toContain("status: done\n");
    expect(text).toContain("due: 2026-10-05\n");
    expect(text).not.toContain("status: active");
  });

  test("a value the property does not allow writes nothing", async () => {
    const s = await withDb();
    const r = await createRow(s, "Launch", { status: "bogus" });
    expect(r).toMatchObject({ ok: false, reason: "invalid" });
    await expect(call("space.readPage", "Projects/Launch")).rejects.toThrow();
  });

  test("a page that is there already is left alone", async () => {
    await writePage("Projects/Launch", "mine");
    const r = await createRow(await withDb(), "Launch");
    // The refusal names the page, not the folder path.
    expect(r).toEqual({
      ok: false,
      reason: "exists",
      message: "A page named Launch already exists.",
    });
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

describe("row actions", () => {
  const db = projects();
  const view = (): Spec =>
    spec({ source: { kind: "tag", tag: "project" }, database: db });
  const seed = async (name = "Projects/A") => {
    const modified = await writePage(
      name,
      "---\ntags: project\nstatus: active\n---\n# A\n",
    );
    await index([
      {
        ref: name,
        tag: "page",
        name,
        tags: ["project"],
        lastModified: modified,
      },
    ]);
    return modified;
  };
  const exists = async (name: string) => {
    try {
      await call("space.getPageMeta", name);
      return true;
    } catch {
      return false;
    }
  };

  test("delete moves the page to Trash/, marked with where it was from", async () => {
    const m = await seed();
    expect(await deleteRow(view(), "Projects/A", m)).toEqual({
      ok: true,
      page: "Projects/A",
      modified: null,
    });
    expect(await exists("Projects/A")).toBe(false);
    const text: string = await call("space.readPage", "Trash/Projects/A");
    expect(text).toContain("# A");
    expect(text).toContain("trashedFrom: Projects/A");
    expect(text).toMatch(/trashedAt: ['"]?\d{4}-\d{2}-\d{2}/);
  });

  test("a second delete of the same name gets a numbered trash page", async () => {
    await writePage("Trash/Projects/A", "old");
    await writePage("Trash/Projects/A 2", "older");
    const m = await seed();
    await deleteRow(view(), "Projects/A", m);
    expect(await call("space.readPage", "Trash/Projects/A")).toBe("old");
    expect(await exists("Trash/Projects/A 3")).toBe(true);
  });

  test("a trashed page is out of the view even if still indexed", async () => {
    const m = await seed();
    await deleteRow(view(), "Projects/A", m);
    await index([
      {
        ref: "Trash/Projects/A",
        tag: "page",
        name: "Trash/Projects/A",
        tags: ["project"],
        lastModified: "x",
      },
    ]);
    const noFolder = spec({ source: { kind: "tag", tag: "project" } });
    const { rows } = await loadRows(noFolder);
    expect(rows.map((r) => r.page)).not.toContain("Trash/Projects/A");
  });

  test("restore moves it back, drops the marks, and refuses a taken name", async () => {
    const m = await seed();
    await deleteRow(view(), "Projects/A", m);
    await writePage("Projects/A", "someone else");
    const refused = await restoreTrashed("Trash/Projects/A");
    expect(refused).toMatchObject({
      ok: false,
      reason: "exists",
      message: "A page named A already exists.",
    });
    expect(await exists("Trash/Projects/A")).toBe(true);
    await call("space.deletePage", "Projects/A");
    const back = await restoreTrashed("Trash/Projects/A");
    expect(back).toMatchObject({ ok: true, page: "Projects/A" });
    expect(await exists("Trash/Projects/A")).toBe(false);
    const text: string = await call("space.readPage", "Projects/A");
    expect(text).toContain("# A");
    expect(text).not.toContain("trashed");
  });

  test("a refused rename leaves the page unchanged, with no marks", async () => {
    const m = await seed();
    const before = await call("space.readPage", "Projects/A");
    renameMode = "refuse";
    expect(await deleteRow(view(), "Projects/A", m)).toMatchObject({
      ok: false,
      reason: "failed",
    });
    expect(await call("space.readPage", "Projects/A")).toBe(before);
    expect(await exists("Trash/Projects/A")).toBe(false);
  });

  test("a rename that fails after writing the target makes no duplicate", async () => {
    const m = await seed();
    renameMode = "throw-after-write";
    expect(await deleteRow(view(), "Projects/A", m)).toMatchObject({
      ok: false,
      reason: "failed",
    });
    expect(await exists("Trash/Projects/A")).toBe(true);
    expect(await call("space.readPage", "Projects/A")).toContain("trashedFrom");
  });

  test("restore with a failing rename keeps the trashed page", async () => {
    const m = await seed();
    await deleteRow(view(), "Projects/A", m);
    renameMode = "refuse";
    expect(await restoreTrashed("Trash/Projects/A")).toMatchObject({
      ok: false,
      reason: "failed",
    });
    expect(await exists("Trash/Projects/A")).toBe(true);
  });

  test("restore refuses a trashedFrom inside the trash", async () => {
    await writePage("Trash/Hand", "---\ntrashedFrom: Trash/x\n---\nx");
    expect(await restoreTrashed("Trash/Hand")).toMatchObject({
      ok: false,
      reason: "invalid",
    });
  });

  test("tasks on a trashed page are out of a tasks view", async () => {
    await index(
      [
        {
          ref: "Trash/P@1",
          tag: "task",
          name: "gone",
          page: "Trash/P",
          state: " ",
        },
        { ref: "Live@1", tag: "task", name: "kept", page: "Live", state: " " },
      ],
      "Seed",
    );
    const { rows } = await loadRows(spec({ source: { kind: "tasks" } }));
    expect(rows.map((r) => r.page)).toEqual(["Live"]);
  });

  test("a project source skips trashed pages", async () => {
    await index([
      {
        ref: "Trash/Q",
        tag: "page",
        name: "Trash/Q",
        tags: ["project"],
        lastModified: "x",
      },
    ]);
    const { rows } = await loadRows(spec());
    expect(rows.map((r) => r.page)).not.toContain("Trash/Q");
  });

  test("restore refuses pages that were not trashed", async () => {
    await writePage("Trash/Plain", "x");
    expect(await restoreTrashed("Trash/Plain")).toMatchObject({
      ok: false,
      reason: "invalid",
    });
    expect(await restoreTrashed("Projects/A")).toMatchObject({
      ok: false,
      reason: "invalid",
    });
  });

  test("delete refuses a changed page and one that is not a row", async () => {
    await seed();
    const stale = await deleteRow(view(), "Projects/A", "old");
    expect(stale).toMatchObject({ ok: false, reason: "stale" });
    expect(await exists("Projects/A")).toBe(true);
    await writePage("Other/X", "x");
    const other = await deleteRow(view(), "Other/X", "m");
    expect(other).toMatchObject({ ok: false, reason: "invalid" });
    expect(await exists("Other/X")).toBe(true);
    const tasks = await deleteRow(
      spec({ source: { kind: "tasks" } }),
      "Projects/A",
      "m",
    );
    expect(tasks).toMatchObject({ ok: false, reason: "invalid" });
  });

  test("archive sets the flag, restore removes it", async () => {
    const m = await seed();
    const r = await archiveRow(view(), "Projects/A", true, m);
    expect(r.ok).toBe(true);
    expect(await call("space.readPage", "Projects/A")).toContain(
      "archived: true",
    );
    if (!r.ok || r.modified === null) throw new Error("expected ok");
    const back = await archiveRow(view(), "Projects/A", false, r.modified);
    expect(back.ok).toBe(true);
    expect(await call("space.readPage", "Projects/A")).not.toContain(
      "archived",
    );
  });

  test("archived rows are hidden unless the spec asks", async () => {
    await index([
      { ref: "Projects/A", tag: "page", name: "Projects/A", tags: ["project"] },
      {
        ref: "Projects/B",
        tag: "page",
        name: "Projects/B",
        tags: ["project"],
        archived: true,
      },
    ]);
    const shown = await loadRows(view());
    expect(shown.rows.map((r) => r.id)).toEqual(["Projects/A"]);
    const all = await loadRows({ ...view(), showArchived: true });
    expect(all.rows.map((r) => r.id).sort()).toEqual([
      "Projects/A",
      "Projects/B",
    ]);
  });

  test("duplicate copies to the first free name", async () => {
    const m = await seed();
    const one = await duplicateRow(view(), "Projects/A", m);
    expect(one).toMatchObject({ ok: true, page: "Projects/A copy" });
    const two = await duplicateRow(view(), "Projects/A", m);
    expect(two).toMatchObject({ ok: true, page: "Projects/A copy 2" });
    expect(await call("space.readPage", "Projects/A copy")).toContain("# A");
  });

  test("duplicating an archived row gives a live copy", async () => {
    const m = await seed();
    const a = await archiveRow(view(), "Projects/A", true, m);
    if (!a.ok) throw new Error("archive failed");
    await duplicateRow(view(), "Projects/A", a.modified ?? m);
    const copy = await call("space.readPage", "Projects/A copy");
    expect(copy).not.toContain("archived");
    expect(copy).toContain("status: active");
  });

  test("a where on archived is not filtered twice", async () => {
    await index([
      {
        ref: "Projects/B",
        tag: "page",
        name: "Projects/B",
        tags: ["project"],
        archived: true,
      },
    ]);
    const r = await loadRows({ ...view(), where: { archived: true } });
    expect(r.rows.map((x) => x.id)).toEqual(["Projects/B"]);
  });

  test("rename keeps the folder and refuses a taken or empty name", async () => {
    const m = await seed();
    await writePage("Projects/Taken", "x");
    expect(await renameRow(view(), "Projects/A", "Taken", m)).toMatchObject({
      ok: false,
      reason: "exists",
    });
    expect(await renameRow(view(), "Projects/A", " / ", m)).toMatchObject({
      ok: false,
      reason: "invalid",
    });
    const r = await renameRow(view(), "Projects/A", "B/Renamed", m);
    expect(r).toMatchObject({ ok: true, page: "Projects/BRenamed" });
    expect(await exists("Projects/A")).toBe(false);
    expect(await exists("Projects/BRenamed")).toBe(true);
  });
});

describe("where operators against loaded rows", () => {
  test("overdue and unassigned views", async () => {
    await index([
      {
        ref: "Projects/A",
        tag: "page",
        name: "Projects/A",
        tags: ["project"],
        due: "2026-09-01",
      },
      {
        ref: "Projects/B",
        tag: "page",
        name: "Projects/B",
        tags: ["project"],
        due: "2026-12-01",
        owner: "me",
      },
      { ref: "Projects/C", tag: "page", name: "Projects/C", tags: ["project"] },
    ]);
    const names = async (where: Spec["where"]) =>
      (await loadRows(spec({ where }), "2026-10-02")).rows
        .map((r) => r.page)
        .sort();
    expect(await names({ due: { before: "today" } })).toEqual(["Projects/A"]);
    expect(await names({ owner: { empty: true } })).toEqual([
      "Projects/A",
      "Projects/C",
    ]);
    expect(
      await names({ due: { empty: false }, owner: { not: "you" } }),
    ).toEqual(["Projects/A", "Projects/B"]);
  });
});

describe("saveView", () => {
  const body = "source: projects\nsort: title";
  const text = `# Home\n\n\`\`\`db\n${body}\n\`\`\`\n\nafter\n`;

  test("rewrites only the block", async () => {
    await writePage("Home", text);
    const r = await saveView("Home", body, {
      view: "board",
      sort: { key: "due", desc: true },
      filter: "app",
    });
    expect(r).toEqual({
      ok: true,
      body: 'source: projects\nsort: -due\nview: board\nfilter: "app"',
    });
    expect(await call("space.readPage", "Home")).toBe(
      `# Home\n\n\`\`\`db\nsource: projects\nsort: -due\nview: board\nfilter: "app"\n\`\`\`\n\nafter\n`,
    );
  });
  test("a block edited meanwhile is left alone", async () => {
    await writePage("Home", text.replace("sort: title", "sort: status"));
    const r = await saveView("Home", body, { view: "board", filter: "" });
    expect(r).toMatchObject({ ok: false, reason: "stale" });
    expect(await call("space.readPage", "Home")).toContain("sort: status");
  });
  test("an unknown view is refused", async () => {
    await writePage("Home", text);
    const r = await saveView("Home", body, {
      view: "gantt" as any,
      filter: "",
    });
    expect(r).toMatchObject({ ok: false, reason: "invalid" });
    expect(await call("space.readPage", "Home")).toBe(text);
  });
});
