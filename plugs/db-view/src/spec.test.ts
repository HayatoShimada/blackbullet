import { describe, expect, test } from "vitest";
import { parseSpec } from "./spec.ts";

const ok = (raw: unknown) => {
  const r = parseSpec(raw);
  if (!r.ok) throw new Error(r.error);
  return r.spec;
};
const err = (raw: unknown) => {
  const r = parseSpec(raw);
  if (r.ok) throw new Error("expected an error");
  return r.error;
};

describe("parseSpec", () => {
  test("a bare source gets the defaults", () => {
    expect(ok({ source: "projects" })).toEqual({
      source: { kind: "projects" },
      view: "table",
      title: undefined,
      group: "status",
      date: "due",
      columns: undefined,
      sort: undefined,
      order: undefined,
      where: {},
      limit: 500,
      weekStart: 0,
    });
  });

  test("the three ways to name a tag", () => {
    expect(ok({ source: "tag:meeting" }).source).toEqual({
      kind: "tag",
      tag: "meeting",
    });
    expect(ok({ source: "tag", tag: "meeting" }).source).toEqual({
      kind: "tag",
      tag: "meeting",
    });
    expect(ok({ tag: "meeting" }).source).toEqual({
      kind: "tag",
      tag: "meeting",
    });
  });

  test("a full spec", () => {
    const spec = ok({
      source: "tasks",
      view: "calendar",
      title: "今週",
      date: "start",
      sort: "-due",
      where: { done: false, area: "仕入れ" },
      limit: 50,
      weekStart: 1,
      columns: ["title", "due"],
      order: ["a", "b"],
    });
    expect(spec).toMatchObject({
      view: "calendar",
      title: "今週",
      date: "start",
      sort: { key: "due", desc: true },
      where: { done: false, area: "仕入れ" },
      limit: 50,
      weekStart: 1,
      columns: ["title", "due"],
      order: ["a", "b"],
    });
  });

  test("an ascending sort", () => {
    expect(ok({ source: "projects", sort: "due" }).sort).toEqual({
      key: "due",
      desc: false,
    });
  });

  test.each([
    [null, "YAML"],
    [[], "YAML"],
    ["text", "YAML"],
    [{}, "source が必要"],
    [{ source: "nope" }, "nope"],
    [{ source: "tag:" }, "tag の名前"],
    [{ source: "tag" }, "tag の名前"],
    [{ source: "projects", view: "gantt" }, "gantt"],
    [{ source: "projects", limit: 0 }, "limit"],
    [{ source: "projects", limit: 2.5 }, "limit"],
    [{ source: "projects", weekStart: 2 }, "weekStart"],
    [{ source: "projects", columns: "a" }, "columns"],
    [{ source: "projects", order: [1] }, "order"],
    [{ source: "projects", where: "x" }, "where"],
    [{ source: "projects", where: { a: [] } }, "where"],
    [{ source: "projects", sort: "" }, "sort"],
    [{ source: "projects", group: 1 }, "group"],
  ])("rejects %j", (raw, message) => {
    expect(err(raw)).toContain(message);
  });
});
