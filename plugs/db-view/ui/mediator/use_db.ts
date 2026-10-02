import { syscall } from "@silverbulletmd/silverbullet/syscall";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import type { ViewModel } from "../../src/functions.ts";
import {
  type DbEvent,
  type DbState,
  initialState,
  type PendingUndo,
} from "./db_mediator.ts";
import { blockBodyOffset } from "./block_locate.ts";
import {
  createDbRunner,
  type DbRunner,
  type DbRunnerDeps,
  restoreEvent,
} from "./db_runner.ts";

const call = (fn: string, ...args: unknown[]) =>
  syscall("system.invokeFunction", `db-view.${fn}`, ...args);

/** Where this view keeps its Undo while the frame is rebuilt: the frame shares
 * the page's origin, so its session storage outlives it. Keyed by the block
 * (or, without one, the spec) so a page's views do not share one. */
function undoKey(model: ViewModel): string {
  const text = model.block
    ? `${model.block.page}\n${model.block.body}`
    : JSON.stringify(model.spec);
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) | 0;
  return `bb-db-undo:${(h >>> 0).toString(36)}`;
}

function undoStore(key: string) {
  return {
    remember(pending: PendingUndo | null): void {
      try {
        if (pending) sessionStorage.setItem(key, JSON.stringify(pending));
        else sessionStorage.removeItem(key);
      } catch {
        // No storage here: the Undo then lives only as long as the frame.
      }
    },
    recall(): PendingUndo | null {
      try {
        const text = sessionStorage.getItem(key);
        return text ? (JSON.parse(text) as PendingUndo) : null;
      } catch {
        return null;
      }
    },
  };
}

/** The widget's real dependencies: the plug's functions, by syscall. */
function widgetDeps(
  onState: (s: DbState) => void,
  remember: (pending: PendingUndo | null) => void,
): DbRunnerDeps {
  return {
    updatePageValue: (page, key, kind, input, modified, database) =>
      call("updatePageValue", page, key, kind, input, modified, database),
    updateTask: (page, pos, state, edit, modified) =>
      call("updateTask", page, pos, state, edit, modified),
    query: (spec) => call("query", spec),
    createRow: (spec, title, values) => call("createRow", spec, title, values),
    deleteRow: (spec, page, modified) =>
      call("deleteRow", spec, page, modified),
    archiveRow: (spec, page, archived, modified) =>
      call("archiveRow", spec, page, archived, modified),
    duplicateRow: (spec, page, modified) =>
      call("duplicateRow", spec, page, modified),
    renameRow: (spec, page, title, modified) =>
      call("renameRow", spec, page, title, modified),
    saveView: (page, body, saved) => call("saveView", page, body, saved),
    indexedModified: (page) => call("indexedModified", page),
    navigate: (target) => syscall("editor.navigate", target),
    editSource: async (_page, body) => {
      const at = blockBodyOffset(await syscall("editor.getText"), body);
      if (at < 0) return false;
      await syscall("editor.moveCursor", at, true);
      return true;
    },
    confirm: (message, options) =>
      syscall("editor.confirm", message, options ?? {}),
    onState,
    remember,
  };
}

/** The view's state machine, wired to Preact: components read `state` and only
 * ever `emit`. */
export function useDb(model: ViewModel): {
  state: DbState;
  emit: (event: DbEvent) => void;
} {
  const [state, setState] = useState<DbState>(() => initialState(model));
  const runner = useRef<DbRunner | null>(null);
  const store = useRef<ReturnType<typeof undoStore> | null>(null);
  if (!store.current) store.current = undoStore(undoKey(model));
  if (!runner.current) {
    runner.current = createDbRunner(
      state,
      widgetDeps(setState, store.current.remember),
    );
  }
  const emit = runner.current.emit;
  // The editor rebuilds the page (and this frame) when its index finishes
  // loading: a tick made just before must still show "Done · Undo".
  useLayoutEffect(() => {
    const again = restoreEvent(store.current!.recall(), Date.now());
    if (again) runner.current!.emit(again);
  }, []);
  return { state, emit };
}
