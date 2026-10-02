/**
 * The block editor's Mediator: what a pointer over a block, a drag, a drop or
 * a fold toggle means. The handles and toggles are passive views: they are
 * drawn from this state and only ever `emit` what the user did. Nothing here
 * touches the editor; `transition` returns the next state and the effects the
 * runner should perform.
 */
import type { DropTarget } from "./drop_target.ts";

export type BlockState =
  | { kind: "idle" }
  /** The pointer is over a block's row: its handle is shown. */
  | { kind: "hover"; line: number }
  /** `originX` is where the pointer was when the drag began: a list item's
   * depth follows how far right or left of it the pointer has gone. `target`
   * is where the block would land right now; null if nowhere. */
  | {
      kind: "dragging";
      line: number;
      originX: number;
      target: DropTarget | null;
    };

export type BlockEvent =
  | { type: "hover"; line: number | null }
  | { type: "drag.start"; line: number; x: number }
  | { type: "drag.move"; x: number; y: number }
  /** The runner's answer to a `pick`. */
  | { type: "drag.target"; target: DropTarget | null }
  | { type: "drag.drop" }
  | { type: "drag.cancel" }
  | { type: "fold.toggle"; line: number }
  /** The document changed under us: nothing measured before is still true. */
  | { type: "doc.changed" };

export type BlockEffect =
  /** Measure the document and pick the drop target for a pointer position. */
  | { type: "pick"; x: number; y: number; originX: number }
  | { type: "move"; line: number; insertAt: number; depth: number }
  | { type: "toggleFold"; line: number };

export type Transition = { state: BlockState; effects: BlockEffect[] };

export const initialState: BlockState = { kind: "idle" };

const stay = (state: BlockState): Transition => ({ state, effects: [] });

export function transition(state: BlockState, event: BlockEvent): Transition {
  switch (event.type) {
    case "hover":
      // A drag in progress is not interrupted by the pointer passing over rows.
      if (state.kind === "dragging") return stay(state);
      if (event.line === null) {
        return stay(state.kind === "idle" ? state : { kind: "idle" });
      }
      return stay(
        state.kind === "hover" && state.line === event.line
          ? state
          : { kind: "hover", line: event.line },
      );

    case "drag.start":
      return stay({
        kind: "dragging",
        line: event.line,
        originX: event.x,
        target: null,
      });

    case "drag.move":
      if (state.kind !== "dragging") return stay(state);
      return {
        state,
        effects: [
          { type: "pick", x: event.x, y: event.y, originX: state.originX },
        ],
      };

    case "drag.target":
      if (state.kind !== "dragging") return stay(state);
      return stay({ ...state, target: event.target });

    case "drag.drop":
      if (state.kind !== "dragging") return stay(state);
      if (!state.target) return stay({ kind: "idle" });
      return {
        state: { kind: "idle" },
        effects: [
          {
            type: "move",
            line: state.line,
            insertAt: state.target.insertAt,
            depth: state.target.depth,
          },
        ],
      };

    case "drag.cancel":
      return stay(state.kind === "dragging" ? { kind: "idle" } : state);

    case "fold.toggle":
      return {
        state,
        effects: [{ type: "toggleFold", line: event.line }],
      };

    case "doc.changed":
      // A drag in progress is abandoned: its lines may no longer be its lines.
      return stay(state.kind === "idle" ? state : { kind: "idle" });
  }
}
