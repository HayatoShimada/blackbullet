import { syscall } from "@silverbulletmd/silverbullet/syscall";
import {
  datastore,
  editor,
  system,
} from "@silverbulletmd/silverbullet/syscalls";
import { useEffect, useRef, useState } from "preact/hooks";
import type { ExpansionResult, RootViewModel } from "../../src/model.ts";
import type { SemanticGraphResult } from "../../src/semantic.ts";
import {
  type GraphEvent,
  type GraphState,
  initialState,
} from "./graph_mediator.ts";
import {
  createGraphRunner,
  type GraphRunner,
  type GraphRunnerDeps,
} from "./graph_runner.ts";

const SETTINGS_KEYS = {
  filters: ["plug", "object-graph", "filters"],
  forces: ["plug", "object-graph", "forces"],
  semantic: ["plug", "object-graph", "semantic"],
};

/** The panel's real dependencies: the datastore, the plug worker, the editor. */
function panelDeps(
  vm: RootViewModel,
  onState: (state: GraphState) => void,
): GraphRunnerDeps {
  // Each top-level open of the panel starts with fresh data; round-trips from
  // the panel reuse what this holds.
  const cache = new Map<string, ExpansionResult>([
    [vm.root.object.ref, vm.root],
  ]);
  const ask = async (ref: string) => {
    const result = (await system.invokeFunction(
      "object-graph.expandObject",
      ref,
    )) as ExpansionResult;
    cache.set(ref, result);
    return result;
  };
  return {
    persist: (key, value) => datastore.set(SETTINGS_KEYS[key], value),
    fetchSemantic: () =>
      system.invokeFunction(
        "object-graph.fetchSemanticGraph",
      ) as Promise<SemanticGraphResult>,
    describe: (display) => syscall("yaml.stringify", display),
    fetchExpansion: async (ref) => cache.get(ref) ?? (await ask(ref)),
    fetchFresh: ask,
    navigate: (target) => editor.navigate(target),
    openUrl: (url) => editor.openUrl(url),
    closePanel: () => editor.hidePanel("modal"),
    onState,
  };
}

/** The panel's state machine, wired to Preact: components read `state` and
 * only ever `emit`. */
export function useGraph(vm: RootViewModel): {
  state: GraphState;
  emit: (event: GraphEvent) => void;
} {
  const [state, setState] = useState<GraphState>(() => initialState(vm));
  const runner = useRef<GraphRunner | null>(null);
  if (!runner.current) {
    runner.current = createGraphRunner(state, panelDeps(vm, setState));
  }
  const emit = runner.current.emit;
  useEffect(() => {
    emit({ type: "boot" });
  }, [emit]);
  return { state, emit };
}

/**
 * The panel's keyboard: Escape closes it, Delete / Backspace removes the
 * selected node (unless a text field has focus). Camera keys (pan, zoom) stay
 * with the canvas: they move what is drawn, not what the graph is.
 */
export function useGraphKeys(emit: (event: GraphEvent) => void) {
  useEffect(() => {
    const handler = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        ev.preventDefault();
        emit({ type: "panel.close" });
        return;
      }
      if (ev.key !== "Backspace" && ev.key !== "Delete") return;
      const tag = (ev.target as HTMLElement | null)?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      ev.preventDefault();
      emit({ type: "selection.remove" });
    };
    globalThis.addEventListener("keydown", handler);
    return () => globalThis.removeEventListener("keydown", handler);
  }, [emit]);
}
