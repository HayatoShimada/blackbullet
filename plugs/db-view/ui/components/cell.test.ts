import { describe, expect, test } from "vitest";
import type { DbRow } from "../../src/model.ts";
import { dueWord, isDoneRow, linkTarget } from "./cell.tsx";
import { monthTitle } from "./calendar_view.tsx";

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

describe("dueWord", () => {
  const today = "2026-10-02";
  test("overdue, today and tomorrow are said in words", () => {
    expect(dueWord("2026-09-28", today)).toBe("overdue");
    expect(dueWord("2026-10-02", today)).toBe("today");
    expect(dueWord("2026-10-03", today)).toBe("tomorrow");
  });
  test("later, empty and non-dates have no word", () => {
    expect(dueWord("2026-10-04", today)).toBeNull();
    expect(dueWord("2027-01-01", today)).toBeNull();
    expect(dueWord("", today)).toBeNull();
    expect(dueWord("soon", today)).toBeNull();
  });
  test("tomorrow crosses a month end", () => {
    expect(dueWord("2026-11-01", "2026-10-31")).toBe("tomorrow");
  });
});

describe("monthTitle", () => {
  test("reads like October 2026", () => {
    expect(monthTitle(2026, 10)).toBe("October 2026");
    expect(monthTitle(2027, 1)).toBe("January 2027");
  });
});

describe("isDoneRow", () => {
  const row = (values: Record<string, unknown>) => ({ values }) as DbRow;
  test("a ticked task and a page whose status is done are finished", () => {
    expect(isDoneRow(row({ done: true }))).toBe(true);
    expect(isDoneRow(row({ status: "done" }))).toBe(true);
  });
  test("an open task and an active page are not", () => {
    expect(isDoneRow(row({ done: false }))).toBe(false);
    expect(isDoneRow(row({ status: "active" }))).toBe(false);
    expect(isDoneRow(row({}))).toBe(false);
  });
});
