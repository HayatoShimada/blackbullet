import { syscall } from "@silverbulletmd/silverbullet/syscall";
import { useEffect, useRef, useState } from "preact/hooks";
import type { ViewModel } from "../../src/functions.ts";
import { type DbEvent, type DbState, initialState } from "./db_mediator.ts";
import {
  createDbRunner,
  type DbRunner,
  type DbRunnerDeps,
} from "./db_runner.ts";

const call = (fn: string, ...args: unknown[]) =>
  syscall("system.invokeFunction", `db-view.${fn}`, ...args);

/** The widget's real dependencies: the plug's functions, by syscall. */
function widgetDeps(onState: (s: DbState) => void): DbRunnerDeps {
  return {
    updatePageValue: (page, key, kind, input, modified) =>
      call("updatePageValue", page, key, kind, input, modified),
    updateTask: (page, pos, state, edit, modified) =>
      call("updateTask", page, pos, state, edit, modified),
    query: (spec) => call("query", spec),
    indexedModified: (page) => call("indexedModified", page),
    navigate: (target) => syscall("editor.navigate", target),
    onState,
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
  if (!runner.current) {
    runner.current = createDbRunner(state, widgetDeps(setState));
  }
  const emit = runner.current.emit;
  // A sandbox is rebuilt when its page re-renders; nothing to start here.
  useEffect(() => undefined, []);
  return { state, emit };
}
