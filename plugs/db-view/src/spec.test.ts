import { describe, expect, test } from "vitest";
import type { DatabaseSpec } from "./model.ts";
import { databaseFrom, databaseName, parseSpec } from "./spec.ts";

const projects: DatabaseSpec = {
  name: "projects",
  tag: "project",
  folder: "Projects/",
  title: "Projects",
  properties: [
    { key: "status", type: "select", options: ["active", "done"] },
    { key: "due", type: "date" },
  ],
  order: ["active", "done"],
};

const ok = (raw: unknown, database?: DatabaseSpec) => {
  const r = parseSpec(raw, database);
  if (!r.ok) throw new Error(r.error);
  return r.spec;
};
const err = (raw: unknown, database?: DatabaseSpec) => {
  const r = parseSpec(raw, database);
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

  test("a database: the source, title and order come from it", () => {
    const spec = parseSpec({ database: "projects" }, projects);
    expect(spec.ok).toBe(true);
    if (!spec.ok) return;
    expect(spec.spec).toMatchObject({
      source: { kind: "tag", tag: "project" },
      database: projects,
      title: "Projects",
      order: ["active", "done"],
    });
  });

  test("the block's own title, order and source win over the database's", () => {
    const spec = parseSpec(
      {
        database: "projects",
        title: "Mine",
        order: ["done"],
        source: "tag:other",
      },
      projects,
    );
    expect(spec.ok).toBe(true);
    if (!spec.ok) return;
    expect(spec.spec).toMatchObject({
      source: { kind: "tag", tag: "other" },
      title: "Mine",
      order: ["done"],
    });
  });

  test("another source than the database's tag is not its view: no database on the spec", () => {
    expect(
      ok({ database: "projects", source: "tasks" }, projects).database,
    ).toBeUndefined();
    expect(
      ok({ database: "projects", source: "tag:other" }, projects).database,
    ).toBeUndefined();
    expect(
      ok({ database: "projects", tag: projects.tag }, projects).database,
    ).toEqual(projects);
  });

  test("a database without a title is called by its name", () => {
    const { title, ...untitled } = projects;
    const spec = parseSpec({ database: "projects" }, untitled);
    expect(spec.ok && spec.spec.title).toBe("projects");
  });

  test("a database the config does not hold is an error", () => {
    expect(err({ database: "projects" })).toContain(
      "database projects is not defined; add database.define to CONFIG",
    );
    expect(err({ database: "" }, projects)).toContain("database");
  });

  test("a database given but not named is ignored", () => {
    expect(ok({ source: "projects" }).database).toBeUndefined();
    expect(ok({ source: "projects" }, projects).database).toBeUndefined();
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

describe("databaseName", () => {
  test("the name a block gives, trimmed, or nothing", () => {
    expect(databaseName({ database: " projects " })).toBe("projects");
    expect(databaseName({ database: "" })).toBeUndefined();
    expect(databaseName({ source: "projects" })).toBeUndefined();
    expect(databaseName(null)).toBeUndefined();
  });
});

describe("databaseFrom", () => {
  test("what database.define stored, with its defaults filled in", () => {
    expect(
      databaseFrom({
        name: "projects",
        tag: "project",
        folder: "Projects",
        template: "Templates/Project",
        title: "Projects",
        properties: [
          {
            key: "status",
            type: "select",
            options: ["a", "b"],
            default: "a",
            label: "State",
          },
          { key: "due", type: "date" },
          { key: "n", type: "number", default: 3 },
        ],
        order: ["a", "b"],
      }),
    ).toEqual({
      name: "projects",
      tag: "project",
      folder: "Projects/",
      template: "Templates/Project",
      title: "Projects",
      properties: [
        {
          key: "status",
          type: "select",
          options: ["a", "b"],
          default: "a",
          label: "State",
        },
        { key: "due", type: "date" },
        { key: "n", type: "number", default: 3 },
      ],
      order: ["a", "b"],
    });
  });

  test("a bare name: the tag and folder follow it", () => {
    expect(databaseFrom({ name: "notes" })).toEqual({
      name: "notes",
      tag: "notes",
      folder: "notes/",
      properties: [],
    });
    expect(databaseFrom({ name: "notes", folder: "" })?.folder).toBe("");
  });

  test("a property Lua could not have stored is skipped, nonsense is nothing", () => {
    expect(
      databaseFrom({
        name: "x",
        properties: [
          { key: "ok", type: "text" },
          { key: "bad", type: "blob" },
          1,
        ],
      })?.properties,
    ).toEqual([{ key: "ok", type: "text" }]);
    // An empty Lua list arrives as an object.
    expect(databaseFrom({ name: "x", properties: {} })?.properties).toEqual([]);
    for (const bad of [null, "projects", {}, { name: "" }, { name: 1 }]) {
      expect(databaseFrom(bad)).toBeUndefined();
    }
  });
});
