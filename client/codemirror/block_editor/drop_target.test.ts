import { EditorState } from "@codemirror/state";
import { describe, expect, test } from "vitest";
import { buildExtendedMarkdownLanguage } from "../../markdown_parser/parser.ts";
import { blocksOf } from "./blocks.ts";
import { type Boundary, pickDropTarget } from "./drop_target.ts";

function setup(doc: string) {
  const state = EditorState.create({
    doc,
    extensions: [buildExtendedMarkdownLanguage()],
  });
  const blocks = blocksOf(state);
  const lineCount = doc.split("\n").length;
  // Every line is 20px tall; the boundary before line n sits at (n - 1) * 20.
  const boundaries: Boundary[] = [];
  for (let n = 1; n <= lineCount + 1; n++) {
    boundaries.push({ insertAt: n, y: (n - 1) * 20 });
  }
  return { blocks, boundaries };
}

const pick = (
  doc: string,
  startLine: number,
  at: { x?: number; y: number },
) => {
  const { blocks, boundaries } = setup(doc);
  const moving = blocks.find((b) => b.startLine === startLine)!;
  return pickDropTarget({
    x: at.x ?? 0,
    y: at.y,
    boundaries,
    blocks,
    moving,
    baseLeft: 0,
    indentPx: 20,
  });
};

describe("pickDropTarget", () => {
  const doc = "alpha\n\nbeta\n\ngamma";

  test("the nearest gap wins", () => {
    // Boundary before line 5 sits at y = 80.
    expect(pick(doc, 1, { y: 76 })).toMatchObject({ insertAt: 5, y: 80 });
    expect(pick(doc, 1, { y: 5 })).toMatchObject({ insertAt: 1 });
  });

  test("a gap inside the block being dragged is never picked", () => {
    const section = "# A\nx\ny\n\n# B";
    expect(pick(section, 1, { y: 45 })).toMatchObject({ insertAt: 4 });
  });

  test("a gap in the middle of a list is not offered to a paragraph", () => {
    const mixed = "para\n\n- a\n- b\n- c";
    // Pointer on the gap between "- a" and "- b" (before line 4, y = 60).
    const target = pick(mixed, 1, { y: 60 });
    expect(target).not.toBeNull();
    expect(target!.insertAt).not.toBe(4);
    expect(target!.insertAt).not.toBe(5);
  });

  test("with nothing allowed, no target", () => {
    expect(pick("only", 1, { y: 0 })).toMatchObject({ insertAt: 1 });
  });
});

describe("a list item's depth follows the pointer, within what is allowed", () => {
  const list = "- a\n  - a1\n- b\n- c";

  test("further right is deeper, up to one below the item above", () => {
    // Dropping "- c" before line 3 ("- b"): above is a1 (depth 1), so 0..2.
    expect(pick(list, 4, { y: 40, x: 0 })).toMatchObject({
      insertAt: 3,
      depth: 0,
    });
    expect(pick(list, 4, { y: 40, x: 20 })).toMatchObject({ depth: 1 });
    expect(pick(list, 4, { y: 40, x: 40 })).toMatchObject({ depth: 2 });
    expect(pick(list, 4, { y: 40, x: 400 })).toMatchObject({ depth: 2 });
  });

  test("never shallower than the item below", () => {
    // Before "- a1" (line 2, y = 20): the item below is at depth 1.
    expect(pick(list, 4, { y: 20, x: 0 })).toMatchObject({
      insertAt: 2,
      depth: 1,
    });
  });

  test("left of the list is the top level", () => {
    expect(pick(list, 4, { y: 40, x: -100 })).toMatchObject({ depth: 0 });
  });

  test("a heading or a paragraph is always at depth 0, wherever x is", () => {
    expect(pick("para\n\n- a", 1, { y: 60, x: 200 })).toMatchObject({
      depth: 0,
    });
  });
});
