import { describe, expect, test } from "vitest";
import { countTasks, pageRow, taskRow } from "./rows.ts";

describe("pageRow", () => {
  const obj = {
    ref: "Projects/ハコネコ",
    tag: "page",
    name: "Projects/ハコネコ",
    tags: ["project"],
    itags: ["page"],
    created: "x",
    lastModified: "2026-10-01T00:00:00Z",
    perm: "rw",
    pageDecoration: { icon: "x" },
    status: "active",
    due: "2026-10-05",
    _private: 1,
  };

  test("its own name is the last segment, its attributes are the frontmatter", () => {
    const row = pageRow(obj);
    expect(row).toMatchObject({
      id: "Projects/ハコネコ",
      kind: "page",
      page: "Projects/ハコネコ",
      title: "ハコネコ",
      modified: "2026-10-01T00:00:00Z",
    });
    expect(row.values).toEqual({
      status: "active",
      due: "2026-10-05",
      tags: ["project"],
    });
  });

  test("a display name wins", () => {
    expect(pageRow({ ...obj, displayName: "Hakoneko" }).title).toBe("Hakoneko");
  });

  test("counts are carried", () => {
    expect(pageRow(obj, { open: 2, done: 5 })).toMatchObject({
      openTasks: 2,
      doneTasks: 5,
    });
    expect(pageRow(obj).openTasks).toBeUndefined();
  });
});

describe("taskRow", () => {
  const obj = {
    ref: "Plan@12",
    tag: "task",
    name: "ship it",
    text: "ship it #next",
    page: "Plan",
    pos: 12,
    toPos: 30,
    range: [12, 30],
    state: " ",
    done: false,
    tags: ["task", "next"],
    due: "2026-10-03",
    pageLastModified: "m1",
  };

  test("a task is its text, and keeps where it is written", () => {
    expect(taskRow(obj)).toEqual({
      id: "Plan@12",
      kind: "task",
      page: "Plan",
      title: "ship it",
      values: { due: "2026-10-03", tags: ["next"], done: false },
      modified: "m1",
      range: [12, 30],
      state: " ",
    });
  });
});

describe("countTasks", () => {
  test("open and done per page", () => {
    const counts = countTasks([
      { page: "A", done: false },
      { page: "A", done: true },
      { page: "A", done: true },
      { page: "B", done: false },
    ]);
    expect(counts.get("A")).toEqual({ open: 1, done: 2 });
    expect(counts.get("B")).toEqual({ open: 1, done: 0 });
    expect(counts.get("C")).toBeUndefined();
  });
});
