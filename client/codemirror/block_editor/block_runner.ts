import type { Block } from "./blocks.ts";
import {
  type BlockEffect,
  type BlockEvent,
  type BlockState,
  initialState,
  transition,
} from "./block_mediator.ts";
import {
  type Boundary,
  type DropTarget,
  pickDropTarget,
} from "./drop_target.ts";
import { type MoveRefusal, minimalChange, planBlockMove } from "./plan_move.ts";

/** What the view measured: where each gap is on screen, and how far a list
 * level is indented. */
export type Measurement = {
  boundaries: readonly Boundary[];
  indentPx: number;
};

export type BlockRunnerDeps = {
  /** The blocks as they are now (cheap: asked for on every pointer move). */
  blocks(): readonly Block[];
  /** The document's text (dear: asked for once, when a block is dropped). */
  text(): string;
  /** Measures the gaps near `pointerY`, plus the ones around `moving`. */
  measure(pointerY: number, moving: Block): Measurement;
  /** One change to the document, and where the cursor goes after it. */
  apply(
    change: { from: number; to: number; insert: string },
    cursor: number,
  ): void;
  toggleFold(line: number): void;
  flash(message: string): void;
  /** Told after every transition that changed the state. */
  onState(state: BlockState): void;
};

export type BlockRunner = {
  /** The one door into the machine: the view emits, nothing else. */
  emit(event: BlockEvent): void;
  getState(): BlockState;
};

const REFUSED: Record<MoveRefusal, string> = {
  "inside-itself": "A block can't be moved into itself",
  "inside-list": "A block can't be put in the middle of a list",
};

export function createBlockRunner(deps: BlockRunnerDeps): BlockRunner {
  let state: BlockState = initialState;

  function emit(event: BlockEvent): void {
    const next = transition(state, event);
    const changed = next.state !== state;
    state = next.state;
    for (const effect of next.effects) run(effect);
    if (changed) deps.onState(state);
  }

  function pick(x: number, y: number, originX: number): DropTarget | null {
    if (state.kind !== "dragging") return null;
    const line = state.line;
    const blocks = deps.blocks();
    const moving = blocks.find((b) => b.startLine === line);
    if (!moving) return null;
    const { boundaries, indentPx } = deps.measure(y, moving);
    // The depth follows the pointer relative to where the drag began: with the
    // pointer where it started, a list item keeps its own depth.
    const baseLeft = originX - moving.depth * indentPx;
    return pickDropTarget({
      x,
      y,
      boundaries,
      blocks,
      moving,
      baseLeft,
      indentPx,
    });
  }

  function move(line: number, insertAt: number, depth: number): void {
    const blocks = deps.blocks();
    const text = deps.text();
    const moving = blocks.find((b) => b.startLine === line);
    if (!moving) {
      deps.flash("That block has changed; nothing was moved");
      return;
    }
    const lines = text.split("\n");
    const plan = planBlockMove({ lines, blocks, moving, insertAt, depth });
    if (plan.kind === "none") return;
    if (plan.kind === "refused") {
      deps.flash(REFUSED[plan.reason]);
      return;
    }
    const after = plan.newLines.join("\n");
    const change = minimalChange(text, after);
    if (!change) return;
    let cursor = 0;
    for (let i = 0; i < plan.movedStartLine - 1; i++) {
      cursor += plan.newLines[i].length + 1;
    }
    deps.apply(change, cursor);
  }

  function run(effect: BlockEffect): void {
    switch (effect.type) {
      case "pick":
        emit({
          type: "drag.target",
          target: pick(effect.x, effect.y, effect.originX),
        });
        return;
      case "move":
        move(effect.line, effect.insertAt, effect.depth);
        return;
      case "toggleFold":
        deps.toggleFold(effect.line);
        return;
    }
  }

  return { emit, getState: () => state };
}
