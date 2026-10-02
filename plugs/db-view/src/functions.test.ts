import { beforeEach, describe, expect, test } from "vitest";
import { createMockSystem } from "../../../plug-api/system_mock.ts";
import { patchFrontmatter } from "../../index/api.ts";
import { loadRows, updatePageValue, updateTask } from "./functions.ts";
import type { Spec } from "./model.ts";

const call = (name: string, ...args: unknown[]) =>
  (globalThis as any).syscall(name, ...args);

beforeEach(() => {
  const mock = createMockSystem();
  // The index plug is not loaded here: stand in for the one function used.
  mock.system.registerSyscalls([], {
    "system.invokeFunction": async (
      _ctx: unknown,
      name: string,
      ...args: any[]
    ) => {
      if (name === "index.patchFrontmatter")
        return patchFrontmatter(args[0], args[1]);
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
