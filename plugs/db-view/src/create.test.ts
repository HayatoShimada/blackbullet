import { describe, expect, test } from "vitest";
import {
  copyName,
  expandExpression,
  folderOf,
  inheritedFrontmatter,
  luaLongString,
  renamedPage,
  rowPageName,
  rowPatches,
  valuePatches,
} from "./create.ts";

describe("rowPageName", () => {
  test("the folder, then the title", () => {
    expect(rowPageName("Projects/", "Launch")).toBe("Projects/Launch");
    expect(rowPageName("", "Launch")).toBe("Launch");
  });
  test("a slash would make a folder, a dot a hidden file: both go", () => {
    expect(rowPageName("P/", " a/b ")).toBe("P/ab");
    expect(rowPageName("P/", "..hidden.")).toBe("P/hidden");
  });
  test("a trailing .<alnum> would read as an extension: it goes", () => {
    expect(rowPageName("P/", "v1.2")).toBe("P/v1");
    expect(rowPageName("P/", "Launch v1.0")).toBe("P/Launch v1");
    expect(rowPageName("P/", "Foo.md")).toBe("P/Foo");
    expect(rowPageName("P/", "Foo.2")).toBe("P/Foo");
    expect(rowPageName("P/", "a.b c")).toBe("P/a.b c");
  });
  test("ref syntax and control characters go", () => {
    expect(rowPageName("P/", "a#b")).toBe("P/ab");
    expect(rowPageName("P/", "a@1")).toBe("P/a1");
    expect(rowPageName("P/", "[[x]]")).toBe("P/x");
    expect(rowPageName("P/", "a|b")).toBe("P/ab");
    expect(rowPageName("P/", "a<b>$c\n\u0000")).toBe("P/abc");
  });
  test("the length is capped", () => {
    expect(rowPageName("P/", "x".repeat(500))).toBe(`P/${"x".repeat(100)}`);
  });
  test("nothing left is no name", () => {
    for (const bad of ["", "  ", "/", "...", " ./ "]) {
      expect(rowPageName("P/", bad)).toBeNull();
    }
  });
});

describe("rowPatches", () => {
  test("the tag, then every default in order", () => {
    expect(
      rowPatches({
        name: "p",
        tag: "project",
        folder: "P/",
        properties: [
          { key: "status", type: "select", options: ["a"], default: "a" },
          { key: "due", type: "date" },
          { key: "n", type: "number", default: 0 },
          { key: "done", type: "boolean", default: false },
        ],
      }),
    ).toEqual([
      { op: "set-key", path: "tags", value: ["project"] },
      { op: "set-key", path: "status", value: "a" },
      { op: "set-key", path: "n", value: 0 },
      { op: "set-key", path: "done", value: false },
    ]);
  });
});

describe("row renaming and copying", () => {
  test("a rename stays in the folder", () => {
    expect(folderOf("Projects/Sub/A")).toBe("Projects/Sub/");
    expect(folderOf("A")).toBe("");
    expect(renamedPage("Projects/A", "New name")).toBe("Projects/New name");
    expect(renamedPage("Projects/A", "a/b")).toBe("Projects/ab");
    expect(renamedPage("Projects/A", "  ")).toBeNull();
  });
  test("a copy takes the first free name", async () => {
    const taken = new Set(["P copy", "P copy 2"]);
    expect(await copyName("P", async (n) => taken.has(n))).toBe("P copy 3");
    expect(await copyName("Q", async (n) => taken.has(n))).toBe("Q copy");
  });
});

describe("rowPatches", () => {
  const db = {
    name: "p",
    tag: "project",
    folder: "P/",
    properties: [
      { key: "start", type: "date" as const, default: "today" },
      { key: "due", type: "date" as const, default: "2026-01-01" },
      { key: "note", type: "text" as const, default: "today" },
    ],
  };
  test("a date default of today is the day the row is made", () => {
    const patches = rowPatches(db, "2026-10-02");
    expect(patches).toContainEqual({
      op: "set-key",
      path: "start",
      value: "2026-10-02",
    });
    // A fixed date, and a text that merely says "today", stay as written.
    expect(patches).toContainEqual({
      op: "set-key",
      path: "due",
      value: "2026-01-01",
    });
    expect(patches).toContainEqual({
      op: "set-key",
      path: "note",
      value: "today",
    });
  });
  test("the template's attributes come first, so the tag and defaults win", () => {
    const patches = rowPatches(db, "2026-10-02", { status: "x", due: "1999" });
    expect(patches[0]).toEqual({ op: "set-key", path: "status", value: "x" });
    const last = (path: string) =>
      patches.filter((p) => "path" in p && p.path === path).at(-1);
    expect(last("due")).toMatchObject({ value: "2026-01-01" });
    expect(last("tags")).toMatchObject({ value: ["project"] });
  });
});

describe("inheritedFrontmatter", () => {
  test("drops what describes the template, keeps the rest", () => {
    expect(
      inheritedFrontmatter({
        tags: "meta/template/page",
        command: "New project",
        frontmatter: "x: 1",
        range: [0, 10],
        status: "active",
        area: "work",
      }),
    ).toEqual({ status: "active", area: "work" });
    expect(inheritedFrontmatter(undefined)).toEqual({});
  });
});

describe("Lua expansion expression", () => {
  test("a long string uses enough = to hold any brackets", () => {
    expect(luaLongString("hi")).toBe("[[\nhi]]");
    expect(luaLongString("a]]b")).toBe("[=[\na]]b]=]");
    expect(luaLongString("a]=]b]]")).toBe("[==[\na]=]b]]]==]");
    // A final ] must not close the string early.
    expect(luaLongString("x]")).toBe("[=[\nx]]=]");
  });
  test("the call names the helper and passes the context", () => {
    const e = expandExpression("${title}", {
      title: "T",
      page: "P/T",
      database: "p",
    });
    expect(e).toBe(
      "database.expandTemplate([[\n${title}]], {title = [[\nT]], page = [[\nP/T]], database = [[\np]]})",
    );
  });
});

describe("valuePatches", () => {
  const db = {
    name: "p",
    tag: "project",
    folder: "P/",
    properties: [
      { key: "status", type: "select" as const, options: ["a", "b"] },
      { key: "n", type: "number" as const },
    ],
  };
  test("checks declared properties by type and options", () => {
    expect(valuePatches(db, { status: "b", n: "3" }, "due")).toEqual({
      ok: true,
      patches: [
        { op: "set-key", path: "status", value: "b" },
        { op: "set-key", path: "n", value: 3 },
      ],
    });
    expect(valuePatches(db, { status: "zzz" }, "due")).toMatchObject({
      ok: false,
    });
    expect(valuePatches(db, { n: "many" }, "due")).toMatchObject({ ok: false });
  });
  test("an undeclared key is text, or a date when it is the date attribute", () => {
    expect(valuePatches(db, { due: "2026-10-05" }, "due")).toEqual({
      ok: true,
      patches: [{ op: "set-key", path: "due", value: "2026-10-05" }],
    });
    expect(valuePatches(db, { due: "soon" }, "due")).toMatchObject({
      ok: false,
    });
    expect(valuePatches(db, { area: "work" }, "due")).toMatchObject({
      ok: true,
    });
  });
  test("tags cannot be set, an empty value sets nothing", () => {
    expect(valuePatches(db, { tags: "x" }, "due")).toMatchObject({ ok: false });
    expect(valuePatches(db, { status: "" }, "due")).toEqual({
      ok: true,
      patches: [],
    });
    expect(valuePatches(db, undefined, "due")).toEqual({
      ok: true,
      patches: [],
    });
  });
});
