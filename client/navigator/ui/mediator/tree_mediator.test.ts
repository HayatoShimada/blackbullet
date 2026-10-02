import { describe, expect, it } from "vitest";
import {
  initialState,
  transition,
  type TreeEvent,
  type TreeState,
} from "./tree_mediator.ts";

function run(events: TreeEvent[], from: TreeState = initialState) {
  let state = from;
  const effects = [];
  for (const event of events) {
    const next = transition(state, event);
    state = next.state;
    effects.push(...next.effects);
  }
  return { state, effects };
}

describe("drag and drop", () => {
  it("drops into a folder as a single move effect", () => {
    const { state, effects } = run([
      { type: "drag.start", path: "A/B" },
      { type: "drag.over", folder: "C" },
      { type: "drag.drop", folder: "C" },
    ]);
    expect(state).toEqual({ kind: "moving", undoing: false });
    expect(effects).toEqual([{ type: "move", path: "A/B", folder: "C" }]);
  });

  it("tracks the hovered folder while dragging", () => {
    const { state } = run([
      { type: "drag.start", path: "A" },
      { type: "drag.over", folder: "C" },
    ]);
    expect(state).toEqual({ kind: "dragging", path: "A", target: "C" });
  });

  it("keeps the same state object when the target did not change", () => {
    const dragging = run([
      { type: "drag.start", path: "A" },
      { type: "drag.over", folder: "C" },
    ]).state;
    expect(transition(dragging, { type: "drag.over", folder: "C" }).state).toBe(
      dragging,
    );
  });

  it("treats the root area as a valid target", () => {
    const { effects } = run([
      { type: "drag.start", path: "A/B" },
      { type: "drag.drop", folder: "" },
    ]);
    expect(effects).toEqual([{ type: "move", path: "A/B", folder: "" }]);
  });

  it("cancelling a drag leaves nothing behind", () => {
    const { state, effects } = run([
      { type: "drag.start", path: "A" },
      { type: "drag.cancel" },
    ]);
    expect(state).toEqual({ kind: "idle" });
    expect(effects).toEqual([]);
  });

  it("ignores a drop that never started", () => {
    const { state, effects } = run([{ type: "drag.drop", folder: "C" }]);
    expect(state).toEqual({ kind: "idle" });
    expect(effects).toEqual([]);
  });
});

describe("Move to… picker", () => {
  it("opens the picker, then moves the page it was opened for", () => {
    const { state, effects } = run([
      { type: "move.pick", path: "A" },
      { type: "move.request", path: "ignored", folder: "C" },
    ]);
    expect(state).toEqual({ kind: "moving", undoing: false });
    expect(effects).toEqual([
      { type: "openMovePicker", path: "A" },
      { type: "move", path: "A", folder: "C" },
    ]);
  });

  it("cancelling the picker returns to idle", () => {
    const { state } = run([
      { type: "move.pick", path: "A" },
      { type: "move.cancel" },
    ]);
    expect(state).toEqual({ kind: "idle" });
  });
});

describe("one operation at a time", () => {
  const moving = run([
    { type: "drag.start", path: "A" },
    { type: "drag.drop", folder: "C" },
  ]).state;

  it.each<TreeEvent>([
    { type: "drag.start", path: "X" },
    { type: "drag.drop", folder: "D" },
    { type: "move.pick", path: "X" },
    { type: "move.request", path: "X", folder: "D" },
    { type: "move.undo" },
    { type: "pin.request", path: "X", pinned: true },
  ])("drops %o while a move is running", (event) => {
    const next = transition(moving, event);
    expect(next.state).toBe(moving);
    expect(next.effects).toEqual([]);
  });
});

describe("move outcome", () => {
  const moving: TreeState = { kind: "moving", undoing: false };

  it("a finished move offers an undo that reverses it", () => {
    const next = transition(moving, {
      type: "move.done",
      from: "A",
      to: "C/A",
    });
    expect(next.state).toEqual({
      kind: "idle",
      undo: { kind: "move", from: "C/A", to: "A" },
    });
    expect(next.effects).toEqual([
      { type: "offerUndo", action: { kind: "move", from: "C/A", to: "A" } },
    ]);
  });

  it("a collision or a move onto itself ends quietly", () => {
    const next = transition(moving, { type: "move.noop" });
    expect(next.state).toEqual({ kind: "idle" });
    expect(next.effects).toEqual([]);
  });

  it("a failure reports an error and returns to idle", () => {
    const next = transition(moving, { type: "move.failed", message: "boom" });
    expect(next.state).toEqual({ kind: "idle" });
    expect(next.effects).toEqual([
      { type: "notify", message: "Could not move it. boom", level: "error" },
    ]);
  });
});

describe("undo", () => {
  const afterMove = run([
    { type: "drag.start", path: "A" },
    { type: "drag.drop", folder: "C" },
    { type: "move.done", from: "A", to: "C/A" },
  ]).state;

  it("renames back, and offers no second undo", () => {
    const { state, effects } = run(
      [{ type: "move.undo" }, { type: "move.done", from: "C/A", to: "A" }],
      afterMove,
    );
    expect(state).toEqual({ kind: "idle" });
    expect(effects).toEqual([
      { type: "rename", from: "C/A", to: "A" },
      { type: "notify", message: "Move undone.", level: "info" },
    ]);
  });

  it("is a no-op when there is nothing to undo", () => {
    const { state, effects } = run([{ type: "move.undo" }]);
    expect(state).toEqual({ kind: "idle" });
    expect(effects).toEqual([]);
  });

  it("expires", () => {
    expect(transition(afterMove, { type: "undo.expire" }).state).toEqual({
      kind: "idle",
    });
  });

  it("is dropped once the user starts something else", () => {
    const next = transition(afterMove, { type: "drag.start", path: "X" });
    expect(next.state).toEqual({ kind: "dragging", path: "X" });
  });

  it("a failed undo reports the error", () => {
    const { effects } = run(
      [{ type: "move.undo" }, { type: "move.failed", message: "exists" }],
      afterMove,
    );
    expect(effects.at(-1)).toEqual({
      type: "notify",
      message: "Could not move it. exists",
      level: "error",
    });
  });
});

