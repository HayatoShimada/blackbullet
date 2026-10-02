import { EditorState } from "@codemirror/state";
import { describe, expect, test } from "vitest";
import { buildExtendedMarkdownLanguage } from "../../markdown_parser/parser.ts";
import { blocksOf } from "./blocks.ts";
import {
  allowedDepths,
  minimalChange,
  planBlockMove,
  type MovePlan,
} from "./plan_move.ts";

function setup(doc: string) {
  const state = EditorState.create({
    doc,
    extensions: [buildExtendedMarkdownLanguage()],
  });
  return { lines: doc.split("\n"), blocks: blocksOf(state) };
}

/** Moves the block that starts on `startLine`, and returns the new document. */
function move(
  doc: string,
  startLine: number,
  insertAt: number,
  depth?: number,
): string | MovePlan {
  const { lines, blocks } = setup(doc);
  const moving = blocks.find((b) => b.startLine === startLine)!;
  const plan = planBlockMove({ lines, blocks, moving, insertAt, depth });
  return plan.kind === "move" ? plan.newLines.join("\n") : plan;
}

describe("moving a paragraph or a section", () => {
  const doc = "alpha\n\nbeta\n\ngamma";

  test("down past the next block", () => {
    expect(move(doc, 1, 4)).toBe("beta\n\nalpha\n\ngamma");
  });
  test("to the very end", () => {
    expect(move(doc, 1, 6)).toBe("beta\n\ngamma\n\nalpha");
  });
  test("up to the top", () => {
    expect(move(doc, 5, 1)).toBe("gamma\n\nalpha\n\nbeta");
  });
  test("the middle one to the end and to the top", () => {
    expect(move(doc, 3, 6)).toBe("alpha\n\ngamma\n\nbeta");
    expect(move(doc, 3, 1)).toBe("beta\n\nalpha\n\ngamma");
  });
  test("dropping where it already is changes nothing", () => {
    expect(move(doc, 3, 3)).toEqual({ kind: "none" });
    expect(move(doc, 3, 5)).toEqual({ kind: "none" });
  });
  test("a block of several lines stays together", () => {
    expect(move("a1\na2\n\nb", 1, 5)).toBe("b\n\na1\na2");
  });
  test("never leaves two blank lines in a row, nor none between blocks", () => {
    for (const [from, at] of [
      [1, 4],
      [1, 6],
      [3, 1],
      [5, 1],
      [5, 3],
    ] as const) {
      const out = move(doc, from, at) as string;
      expect(out).not.toMatch(/\n\n\n/);
      expect(out.split("\n\n")).toHaveLength(3);
      expect(out.endsWith("\n")).toBe(false);
    }
  });
  test("into its own range is refused", () => {
    expect(move("# A\nx\ny\n\n# B", 1, 3)).toEqual({
      kind: "refused",
      reason: "inside-itself",
    });
  });
});

describe("moving a section", () => {
  const doc = "# A\nintro\n\n## A1\nsub\n\n# B\nbody";

  test("a heading takes its whole section", () => {
    expect(move(doc, 1, 9)).toBe("# B\nbody\n\n# A\nintro\n\n## A1\nsub");
  });
  test("a sub-section moves by itself", () => {
    expect(move(doc, 4, 9)).toBe("# A\nintro\n\n# B\nbody\n\n## A1\nsub");
  });
  test("the last section to the top", () => {
    expect(move(doc, 7, 1)).toBe("# B\nbody\n\n# A\nintro\n\n## A1\nsub");
  });
});

describe("moving a list item", () => {
  const list = "- a\n  - a1\n  - a2\n- b\n- c";

  test("an item takes its children, and lands after another item", () => {
    expect(move(list, 1, 5)).toBe("- b\n- a\n  - a1\n  - a2\n- c");
  });
  test("a sibling up past another", () => {
    expect(move(list, 5, 4)).toBe("- a\n  - a1\n  - a2\n- c\n- b");
  });
  test("a child out to the top level", () => {
    expect(move(list, 2, 5, 0)).toBe("- a\n  - a2\n- b\n- a1\n- c");
  });
  test("an item into a parent, as a child, with its own children re-indented", () => {
    const out = move("- a\n- b\n  - b1\n- c", 2, 2, 1);
    expect(out).toBe("- a\n  - b\n    - b1\n- c");
  });
  test("an item out by a level, children following", () => {
    expect(move("- a\n  - b\n    - b1\n- c", 2, 2, 0)).toBe(
      "- a\n- b\n  - b1\n- c",
    );
  });
  test("learns the indentation the list already uses", () => {
    expect(move("- a\n    - a1\n- b", 3, 3, 1)).toBe("- a\n    - a1\n    - b");
  });
  test("builds the indentation from the list's own unit when no item is there yet", () => {
    expect(move("- a\n- b", 2, 2, 1)).toBe("- a\n  - b");
  });
  test("dropping in place at the same depth changes nothing", () => {
    expect(move(list, 4, 4)).toEqual({ kind: "none" });
  });
  test("a task keeps its checkbox", () => {
    expect(move("- [ ] a\n- [x] b", 2, 1)).toBe("- [x] b\n- [ ] a");
  });
  test("an item lands among paragraphs as a new list", () => {
    expect(move("- a\n\ntext", 1, 4)).toBe("text\n\n- a");
  });
});

