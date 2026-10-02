import { describe, expect, test } from "vitest";
import { rowPageName, rowPatches } from "./create.ts";

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
