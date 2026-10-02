import { describe, expect, test } from "vitest";
import { linkTarget } from "./cell.tsx";

describe("linkTarget", () => {
  test("wiki links, with or without an alias, and plain names", () => {
    expect(linkTarget("[[Areas/X]]")).toBe("Areas/X");
    expect(linkTarget("[[Areas/X|alias]]")).toBe("Areas/X");
    expect(linkTarget("  Areas/X ")).toBe("Areas/X");
    expect(linkTarget("")).toBe("");
  });
  test("a malformed bracket is left as it is", () => {
    expect(linkTarget("[[Areas/X")).toBe("[[Areas/X");
    expect(linkTarget("[[a]] b")).toBe("[[a]] b");
  });
  test("header details are kept", () => {
    expect(linkTarget("[[X#h]]")).toBe("X#h");
  });
});
