import { EditorState } from "@codemirror/state";
import { describe, expect, test } from "vitest";
import { buildExtendedMarkdownLanguage } from "../../markdown_parser/parser.ts";
import { blocksOf } from "./blocks.ts";
import { createBlockRunner, type BlockRunnerDeps } from "./block_runner.ts";

function setup(initialDoc: string) {
  let text = initialDoc;
  const log: string[] = [];
  const states: string[] = [];
  const blocks = () => {
    const state = EditorState.create({
      doc: text,
      extensions: [buildExtendedMarkdownLanguage()],
    });
    return blocksOf(state);
  };
  const deps: BlockRunnerDeps = {
    blocks,
    text: () => text,
    // Every line is 20px tall; the gap before line n is at (n - 1) * 20.
    measure: () => ({
      boundaries: Array.from(
        { length: text.split("\n").length + 1 },
        (_, i) => ({ insertAt: i + 1, y: i * 20 }),
      ),
      indentPx: 20,
    }),
    apply(change, cursor) {
      text = text.slice(0, change.from) + change.insert + text.slice(change.to);
      log.push(`apply cursor@${cursor}`);
    },
    toggleFold: (line) => void log.push(`fold ${line}`),
    flash: (m) => void log.push(`flash ${m}`),
    onState: (s) => void states.push(s.kind),
  };
  return { runner: createBlockRunner(deps), log, states, doc: () => text };
}

describe("block runner", () => {
  test("drag a paragraph down and drop it: the document changes by one edit", () => {
    const { runner, log, doc } = setup("alpha\n\nbeta\n\ngamma");
    runner.emit({ type: "drag.start", line: 1, x: 0 });
    // Pointer at the gap before "gamma" (line 5, y = 80).
    runner.emit({ type: "drag.move", x: 0, y: 78 });
    expect(runner.getState()).toMatchObject({
      kind: "dragging",
      target: { insertAt: 5 },
    });
    runner.emit({ type: "drag.drop" });
    expect(doc()).toBe("beta\n\nalpha\n\ngamma");
    expect(log).toEqual(["apply cursor@6"]);
    expect(runner.getState()).toEqual({ kind: "idle" });
  });

  test("a list item dragged right becomes a child of the item above", () => {
    const { runner, doc } = setup("- a\n- b\n- c");
    runner.emit({ type: "drag.start", line: 2, x: 0 });
    // The gap right where "- b" is, with the pointer 20px right of where the
    // drag began: one level deeper.
    runner.emit({ type: "drag.move", x: 20, y: 20 });
    runner.emit({ type: "drag.drop" });
    expect(doc()).toBe("- a\n  - b\n- c");
  });

  test("dropping where it already is touches nothing", () => {
    const { runner, log, doc } = setup("alpha\n\nbeta");
    runner.emit({ type: "drag.start", line: 1, x: 0 });
    runner.emit({ type: "drag.move", x: 0, y: 0 });
    runner.emit({ type: "drag.drop" });
    expect(doc()).toBe("alpha\n\nbeta");
    expect(log).toEqual([]);
  });

  test("a block that has since gone is reported, not moved", () => {
    const { runner, log, doc } = setup("alpha\n\nbeta");
    runner.emit({ type: "drag.start", line: 99, x: 0 });
    runner.emit({ type: "drag.move", x: 0, y: 40 });
    runner.emit({ type: "drag.drop" });
    expect(doc()).toBe("alpha\n\nbeta");
    expect(log).toEqual([]);
  });

  test("a fold toggle goes straight to the editor", () => {
    const { runner, log } = setup("# A\nx");
    runner.emit({ type: "fold.toggle", line: 1 });
    expect(log).toEqual(["fold 1"]);
  });

  test("announces the state only when it changed", () => {
    const { runner, states } = setup("a\n\nb");
    runner.emit({ type: "hover", line: 1 });
    runner.emit({ type: "hover", line: 1 });
    runner.emit({ type: "hover", line: null });
    expect(states).toEqual(["hover", "idle"]);
  });
});

describe("the depth follows the pointer relative to where the drag began", () => {
  test("started far from the text, the item keeps its depth until the pointer moves", () => {
    const { runner, doc } = setup("- a\n  - b\n- c");
    runner.emit({ type: "drag.start", line: 2, x: 500 });
    // Same x as the start: the item stays a child.
    runner.emit({ type: "drag.move", x: 500, y: 20 });
    runner.emit({ type: "drag.drop" });
    expect(doc()).toBe("- a\n  - b\n- c");
  });

  test("moving left by one level lifts it out", () => {
    const { runner, doc } = setup("- a\n  - b\n- c");
    runner.emit({ type: "drag.start", line: 2, x: 500 });
    runner.emit({ type: "drag.move", x: 480, y: 20 });
    runner.emit({ type: "drag.drop" });
    expect(doc()).toBe("- a\n- b\n- c");
  });
});
