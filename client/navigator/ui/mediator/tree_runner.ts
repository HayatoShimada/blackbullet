import type { MovePlan } from "../../../../plug-api/ui/tree_model.ts";
import type { Placement, PriorityChange, ReorderPlan } from "./reorder.ts";
import {
  initialState,
  type OpenMenu,
  transition,
  type TreeEffect,
  type TreeEvent,
  type TreeState,
  type UndoAction,
} from "./tree_mediator.ts";

/** How long a finished move can still be undone. */
export const UNDO_WINDOW_MS = 8000;

/** Everything the runner touches outside the pure machine. Injected so the
 * runner is testable, and so the components never reach these themselves. */
export type TreeRunnerDeps = {
  /** The view's hierarchy separator (`/` for the space tree). */
  separator: string;
  /** Plans a move against the tree as it is rendered right now. */
  plan(path: string, folder: string): MovePlan;
  /** The rename itself: rewrites links, so it can take a while. */
  move(obj: Record<string, any>, newName: string): Promise<void>;
  flash(message: string, level: "info" | "error"): void | Promise<void>;
  /** Absent where the host has no picker yet (Move to… is not offered). */
  openMovePicker?(path: string): void;
  setPinned?(path: string, pinned: boolean): Promise<void>;
  /** Draws a menu, or hides it. Absent where the host has none. */
  showMenu?(menu: OpenMenu | undefined): void | Promise<void>;
  /** Does what the menu item `item` stands for. */
  runMenuItem?(menu: OpenMenu, item: string): void | Promise<void>;
  /** Asks for a page name in `folder` and opens the new page. */
  newPage?(folder: string): void | Promise<void>;
  /** Plans the priorities that put a page at `placement` among its siblings. */
  planReorder(path: string, placement: Placement): Promise<ReorderPlan>;
  /** Writes one page's `tree.priority` (0 clears it). */
  setPriority(path: string, priority: number): Promise<void>;
  /** Surfaces the undo to the user (a notification pointing at the command). */
  offerUndo(action: UndoAction): void;
  /** After a move landed in `folder` (`""` = root): reveal it and refresh. */
  afterMove(folder: string): void;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
};

export type TreeRunner = {
  /** The one door into the machine: components emit, nothing else. */
  emit(event: TreeEvent): void;
  getState(): TreeState;
};

const REORDER_REFUSED: Record<
  Extract<ReorderPlan, { ok: false }>["reason"],
  string
> = {
  "not-movable": "This has no page of its own, so it can't be ordered.",
  "no-room":
    "There is no room to put it there. A folder without a page is in the way.",
  "unknown-target": "Can't put it there.",
};

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function createTreeRunner(deps: TreeRunnerDeps): TreeRunner {
  let state: TreeState = initialState;
  let undoTimer: unknown;
  // What each moved page looked like (folder? document?), by its new name, so
  // that undoing the move renames the same kind of thing back.
  const moved = new Map<string, Record<string, any>>();

  function emit(event: TreeEvent): void {
    const next = transition(state, event);
    state = next.state;
    for (const effect of next.effects) {
      // An effect that throws (a config read, a notification) must not leave
      // the machine in `moving`, where every later move would be ignored.
      void run(effect).catch((e) =>
        emit({ type: "move.failed", message: errorMessage(e) }),
      );
    }
  }

  async function renameVia(
    obj: Record<string, any>,
    from: string,
    to: string,
    folderOf: string,
  ): Promise<void> {
    try {
      await deps.move(obj, to);
    } catch (e) {
      emit({ type: "move.failed", message: errorMessage(e) });
      return;
    }
    moved.delete(from);
    moved.set(to, { ...obj, name: to });
    emit({ type: "move.done", from, to });
    deps.afterMove(folderOf);
  }

  /** All of the priorities, or none: a failure part-way puts back the ones
   * already written, so a reorder never leaves the level half-changed. */
  async function writePriorities(
    changes: PriorityChange[],
    path?: string,
  ): Promise<void> {
    const written: PriorityChange[] = [];
    try {
      for (const change of changes) {
        await deps.setPriority(change.path, change.to);
        written.push(change);
      }
    } catch (e) {
      for (const change of written.reverse()) {
        try {
          await deps.setPriority(change.path, change.from);
        } catch {
          // Best effort: the original error is the one worth reporting.
        }
      }
      emit({ type: "move.failed", message: errorMessage(e) });
      return;
    }
    emit({ type: "reorder.done", changes });
    deps.afterMove(parentOf(path ?? changes[0].path, deps.separator));
  }

  async function run(effect: TreeEffect): Promise<void> {
    switch (effect.type) {
      case "move": {
        const plan = deps.plan(effect.path, effect.folder);
        if (plan.kind === "none") {
          emit({ type: "move.noop" });
        } else if (plan.kind === "collision") {
          await deps.flash(
            `${plan.newName} already exists. Rename one of them first.`,
            "error",
          );
          emit({ type: "move.noop" });
        } else {
          await renameVia(plan.obj, effect.path, plan.newName, effect.folder);
        }
        return;
      }
      case "rename": {
        const base = moved.get(effect.from) ?? { name: effect.from };
        await renameVia(
          { ...base, name: effect.from },
          effect.from,
          effect.to,
          parentOf(effect.to, deps.separator),
        );
        return;
      }
      case "reorder": {
        const plan = await deps.planReorder(effect.path, effect.placement);
        if (!plan.ok) {
          await deps.flash(REORDER_REFUSED[plan.reason], "error");
          emit({ type: "move.noop" });
        } else if (plan.changes.length === 0) {
          emit({ type: "move.noop" });
        } else {
          await writePriorities(plan.changes, effect.path);
        }
        return;
      }
      case "restore":
        await writePriorities(effect.changes);
        return;
      case "openMovePicker":
        if (deps.openMovePicker) deps.openMovePicker(effect.path);
        else await deps.flash("Move to… is not available here.", "error");
        return;
      case "setPinned":
        try {
          if (!deps.setPinned) throw new Error("pinning is not available here");
          await deps.setPinned(effect.path, effect.pinned);
        } catch (e) {
          await deps.flash(`Could not pin it. ${errorMessage(e)}`, "error");
        }
        return;
      case "showMenu":
        await deps.showMenu?.(effect.menu);
        return;
      case "runMenuItem":
        try {
          await deps.runMenuItem?.(effect.menu, effect.item);
        } catch (e) {
          await deps.flash(errorMessage(e), "error");
        }
        return;
      case "newPage":
        try {
          await deps.newPage?.(effect.folder);
        } catch (e) {
          await deps.flash(errorMessage(e), "error");
        }
        return;
      case "offerUndo":
        if (undoTimer !== undefined) deps.clearTimer(undoTimer);
        deps.offerUndo(effect.action);
        undoTimer = deps.setTimer(() => {
          undoTimer = undefined;
          emit({ type: "undo.expire" });
        }, UNDO_WINDOW_MS);
        return;
      case "notify":
        await deps.flash(effect.message, effect.level);
        return;
    }
  }

  return { emit, getState: () => state };
}

/** The folder a page name lives in (`""` for the root), the inverse of how
 * `planMove` builds a name. */
function parentOf(name: string, separator: string): string {
  const idx = name.lastIndexOf(separator);
  return idx === -1 ? "" : name.slice(0, idx);
}