describe("a block that is not a list item", () => {
  test("cannot split a list", () => {
    expect(move("para\n\n- a\n- b\n- c", 1, 5)).toEqual({
      kind: "refused",
      reason: "inside-list",
    });
  });
  test("can sit before or after a list", () => {
    expect(move("para\n\n- a\n- b", 1, 5)).toBe("- a\n- b\n\npara");
    expect(move("- a\n- b\n\npara", 4, 1)).toBe("para\n\n- a\n- b");
  });
});

describe("allowedDepths", () => {
  const list = "- a\n  - a1\n- b\n- c";
  const { blocks } = setup(list);
  const moving = blocks.find((b) => b.startLine === 4)!; // "- c"

  test("no deeper than one under the item above, no shallower than the item below", () => {
    // Before "- b" (line 3): above is a1 (depth 1), below is b (depth 0).
    expect(allowedDepths(blocks, moving, 3)).toEqual({ min: 0, max: 2 });
    // Before "- a1" (line 2): above is a (0), below is a1 (1): only child level.
    expect(allowedDepths(blocks, moving, 2)).toEqual({ min: 1, max: 1 });
  });
  test("at the very top, only the top level", () => {
    expect(allowedDepths(blocks, moving, 1)).toEqual({ min: 0, max: 0 });
  });
  test("the neighbours are the ones the block would have once it had gone", () => {
    // Dropping "- c" back at its own place: above is b, nothing below.
    expect(allowedDepths(blocks, moving, 4)).toEqual({ min: 0, max: 1 });
  });
});

describe("minimalChange", () => {
  const cases: [string, string][] = [
    ["", "abc"],
    ["abc", ""],
    ["abc", "abc"],
    ["a\nb\nc", "a\nc"],
    ["a\nb\nc", "c\na\nb"],
    ["x", "x\ny"],
    ["x\ny", "x"],
    ["aaa", "aa"],
    ["same\n\nsame", "same\nsame\n\nsame"],
  ];
  test.each(cases)("applying the change to %j gives %j", (before, after) => {
    const change = minimalChange(before, after);
    const result = change
      ? before.slice(0, change.from) + change.insert + before.slice(change.to)
      : before;
    expect(result).toBe(after);
  });
  test("identical texts need no change", () => {
    expect(minimalChange("same", "same")).toBeNull();
  });
});

describe("planBlockMove, against every move in a set of documents", () => {
  const docs = [
    "alpha\n\nbeta\n\ngamma",
    "# A\nintro\n\n## A1\nsub\n\n## A2\nmore\n\n# B\nbody",
    "para one\n\n- a\n  - a1\n  - a2\n- b\n\npara two\n\n> quote\n> more\n\n```js\ncode\n```",
    "- x\n- y\n  - y1\n    - y2\n- z",
    "intro\n\n1. one\n2. two\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n---\n\nend",
    "# T\n\n- [ ] task\n- [x] done\n\ntail",
  ];

  const sortedNonBlank = (lines: string[]) =>
    lines
      .filter((l) => l.trim() !== "")
      .map((l) => l.trim())
      .sort();

  test("no line is lost or invented, and the blank lines stay in order", () => {
    let moves = 0;
    for (const doc of docs) {
      const { lines, blocks } = setup(doc);
      const hadDoubleBlank = /\n\n\n/.test(doc);
      for (const moving of blocks) {
        for (let insertAt = 1; insertAt <= lines.length + 1; insertAt++) {
          const depths =
            moving.kind === "list-item"
              ? (() => {
                  const r = allowedDepths(blocks, moving, insertAt);
                  return [r.min, r.max];
                })()
              : [undefined];
          for (const depth of depths) {
            const plan = planBlockMove({
              lines,
              blocks,
              moving,
              insertAt,
              depth,
            });
            if (plan.kind !== "move") continue;
            moves++;
            const out = plan.newLines.join("\n");
            const where = `${JSON.stringify(doc)} move ${moving.startLine}->${insertAt} d${depth}`;
            expect(sortedNonBlank(plan.newLines), where).toEqual(
              sortedNonBlank([...lines]),
            );
            if (!hadDoubleBlank) expect(out, where).not.toMatch(/\n\n\n/);
            expect(out.startsWith("\n"), where).toBe(false);
            expect(out.endsWith("\n"), where).toBe(false);
            // The moved block starts where the plan says it does.
            expect(plan.newLines[plan.movedStartLine - 1].trim(), where).toBe(
              lines[moving.startLine - 1].trim(),
            );
          }
        }
      }
    }
    expect(moves).toBeGreaterThan(300);
  });
});
