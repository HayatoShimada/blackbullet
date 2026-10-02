import { describe, expect, test } from "vitest";
import { patchBlockBody, replaceBlock } from "./viewblock.ts";

describe("patchBlockBody", () => {
  test("adds the keys, leaving the rest and comments alone", () => {
    const body = "# my tasks\nsource: tasks\nwhere:\n  done: false\n";
    expect(
      patchBlockBody(body, {
        view: "board",
        sort: { key: "due", desc: true },
        filter: "urgent",
      }),
    ).toBe(
      '# my tasks\nsource: tasks\nwhere:\n  done: false\nview: board\nsort: -due\nfilter: "urgent"\n',
    );
  });
  test("replaces existing lines in place and removes cleared ones", () => {
    const body =
      "source: tasks\nsort: -due\nview: table\nfilter: old\nlimit: 5";
    expect(patchBlockBody(body, { view: "calendar", filter: "" })).toBe(
      "source: tasks\nview: calendar\nlimit: 5",
    );
  });
  test("quotes what plain YAML would misread", () => {
    expect(
      patchBlockBody("source: tasks", {
        view: "table",
        sort: { key: "a: b", desc: false },
        filter: 'say "hi" # now',
      }),
    ).toBe(
      'source: tasks\nview: table\nsort: "a: b"\nfilter: "say \\"hi\\" # now"',
    );
  });
  test("a multi-line value of a managed key goes with it", () => {
    expect(
      patchBlockBody("filter:\n  a\n  b\nsource: tasks", {
        view: "table",
        filter: "x",
      }),
    ).toBe('filter: "x"\nsource: tasks\nview: table');
  });
});

const page = (...bodies: string[]) =>
  `# P\n\n${bodies.map((b) => `\`\`\`db\n${b}\n\`\`\``).join("\n\ntext\n\n")}\n\nend\n`;

describe("replaceBlock", () => {
  test("replaces just the matching block", () => {
    const r = replaceBlock(
      page("source: tasks", "source: projects"),
      "source: projects",
      "source: projects\nview: board",
    );
    expect(r).toEqual({
      ok: true,
      text: page("source: tasks", "source: projects\nview: board"),
    });
  });
  test("a block edited since it was drawn is not found", () => {
    expect(
      replaceBlock(page("source: tasks\nlimit: 3"), "source: tasks", "x"),
    ).toEqual({
      ok: false,
      reason: "missing",
    });
  });
  test("two identical blocks cannot be told apart", () => {
    expect(
      replaceBlock(
        page("source: tasks", "source: tasks"),
        "source: tasks",
        "x",
      ),
    ).toEqual({
      ok: false,
      reason: "ambiguous",
    });
  });
  test("other fenced code is not touched", () => {
    const text = "```js\nsource: tasks\n```\n";
    expect(replaceBlock(text, "source: tasks", "x")).toEqual({
      ok: false,
      reason: "missing",
    });
  });
});

describe("patchBlockBody edge cases", () => {
  const sortLine = (key: string) =>
    patchBlockBody("source: a", {
      view: "table",
      sort: { key, desc: false },
      filter: "",
    })
      .split("\n")
      .find((l) => l.startsWith("sort:"));
  test("numeric-looking and reserved sort keys are quoted", () => {
    expect(sortLine("2024")).toBe('sort: "2024"');
    expect(sortLine("true")).toBe('sort: "true"');
    expect(sortLine("due")).toBe("sort: due");
  });
  test("comments are kept", () => {
    const out = patchBlockBody(
      "source: a\nsort: due  # newest\nfilter: x\n  # note\nview: board",
      { view: "table", sort: { key: "due", desc: true }, filter: "x" },
    );
    expect(out).toContain("sort: -due  # newest");
    expect(out).toContain("  # note");
  });
});
