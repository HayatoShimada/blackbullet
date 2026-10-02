import { compareCollated } from "@silverbulletmd/silverbullet/lib/collation";
import type { QueryCollationConfig } from "@silverbulletmd/silverbullet/type/config";
import {
  config,
  datastore,
  editor,
} from "@silverbulletmd/silverbullet/syscalls";
import {
  allFolderPaths,
  findNode,
  nodeObject,
  planMove,
  withExpanded,
} from "../../../plug-api/ui/tree_model.ts";
import type { NavigatorEngine } from "./engine.ts";
import { createTreeHost, publishSelectedFolder } from "./mediator/tree_host.ts";
import type { MenuItem } from "./components/popover_menu.tsx";
import type { Anchor, OpenMenu } from "./mediator/tree_mediator.ts";
import { createPageIn } from "../views/new_page.ts";
import { flashWithAction } from "../trash.ts";
import { UNDO_WINDOW_MS } from "./mediator/tree_runner.ts";
import { folderOf } from "../views/create_target.ts";
import { newMenuEntries, runNewEntry } from "../views/new_menu.ts";
import { moveTargets } from "./mediator/move_targets.ts";
import { setPagePriority } from "../views/pin.ts";
import { planReorder, type Placement } from "./mediator/reorder.ts";
import { siblingsOf, topPriority } from "./mediator/siblings.ts";
import { expansionKey } from "./expansion.ts";
import type { DerivedView } from "./hooks/use_derived.ts";
import type {
  ActiveView,
  MenuView,
  PanelSetters,
  SharedRefs,
} from "./panel.ts";

/**
 * What tree mode does to the tree itself: the expansion set (persisted per
 * view, so a dock comes back the way it was left) and drag-and-drop moves.
 * Split from the rest of the commands because these are the only ones that
 * write structure rather than act on a selection.
 */
