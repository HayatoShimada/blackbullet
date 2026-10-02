import { describe, expect, test } from "vitest";
import { isStale, parseCellInput, setTaskDone, setTaskDue } from "./edit.ts";

const page =
  "# Plan\n\n- [ ] first #next\n  - [x] nested [due: 2026-10-01]\n1. [ ] numbered\nplain text\n";

const posOf = (needle: string) => page.indexOf(needle);

describe("setTaskDone", () => {
  test("ticks and unticks, changing nothing else", () => {
    const ticked = setTaskDone(page, posOf("- [ ] first"), " ", true);
    expect(ticked).toEqual({
      ok: true,
      text: page.replace("- [ ] first", "- [x] first"),
    });
    const unticked = setTaskDone(page, posOf("- [x] nested"), "x", false);
    expect(unticked).toEqual({
      ok: true,
      text: page.replace("- [x] nested", "- [ ] nested"),
    });
  });

  test("works on a numbered task and on a nested one", () => {
    expect(setTaskDone(page, posOf("1. [ ]"), " ", true)).toEqual({
      ok: true,
      text: page.replace("1. [ ]", "1. [x]"),
    });
  });

  test("a line that no longer shows the state the index saw is stale", () => {
    expect(setTaskDone(page, posOf("- [ ] first"), "x", true)).toEqual({
      ok: false,
      reason: "stale",
    });
  });

  test("a position that is not a task is refused", () => {
    expect(setTaskDone(page, posOf("plain text"), " ", true)).toEqual({
      ok: false,
      reason: "not-a-task",
    });
    expect(setTaskDone(page, 9999, " ", true)).toEqual({
      ok: false,
      reason: "stale",
    });
  });
});

describe("setTaskDue", () => {
  test("replaces an existing due date", () => {
    const r = setTaskDue(page, posOf("- [x] nested"), "x", "2026-12-24");
    expect(r).toEqual({
      ok: true,
      text: page.replace("[due: 2026-10-01]", "[due: 2026-12-24]"),
    });
  });

  test("adds one at the end of the line when there is none", () => {
    const r = setTaskDue(page, posOf("- [ ] first"), " ", "2026-11-05");
    expect(r).toEqual({
      ok: true,
      text: page.replace("first #next", "first #next [due: 2026-11-05]"),
    });
  });

  test("clears it, and the space before it", () => {
    const r = setTaskDue(page, posOf("- [x] nested"), "x", null);
    expect(r).toEqual({
      ok: true,
      text: page.replace("nested [due: 2026-10-01]", "nested"),
    });
  });

  test("clearing a date that is not there changes nothing", () => {
    const r = setTaskDue(page, posOf("- [ ] first"), " ", null);
    expect(r).toEqual({ ok: true, text: page });
  });

  test("a stale or a non-task line is refused", () => {
    expect(setTaskDue(page, posOf("- [ ] first"), "x", "2026-11-05")).toEqual({
      ok: false,
      reason: "stale",
    });
    expect(setTaskDue(page, posOf("plain"), " ", "2026-11-05")).toEqual({
      ok: false,
      reason: "not-a-task",
    });
  });

  test("only the task's own line is touched, even when a later line has a due", () => {
    const text = "- [ ] a\n- [ ] b [due: 2026-01-01]";
    expect(setTaskDue(text, 0, " ", "2026-02-02")).toEqual({
      ok: true,
      text: "- [ ] a [due: 2026-02-02]\n- [ ] b [due: 2026-01-01]",
    });
  });
});

describe("parseCellInput", () => {
  test("dates must be real", () => {
    expect(parseCellInput("date", "2026-10-02")).toEqual({
      ok: true,
      value: "2026-10-02",
    });
    expect(parseCellInput("date", "2026-02-30").ok).toBe(false);
    expect(parseCellInput("date", "tomorrow").ok).toBe(false);
  });
  test("an empty cell clears the attribute", () => {
    for (const kind of ["text", "select", "date", "number"] as const) {
      expect(parseCellInput(kind, "  ")).toEqual({ ok: true, value: null });
    }
  });
  test("numbers", () => {
    expect(parseCellInput("number", "3.5")).toEqual({ ok: true, value: 3.5 });
    expect(parseCellInput("number", "abc").ok).toBe(false);
  });
  test("booleans and text", () => {
    expect(parseCellInput("boolean", true)).toEqual({ ok: true, value: true });
    expect(parseCellInput("boolean", false)).toEqual({
      ok: true,
      value: false,
    });
    expect(parseCellInput("text", " hello ")).toEqual({
      ok: true,
      value: "hello",
    });
    expect(parseCellInput("select", "active")).toEqual({
      ok: true,
      value: "active",
    });
  });
});

describe("isStale", () => {
  test("a changed page is stale", () => {
    expect(isStale("a", "a")).toBe(false);
    expect(isStale("a", "b")).toBe(true);
  });
});
