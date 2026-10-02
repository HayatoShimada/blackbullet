import { EditorState } from "@codemirror/state";
import { describe, expect, test } from "vitest";
import { buildExtendedMarkdownLanguage } from "../../markdown_parser/parser.ts";
import { blockStartingAt, blocksOf } from "./blocks.ts";

function blocks(doc: string) {
  const state = EditorState.create({
    doc,
    extensions: [buildExtendedMarkdownLanguage()],
  });
  return blocksOf(state);
}

/** `kind@start-end` (+ level or depth), so a whole document reads as a line. */
function shape(doc: string): string[] {
  return blocks(doc).map((b) => {
    const tag = b.level
      ? `h${b.level}`
      : b.kind === "list-item"
        ? `li${b.depth}`
        : b.kind;
    return `${tag}@${b.startLine}-${b.endLine}`;
  });
}

describe("blocksOf", () => {
  test("paragraphs, each on its own", () => {
    expect(shape("one\ntwo\n\nthree")).toEqual([
      "paragraph@1-2",
      "paragraph@4-4",
    ]);
  });

  test("a heading is its whole section, and what is inside is a block too", () => {
    expect(shape("# A\ntext\n\n## B\nmore\n\n# C\nlast")).toEqual([
      "h1@1-5",
      "paragraph@2-2",
      "h2@4-5",
      "paragraph@5-5",
      "h1@7-8",
      "paragraph@8-8",
    ]);
  });

  test("a section ends at the next heading of the same or a higher level only", () => {
    expect(shape("## B\nx\n### C\ny\n## D\nz")).toEqual([
      "h2@1-4",
      "paragraph@2-2",
      "h3@3-4",
      "paragraph@4-4",
      "h2@5-6",
      "paragraph@6-6",
    ]);
  });

  test("a section does not swallow the blank lines that follow it", () => {
    const [heading] = blocks("# A\ntext\n\n\n# B");
    expect(heading.endLine).toBe(2);
  });

  test("a heading with no content is one line", () => {
    expect(shape("# A\n# B")).toEqual(["h1@1-1", "h1@2-2"]);
  });

  test("a list item carries its nested children, which are blocks of their own", () => {
    expect(shape("- one\n  - a\n  - b\n    - deep\n- two")).toEqual([
      "li0@1-4",
      "li1@2-2",
      "li1@3-4",
      "li2@4-4",
      "li0@5-5",
    ]);
  });

  test("a task is a list item", () => {
    expect(shape("- [ ] todo\n- [x] done")).toEqual(["li0@1-1", "li0@2-2"]);
  });

  test("ordered lists too", () => {
    expect(shape("1. a\n2. b")).toEqual(["li0@1-1", "li0@2-2"]);
  });

  test("quotes, code, tables and rules are one block each", () => {
    const doc =
      "> q\n> r\n\n```js\ncode\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n---\n";
    expect(shape(doc)).toEqual([
      "quote@1-2",
      "code@4-6",
      "table@8-10",
      "rule@12-12",
    ]);
  });

  test("the front matter is not a block", () => {
    expect(shape("---\na: 1\n---\n# A\ntext")).toEqual([
      "h1@4-5",
      "paragraph@5-5",
    ]);
  });

  test("a setext heading is a section too", () => {
    expect(shape("Title\n=====\ntext")).toEqual(["h1@1-3", "paragraph@3-3"]);
  });

  test("ranges are whole lines", () => {
    const doc = "intro\n\n- a\n  - b\ntail";
    const state = EditorState.create({
      doc,
      extensions: [buildExtendedMarkdownLanguage()],
    });
    for (const b of blocksOf(state)) {
      expect(b.from).toBe(state.doc.line(b.startLine).from);
      expect(b.to).toBe(state.doc.line(b.endLine).to);
    }
  });

  test("an empty document has no blocks", () => {
    expect(blocks("")).toEqual([]);
    expect(blocks("\n\n")).toEqual([]);
  });

  test("blockStartingAt finds the block that begins on a line", () => {
    const list = blocks("# A\n- x\n  - y");
    expect(blockStartingAt(list, 2)?.kind).toBe("list-item");
    expect(blockStartingAt(list, 3)?.depth).toBe(1);
    expect(blockStartingAt(list, 99)).toBeUndefined();
  });
});
