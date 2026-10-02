import { compareCollated } from "@silverbulletmd/silverbullet/lib/collation";
import type { QueryCollationConfig } from "@silverbulletmd/silverbullet/type/config";
import {
  config,
  datastore,
  editor,
} from "@silverbulletmd/silverbullet/syscalls";
import {
  allFolderPaths,
  planMove,
  withExpanded,
} from "../../../plug-api/ui/tree_model.ts";
import type { NavigatorEngine } from "./engine.ts";
import { createTreeHost } from "./mediator/tree_host.ts";
import { moveTargets } from "./mediator/move_targets.ts";
import { setPagePriority } from "../views/pin.ts";
import { planReorder, type Placement } from "./mediator/reorder.ts";
import { siblingsOf, topPriority } from "./mediator/siblings.ts";
import { expansionKey } from "./expansion.ts";
import type { DerivedView } from "./hooks/use_derived.ts";
import type { ActiveView, PanelSetters, SharedRefs } from "./panel.ts";

/**
 * What tree mode does to the tree itself: the expansion set (persisted per
 * view, so a dock comes back the way it was left) and drag-and-drop moves.
 * Split from the rest of the commands because these are the only ones that
 * write structure rather than act on a selection.
 */
export function createTreeCommands({
  view,
  engine,
  derived,
  refs,
  set,
  refresh,
}: {
  view?: ActiveView;
  engine: NavigatorEngine;
  derived: DerivedView;
  refs: SharedRefs;
  set: PanelSetters;
  refresh: () => void;
}) {
  const { expandedDirty, input: inputRef } = refs;
  const { setExpanded } = set;
  const { treeFiltering, treeDisplay } = derived;

  const expandAll = view?.meta.expandAll === true;

  function persistExpanded(next: Set<string>) {
    if (!view) return;
    // A page-scoped tree has nowhere to persist to: its paths are the current
    // page's, so a stored set would arrive on top of a different page's rows.
    const key = expansionKey(view.name, view.meta);
    if (key) void datastore.set(key, [...next]);
  }

  function toggleExpanded(path: string) {
    // Tree rows are drag sources, so they are exempt from the panel-wide
    // mousedown suppression (see NavRoot); a chevron click blurs the input,
    // and this hands it back. A no-op for the keyboard path.
    inputRef.current?.focus();
    // Filtering force-expands every pruned folder; a manual toggle in that
    // state would just be overridden on the next render, so skip it (and the
    // datastore write) rather than have it silently do nothing visible.
    if (treeFiltering) return;
    expandedDirty.current = true;
    setExpanded((prev) => {
      // Membership means "open" under one reading and "closed" under the
      // other, so flipping it is the same gesture either way.
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      persistExpanded(next);
      return next;
    });
  }

  function expandPath(path: string) {
    expandedDirty.current = true;
    setExpanded((prev) => {
      const next = withExpanded(prev, [path], expandAll);
      // `withExpanded` only ever adds or only ever removes, so an unchanged
      // size means it was already open.
      if (next.size === prev.size) return prev;
      persistExpanded(next);
      return next;
    });
  }

  function setAllFoldersExpanded(open: boolean) {
    if (!view || !treeDisplay || treeFiltering) return;
    inputRef.current?.focus();
    const paths = allFolderPaths(treeDisplay.tree);
    expandedDirty.current = true;
    setExpanded((prev) => {
      const next = new Set(prev);
      for (const path of paths) {
        if (open === expandAll) next.delete(path);
        else next.add(path);
      }
      persistExpanded(next);
      return next;
    });
  }

  // Every render hands the runner this render's view of the tree; the runner
  // itself (state, undo timer) outlives the render.
  const host = (refs.treeHost.current ??= createTreeHost());
  const separator = view?.meta.hierarchy.separator ?? "/";
  host.setDeps({
    separator,
    plan: (path, folder) =>
      treeDisplay
        ? planMove(treeDisplay.tree, path, folder, separator)
        : { kind: "none" },
    move: async (obj, newName) => {
      if (!view) throw new Error("no view");
      await engine.move(view.name, obj, newName);
    },
    flash: (message, level) => editor.flashNotification(message, level),
    planReorder: async (path, placement) => {
      const siblings = treeDisplay
        ? siblingsOf(treeDisplay.tree, path, separator)
        : undefined;
      if (!siblings) return { ok: false, reason: "unknown-target" };
      // The order names fall back to is the one the tree's own source sorts by.
      const collation = await config.get<QueryCollationConfig>(
        "queryCollation",
        {},
      );
      const collator = Intl.Collator(collation?.locale, collation?.options);
      return planReorder(siblings, path, placement, (a, b) =>
        compareCollated(a, b, collation, collator),
      );
    },
    setPriority: setPagePriority,
    setPinned: async (path, pinned) => {
      const siblings = treeDisplay
        ? siblingsOf(treeDisplay.tree, path, separator)
        : undefined;
      await setPagePriority(
        path,
        pinned && siblings ? topPriority(siblings, path) : 0,
      );
      refresh();
    },
    openMovePicker: (path) => {
      void (async () => {
        let choice: Awaited<ReturnType<typeof editor.filterBox>>;
        try {
          choice = await editor.filterBox(
            `Move ${path} to`,
            moveTargets(treeDisplay?.tree, path, separator),
            "Pick the folder to move it into.",
            "Folder",
          );
        } catch {
          // A picker that failed is a picker that was dismissed: leaving the
          // machine in `picking` would ignore every move after it.
          choice = undefined;
        }
        host.runner.emit(
          choice
            ? { type: "move.request", path, folder: choice.folder as string }
            : { type: "move.cancel" },
        );
      })();
    },
    offerUndo: (action) => {
      const what =
        action.kind === "move" ? `Moved to ${action.from}` : "Order changed";
      void editor.flashNotification(
        `${what}. Undo with the "Tree: Undo Move" command.`,
      );
    },
    afterMove: (folder) => {
      // Otherwise a drop on a collapsed folder just makes the row vanish.
      if (folder) expandPath(folder);
      // The rename's file events refresh us anyway; this only makes it prompt.
      refresh();
    },
  });

  /** A completed drag: `targetFolder` is `""` for a drop on the root area. */
  function moveNode(draggedPath: string, targetFolder: string) {
    // The drag's own mousedown blurred the input (same exemption as above).
    inputRef.current?.focus();
    // HTML5 drag-and-drop only reports the drop, so the machine sees the
    // start and the drop together.
    host.runner.emit({ type: "drag.start", path: draggedPath });
    host.runner.emit({ type: "drag.drop", folder: targetFolder });
  }

  /** A drop between siblings: `placement` is relative to a row in the same folder. */
  function reorderNode(draggedPath: string, placement: Placement) {
    inputRef.current?.focus();
    host.runner.emit({ type: "drag.start", path: draggedPath });
    host.runner.emit({
      type: "reorder.drop",
      path: draggedPath,
      placement,
    });
  }

  return {
    toggleExpanded,
    expandPath,
    expandAllFolders: () => setAllFoldersExpanded(true),
    collapseAllFolders: () => setAllFoldersExpanded(false),
    moveNode,
    reorderNode,
  };
}
