import type { TreeEvent } from "./tree_mediator.ts";
import {
  createTreeRunner,
  type TreeRunner,
  type TreeRunnerDeps,
} from "./tree_runner.ts";

/**
 * A panel's tree runner. The runner is stateful (state, undo timer), but the
 * commands that feed it are rebuilt every render and close over that render's
 * tree. So the runner lives for the panel's life and reads its dependencies
 * through `setDeps`, which each render refreshes.
 */
export type TreeHostDeps = Omit<TreeRunnerDeps, "setTimer" | "clearTimer">;

export type TreeHost = {
  runner: TreeRunner;
  setDeps(deps: TreeHostDeps): void;
};

// The runner that last offered an undo. The `Tree: Undo Move` command is
// global, so it cannot know which panel's runner to ask.
let undoSink: TreeRunner | undefined;

// Row actions are declared on the view, away from any panel, so they reach the
// tree through the panel that rendered last.
let activeHost: TreeHost | undefined;

/** Sends an event to the tree Mediator from outside its component tree. */
export function emitToTree(event: TreeEvent): boolean {
  if (!activeHost) return false;
  activeHost.runner.emit(event);
  return true;
}

export function createTreeHost(): TreeHost {
  let latest: TreeHostDeps | undefined;
  const deps = (): TreeHostDeps => {
    if (!latest) throw new Error("tree runner used before its dependencies");
    return latest;
  };
  const runner: TreeRunner = createTreeRunner({
    get separator() {
      return deps().separator;
    },
    plan: (path, folder) => deps().plan(path, folder),
    planReorder: (path, placement) => deps().planReorder(path, placement),
    setPriority: (path, priority) => deps().setPriority(path, priority),
    move: (obj, newName) => deps().move(obj, newName),
    flash: (message, level) => deps().flash(message, level),
    openMovePicker: (path) => deps().openMovePicker?.(path),
    setPinned: (path, pinned) => {
      const fn = deps().setPinned;
      if (!fn) throw new Error("pinning is not available here");
      return fn(path, pinned);
    },
    offerUndo: (move) => {
      undoSink = runner;
      deps().offerUndo(move);
    },
    afterMove: (folder) => deps().afterMove(folder),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (handle) => clearTimeout(handle as number),
  });
  const host: TreeHost = {
    runner,
    setDeps(next) {
      latest = next;
      activeHost = host;
    },
  };
  return host;
}

/** Undoes the last move offered by any panel. False when there is none. */
export function undoLastTreeMove(): boolean {
  const state = undoSink?.getState();
  if (!undoSink || state?.kind !== "idle" || !state.undo) return false;
  undoSink.emit({ type: "move.undo" });
  return true;
}