export function createTreeCommands({
  slot,
  view,
  engine,
  derived,
  refs,
  set,
  refresh,
  readOnly = false,
  selectedPath,
  runAction,
  afterNew,
}: {
  slot?: string;
  view?: ActiveView;
  engine: NavigatorEngine;
  derived: DerivedView;
  refs: SharedRefs;
  set: PanelSetters;
  refresh: () => void;
  readOnly?: boolean;
  /** The tree's own selection (not the default one an unselected tree shows). */
  selectedPath?: string;
  /** Runs the view's action `index` on `obj` -- the menu's way to act. */
  runAction?: (index: number, obj: Record<string, any>) => Promise<void>;
  /** After something was made from the New menu (a phone drawer steps aside). */
  afterNew?: () => void | Promise<void>;
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
    showMenu: async (menu) => {
      if (!menu) {
        set.setMenu?.(undefined);
        return;
      }
      set.setMenu?.(await menuViewFor(menu));
    },
    runMenuItem: async (menu, item) => {
      // Whatever the item does, the panel's input takes the keyboard back.
      try {
        if (menu.kind === "new") {
          await runNewEntry(item, await hereFolder(), (folder) =>
            host.runner.emit({ type: "page.new", folder }),
          );
          await afterNew?.();
        } else if (item.startsWith("action:")) {
          const { obj } = rowMenuItems(menu.target);
          if (obj && runAction) await runAction(Number(item.slice(7)), obj);
        }
      } finally {
        inputRef.current?.focus();
      }
    },
    newPage: (folder) => createPageIn(folder),
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
      // "<Verb> · Undo": a real button for as long as the undo window lasts.
      flashWithAction(
        action.kind === "move" ? `Moved to ${action.from}` : "Order changed",
        {
          name: "Undo",
          run: () => host.runner.emit({ type: "move.undo" }),
        },
        UNDO_WINDOW_MS,
      );
    },
    afterMove: (folder) => {
      // Otherwise a drop on a collapsed folder just makes the row vanish.
      if (folder) expandPath(folder);
      // The rename's file events refresh us anyway; this only makes it prompt.
      refresh();
    },
  });

  /**
   * The folder "here" means: the selected row if it is a folder, else the
   * folder that row is in. Undefined while nothing is selected, so a caller
   * can fall back to the page being edited.
   */
  function selectedFolder(): string | undefined {
    // Only a row the user picked, and one this tree (this segment) still has:
    // the row the editor's page revealed says nothing about where to create.
    if (!selectedPath || !treeDisplay) return undefined;
    if (selectedPath === refs.revealedPath?.current) return undefined;
    const node = findNode(treeDisplay.tree, selectedPath);
    if (!node) return undefined;
    return node.isFolder ? node.path : folderOf(node.path);
  }
  if (slot) {
    publishSelectedFolder(
      slot,
      view?.name === "std.spaceTree" ? selectedFolder : undefined,
    );
  }

  async function hereFolder(): Promise<string> {
    const selected = selectedFolder();
    if (selected !== undefined) return selected;
    try {
      return folderOf(await editor.getCurrentPage());
    } catch {
      return "";
    }
  }

  /** What a row's `⋯` lists: the view's actions that apply to it, the way out last. */
  function rowMenuItems(target: string): {
    items: MenuItem[];
    indexes: number[];
    obj?: Record<string, any>;
  } {
    const actions = view?.meta.actions ?? [];
    let obj: Record<string, any> | undefined;
    let state: { actions?: boolean[] } | undefined;
    if (target.startsWith("#")) {
      const entry = derived.listItems[Number(target.slice(1))];
      obj = entry?.row.obj;
      state = entry ? view?.rowState?.byRow?.get(entry.row) : undefined;
    } else {
      const node = treeDisplay ? findNode(treeDisplay.tree, target) : undefined;
      obj = node ? nodeObject(node) : undefined;
      state = view?.rowState?.byPath?.get(target);
    }
    const visible = actions
      .map((action, index) => ({ action, index }))
      .filter(({ action, index }) => {
        if (readOnly && action.requireMode === "rw") return false;
        return !action.hasWhen || state?.actions?.[index] === true;
      })
      // Stable: the danger action goes last whatever order it was declared in.
      .sort((a, b) => Number(!!a.action.danger) - Number(!!b.action.danger));
    return {
      obj,
      indexes: visible.map(({ index }) => index),
      items: visible.map(({ action, index }) => ({
        id: `action:${index}`,
        label: action.label,
        icon: view?.actionIcons?.[index],
        danger: action.danger === true,
      })),
    };
  }

  async function menuViewFor(menu: OpenMenu): Promise<MenuView | undefined> {
    if (menu.kind === "new") {
      const entries = await newMenuEntries(await hereFolder());
      return {
        menu,
        label: "New",
        items: entries.map((entry) => ({
          id: entry.id,
          label: entry.label,
          description: entry.description,
        })),
      };
    }
    const { items } = rowMenuItems(menu.target);
    return items.length === 0 ? undefined : { menu, label: "Actions", items };
  }

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

  /** A `⋯` was pressed: the menu of that row (a second press closes it). */
  function openRowMenu(target: string, anchor?: Anchor) {
    const open = host.runner.getState();
    if (open.kind === "idle" && open.menu?.kind === "row") {
      const same = open.menu.target === target;
      host.runner.emit({ type: "menu.close" });
      if (same) return;
    }
    host.runner.emit({
      type: "menu.open",
      menu: { kind: "row", target },
      anchor,
    });
  }

  /** The tree's `+`, or the New command when a tree is showing. */
  function openNewMenu(anchor?: Anchor) {
    const open = host.runner.getState();
    if (open.kind === "idle" && open.menu?.kind === "new") {
      host.runner.emit({ type: "menu.close" });
      return;
    }
    host.runner.emit({ type: "menu.open", menu: { kind: "new" }, anchor });
  }

  /** "Page here" with nothing to anchor it to: the tree's selected folder. */
  async function newPageHere() {
    host.runner.emit({ type: "page.new", folder: await hereFolder() });
  }

  function closeMenu() {
    host.runner.emit({ type: "menu.close" });
    inputRef.current?.focus();
  }

  function pickMenuItem(item: string) {
    host.runner.emit({ type: "menu.pick", item });
  }

  return {
    selectedFolder,
    openRowMenu,
    openNewMenu,
    newPageHere,
    closeMenu,
    pickMenuItem,
    toggleExpanded,
    expandPath,
    expandAllFolders: () => setAllFoldersExpanded(true),
    collapseAllFolders: () => setAllFoldersExpanded(false),
    moveNode,
    reorderNode,
  };
}
