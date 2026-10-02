import { describe, expect, test } from "vitest";
import {
  type BlockEvent,
  type BlockState,
  initialState,
  transition,
} from "./block_mediator.ts";

function run(events: BlockEvent[], from: BlockState = initialState) {
  let state = from;
  const effects = [];
  for (const event of events) {
    const next = transition(state, event);
    state = next.state;
    effects.push(...next.effects);
  }
  return { state, effects };
}

const target = { insertAt: 5, depth: 1, y: 80 };

describe("hover", () => {
  test("shows the handle of the row under the pointer", () => {
    expect(run([{ type: "hover", line: 3 }]).state).toEqual({
      kind: "hover",
      line: 3,
    });
  });
  test("leaving every row hides it", () => {
    expect(
      run([
        { type: "hover", line: 3 },
        { type: "hover", line: null },
      ]).state,
    ).toEqual({ kind: "idle" });
  });
  test("the same row again is the same state, not a new one", () => {
    const hovered = run([{ type: "hover", line: 3 }]).state;
    expect(transition(hovered, { type: "hover", line: 3 }).state).toBe(hovered);
  });
  test("a drag is not interrupted by the pointer passing over rows", () => {
    const dragging = run([{ type: "drag.start", line: 1, x: 0 }]).state;
    expect(transition(dragging, { type: "hover", line: 9 }).state).toBe(
      dragging,
    );
    expect(transition(dragging, { type: "hover", line: null }).state).toBe(
      dragging,
    );
  });
});

describe("dragging", () => {
  test("moving the pointer asks for a target, and the answer is kept", () => {
    const { state, effects } = run([
      { type: "drag.start", line: 2, x: 30 },
      { type: "drag.move", x: 10, y: 70 },
      { type: "drag.target", target },
    ]);
    expect(effects).toEqual([{ type: "pick", x: 10, y: 70, originX: 30 }]);
    expect(state).toEqual({ kind: "dragging", line: 2, originX: 30, target });
  });

  test("dropping on a target moves the block there", () => {
    const { state, effects } = run([
      { type: "drag.start", line: 2, x: 30 },
      { type: "drag.target", target },
      { type: "drag.drop" },
    ]);
    expect(state).toEqual({ kind: "idle" });
    expect(effects).toEqual([{ type: "move", line: 2, insertAt: 5, depth: 1 }]);
  });

  test("dropping with nowhere to land does nothing", () => {
    const { state, effects } = run([
      { type: "drag.start", line: 2, x: 30 },
      { type: "drag.target", target: null },
      { type: "drag.drop" },
    ]);
    expect(state).toEqual({ kind: "idle" });
    expect(effects).toEqual([]);
  });

  test("cancelling leaves nothing behind", () => {
    expect(
      run([
        { type: "drag.start", line: 2, x: 30 },
        { type: "drag.target", target },
        { type: "drag.cancel" },
      ]),
    ).toEqual({ state: { kind: "idle" }, effects: [] });
  });

  test("a drop that never started is ignored", () => {
    expect(run([{ type: "drag.drop" }])).toEqual({
      state: { kind: "idle" },
      effects: [],
    });
    expect(run([{ type: "drag.move", x: 1, y: 1 }]).effects).toEqual([]);
    expect(run([{ type: "drag.target", target }]).state).toEqual({
      kind: "idle",
    });
  });

  test("an edit under the drag abandons it", () => {
    const { state, effects } = run([
      { type: "drag.start", line: 2, x: 30 },
      { type: "drag.target", target },
      { type: "doc.changed" },
    ]);
    expect(state).toEqual({ kind: "idle" });
    expect(effects).toEqual([]);
  });

  test("an edit also drops a stale hover", () => {
    expect(
      run([{ type: "hover", line: 4 }, { type: "doc.changed" }]).state,
    ).toEqual({ kind: "idle" });
  });
});

describe("folding", () => {
  test("a toggle is an effect, from any state, and changes no state", () => {
    const hovered = run([{ type: "hover", line: 4 }]).state;
    const next = transition(hovered, { type: "fold.toggle", line: 4 });
    expect(next.state).toBe(hovered);
    expect(next.effects).toEqual([{ type: "toggleFold", line: 4 }]);
  });
});
