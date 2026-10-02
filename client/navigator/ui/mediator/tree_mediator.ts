/**
 * The space tree's Mediator: a state machine that decides what every event
 * bubbling up from the tree's components means. Components are passive views
 * (they render props and `emit` events); nothing below the Mediator calls
 * `editor`, `system` or `datastore`.
 *
 * `transition` is pure: it returns the next state and the effects to run. The
 * runner executes the effects and feeds their outcome back in as events, so
 * the whole machine is testable without a DOM or a space.
 */

import type { Placement, PriorityChange } from "./reorder.ts";

/** What a finished move or reorder needs to be put back the way it was. */
export type UndoMove = { from: string; to: string };
export type UndoAction =
  | ({ kind: "move" } & UndoMove)
  | { kind: "reorder"; restore: PriorityChange[] };

export type TreeState =
  | { kind: "idle"; undo?: UndoAction }
  | { kind: "dragging"; path: string; target?: string }
  | { kind: "picking"; path: string }
  | { kind: "moving"; undoing: boolean };

export type TreeEvent =
  | { type: "drag.start"; path: string }
  /** `folder` is `""` for the root area, `undefined` when over nothing. */
  | { type: "drag.over"; folder?: string }
  | { type: "drag.drop"; folder: string }
  | { type: "drag.cancel" }
  /** A drop between siblings: the page keeps its folder and takes a place. */
  | { type: "reorder.drop"; path: string; placement: Placement }
  | { type: "reorder.done"; changes: PriorityChange[] }
  | { type: "move.pick"; path: string }
  | { type: "move.request"; path: string; folder: string }
  | { type: "move.cancel" }
  /** The runner's answers once a `move` / `rename` effect has settled. */
  | { type: "move.done"; from: string; to: string }
  | { type: "move.noop" }
  | { type: "move.failed"; message: string }
  | { type: "move.undo" }
  | { type: "undo.expire" }
  | { type: "pin.request"; path: string; pinned: boolean };

export type TreeEffect =
  /** Plan against the live tree (collision, own-subtree), then rename. */
  | { type: "move"; path: string; folder: string }
  /** Plan the priorities for a new place among siblings, then write them. */
  | { type: "reorder"; path: string; placement: Placement }
  /** The undo of a reorder: write the old priorities back. */
  | { type: "restore"; changes: PriorityChange[] }
  /** A plain rename to an already-known name: the undo of a finished move. */
  | { type: "rename"; from: string; to: string }
  | { type: "openMovePicker"; path: string }
  | { type: "setPinned"; path: string; pinned: boolean }
  | { type: "offerUndo"; action: UndoAction }
  | { type: "notify"; message: string; level: "info" | "error" };

export type Transition = { state: TreeState; effects: TreeEffect[] };

export const initialState: TreeState = { kind: "idle" };

const stay = (state: TreeState): Transition => ({ state, effects: [] });

/** An undo offer outlives nothing but the next thing the user starts. */
function idle(): TreeState {
  return { kind: "idle" };
}

export function transition(state: TreeState, event: TreeEvent): Transition {
  switch (state.kind) {
    case "idle":
      return fromIdle(state, event);
    case "dragging":
      return fromDragging(state, event);
    case "picking":
      return fromPicking(state, event);
    case "moving":
      // One operation at a time: a second drop or a double-clicked Undo must
      // not start a second rename while the first is still rewriting links.
      if (event.type === "move.done") {
        if (state.undoing) {
          return {
            state: idle(),
            effects: [
              { type: "notify", message: "Move undone", level: "info" },
            ],
          };
        }
        const action: UndoAction = {
          kind: "move",
          from: event.to,
          to: event.from,
        };
        return {
          state: { kind: "idle", undo: action },
          effects: [{ type: "offerUndo", action }],
        };
      }
      if (event.type === "reorder.done") {
        if (state.undoing) {
          return {
            state: idle(),
            effects: [
              { type: "notify", message: "Order restored", level: "info" },
            ],
          };
        }
        if (event.changes.length === 0) return { state: idle(), effects: [] };
        const action: UndoAction = {
          kind: "reorder",
          restore: event.changes.map((c) => ({
            path: c.path,
            from: c.to,
            to: c.from,
          })),
        };
        return {
          state: { kind: "idle", undo: action },
          effects: [{ type: "offerUndo", action }],
        };
      }
      if (event.type === "move.noop") return { state: idle(), effects: [] };
      if (event.type === "move.failed") {
        return {
          state: idle(),
          effects: [
            {
              type: "notify",
              message: `Move failed: ${event.message}`,
              level: "error",
            },
          ],
        };
      }
      return stay(state);
  }
}

function fromIdle(
  state: Extract<TreeState, { kind: "idle" }>,
  event: TreeEvent,
): Transition {
  switch (event.type) {
    case "drag.start":
      return stay({ kind: "dragging", path: event.path });
    case "move.pick":
      return {
        state: { kind: "picking", path: event.path },
        effects: [{ type: "openMovePicker", path: event.path }],
      };
    case "move.request":
      return startMove(event.path, event.folder);
    case "reorder.drop":
      return startReorder(event.path, event.placement);
    case "move.undo":
      if (!state.undo) return stay(state);
      return {
        state: { kind: "moving", undoing: true },
        effects: [
          state.undo.kind === "move"
            ? { type: "rename", from: state.undo.from, to: state.undo.to }
            : { type: "restore", changes: state.undo.restore },
        ],
      };
    case "undo.expire":
      return stay(idle());
    case "pin.request":
      return {
        state,
        effects: [
          { type: "setPinned", path: event.path, pinned: event.pinned },
        ],
      };
    default:
      return stay(state);
  }
}

function fromDragging(
  state: Extract<TreeState, { kind: "dragging" }>,
  event: TreeEvent,
): Transition {
  switch (event.type) {
    case "drag.over":
      return stay(
        event.folder === state.target
          ? state
          : { kind: "dragging", path: state.path, target: event.folder },
      );
    case "drag.drop":
      return startMove(state.path, event.folder);
    case "reorder.drop":
      return startReorder(state.path, event.placement);
    case "drag.cancel":
      return stay(idle());
    default:
      return stay(state);
  }
}

function fromPicking(
  state: Extract<TreeState, { kind: "picking" }>,
  event: TreeEvent,
): Transition {
  switch (event.type) {
    case "move.request":
      // The picker answers for the page it was opened for, whatever else the
      // event claims.
      return startMove(state.path, event.folder);
    case "move.cancel":
      return stay(idle());
    default:
      return stay(state);
  }
}

function startMove(path: string, folder: string): Transition {
  return {
    state: { kind: "moving", undoing: false },
    effects: [{ type: "move", path, folder }],
  };
}

function startReorder(path: string, placement: Placement): Transition {
  return {
    state: { kind: "moving", undoing: false },
    effects: [{ type: "reorder", path, placement }],
  };
}