describe("pin", () => {
  it("emits setPinned without leaving idle", () => {
    const { state, effects } = run([
      { type: "pin.request", path: "A", pinned: true },
    ]);
    expect(state).toEqual({ kind: "idle" });
    expect(effects).toEqual([{ type: "setPinned", path: "A", pinned: true }]);
  });
});

describe("reorder", () => {
  const changes = [
    { path: "A", from: 0, to: 2 },
    { path: "B", from: 1, to: 3 },
  ];

  it("a drop between siblings plans a reorder and blocks everything else", () => {
    const { state, effects } = run([
      { type: "drag.start", path: "A" },
      { type: "reorder.drop", path: "A", placement: { before: "C" } },
    ]);
    expect(state).toEqual({ kind: "moving", undoing: false });
    expect(effects).toEqual([
      { type: "reorder", path: "A", placement: { before: "C" } },
    ]);
    expect(
      transition(state, { type: "drag.start", path: "X" }).effects,
    ).toEqual([]);
  });

  it("a finished reorder offers an undo that writes the old priorities back", () => {
    const next = transition(
      { kind: "moving", undoing: false },
      { type: "reorder.done", changes },
    );
    const restore = [
      { path: "A", from: 2, to: 0 },
      { path: "B", from: 3, to: 1 },
    ];
    expect(next.state).toEqual({
      kind: "idle",
      undo: { kind: "reorder", restore },
    });
    expect(next.effects).toEqual([
      { type: "offerUndo", action: { kind: "reorder", restore } },
    ]);
  });

  it("undoing it restores, then says so and offers nothing further", () => {
    const afterReorder = run([
      { type: "reorder.drop", path: "A", placement: { after: "B" } },
      { type: "reorder.done", changes },
    ]).state;
    const { state, effects } = run(
      [{ type: "move.undo" }, { type: "reorder.done", changes: [] }],
      afterReorder,
    );
    expect(state).toEqual({ kind: "idle" });
    expect(effects).toEqual([
      {
        type: "restore",
        changes: [
          { path: "A", from: 2, to: 0 },
          { path: "B", from: 3, to: 1 },
        ],
      },
      { type: "notify", message: "Order restored.", level: "info" },
    ]);
  });

  it("a reorder that changed nothing offers no undo", () => {
    const next = transition(
      { kind: "moving", undoing: false },
      { type: "reorder.done", changes: [] },
    );
    expect(next.state).toEqual({ kind: "idle" });
    expect(next.effects).toEqual([]);
  });

  it("a reorder drop starts from idle too (Move to… style callers)", () => {
    const { effects } = run([
      { type: "reorder.drop", path: "A", placement: { after: "B" } },
    ]);
    expect(effects).toEqual([
      { type: "reorder", path: "A", placement: { after: "B" } },
    ]);
  });
});

describe("menus", () => {
  const anchor = { left: 1, top: 2, right: 3, bottom: 4 };

  it("a ⋯ opens a row's menu, and picking an item runs it and closes the menu", () => {
    const opened = run([
      { type: "menu.open", menu: { kind: "row", target: "A" }, anchor },
    ]);
    const menu = { kind: "row", target: "A", anchor };
    expect(opened.state).toEqual({ kind: "idle", menu });
    expect(opened.effects).toEqual([{ type: "showMenu", menu }]);

    const picked = transition(opened.state, {
      type: "menu.pick",
      item: "action:1",
    });
    expect(picked.state).toEqual({ kind: "idle" });
    expect(picked.effects).toEqual([
      { type: "showMenu" },
      { type: "runMenuItem", menu, item: "action:1" },
    ]);
  });

  it("closing hides the menu and keeps the undo on offer", () => {
    const undo = { kind: "move", from: "C/A", to: "A" } as const;
    const next = transition(
      {
        kind: "idle",
        undo,
        menu: { kind: "new" },
      },
      { type: "menu.close" },
    );
    expect(next.state).toEqual({ kind: "idle", undo });
    expect(next.effects).toEqual([{ type: "showMenu" }]);
  });

  it("closing or picking with no menu open does nothing", () => {
    expect(run([{ type: "menu.close" }]).effects).toEqual([]);
    expect(run([{ type: "menu.pick", item: "x" }]).effects).toEqual([]);
  });

  it("no menu opens while a move is running", () => {
    const moving: TreeState = { kind: "moving", undoing: false };
    const next = transition(moving, {
      type: "menu.open",
      menu: { kind: "new" },
    });
    expect(next.state).toBe(moving);
    expect(next.effects).toEqual([]);
  });

  it("a page is asked for in one place, whatever the tree is doing", () => {
    for (const state of [
      { kind: "idle" },
      { kind: "moving", undoing: false },
      { kind: "dragging", path: "A" },
    ] as TreeState[]) {
      const next = transition(state, { type: "page.new", folder: "Projects" });
      expect(next.state).toBe(state);
      expect(next.effects).toEqual([{ type: "newPage", folder: "Projects" }]);
    }
  });
});
