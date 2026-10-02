import type { ExpansionResult } from "../../src/model.ts";
import {
  expandLocalRings,
  type SemanticGraphResult,
} from "../../src/semantic.ts";
import {
  type GraphEffect,
  type GraphEvent,
  type GraphState,
  transition,
} from "./graph_mediator.ts";

/** Most nodes "expand all" may reach before it stops following relations. */
export const EXPAND_ALL_CAP = 5000;

/** Everything the runner touches outside the pure machine. Injected so the
 * runner is testable, and so no component ever reaches these itself. */
export type GraphRunnerDeps = {
  persist(
    key: "filters" | "forces" | "semantic",
    value: unknown,
  ): Promise<void>;
  fetchSemantic(): Promise<SemanticGraphResult>;
  /** An object as the text the sidebar shows (YAML). */
  describe(display: Record<string, unknown>): Promise<string>;
  /** A node's relations, from the cache when it holds them. */
  fetchExpansion(ref: string): Promise<ExpansionResult>;
  /** Always asks the worker, and keeps the answer: the cache may hold a wide
   * expansion for this ref (in the global view it IS the whole graph). */
  fetchFresh(ref: string): Promise<ExpansionResult>;
  navigate(target: string): Promise<void>;
  openUrl(url: string): Promise<void>;
  closePanel(): Promise<void>;
  /** Told after every transition that changed the state. */
  onState(state: GraphState): void;
};

export type GraphRunner = {
  /** The one door into the machine: components emit, nothing else. */
  emit(event: GraphEvent): void;
  getState(): GraphState;
};

/**
 * Follows every relation outward, round by round, until no new node remains
 * along a label that is not hidden. A hidden label's edge is still recorded (so
 * switching it on later reveals it) but it does not seed further exploration.
 * Stops at `cap` nodes. Each round's answers go to `apply` as they arrive.
 */
export async function expandTransitively(
  expandedRefs: string[],
  pendingRefs: string[],
  hiddenLabels: string[],
  fetchExpansion: (ref: string) => Promise<ExpansionResult>,
  apply: (results: ExpansionResult[]) => void,
  cap = EXPAND_ALL_CAP,
): Promise<void> {
  const hidden = new Set(hiddenLabels);
  const expanded = new Set(expandedRefs);
  const pending = new Set(pendingRefs);
  while (pending.size > 0) {
    if (expanded.size + pending.size > cap) break;
    const refs = [...pending];
    pending.clear();
    const results = await Promise.all(refs.map(fetchExpansion));
    apply(results);
    for (const r of results) {
      expanded.add(r.object.ref);
      for (const e of r.edges) {
        if (hidden.has(e.label)) continue;
        for (const ref of [e.source, e.target]) {
          if (!expanded.has(ref) && !pending.has(ref)) pending.add(ref);
        }
      }
    }
  }
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function createGraphRunner(
  initial: GraphState,
  deps: GraphRunnerDeps,
): GraphRunner {
  let state = initial;
  // The ring load in flight, so a new radius can abandon it.
  let rings: { cancelled: boolean } | undefined;

  function emit(event: GraphEvent): void {
    const next = transition(state, event);
    const changed = next.state !== state;
    state = next.state;
    for (const effect of next.effects) void run(effect);
    if (changed) deps.onState(state);
  }

  async function guarded(what: string, work: () => Promise<void>) {
    try {
      await work();
    } catch (e) {
      console.error(`object-graph: ${what} failed`, e);
    }
  }

  async function run(effect: GraphEffect): Promise<void> {
    switch (effect.type) {
      case "persist":
        return guarded("saving settings", () =>
          deps.persist(effect.key, effect.value),
        );
      case "fetchSemantic":
        try {
          emit({ type: "semantic.loaded", result: await deps.fetchSemantic() });
        } catch (e) {
          emit({
            type: "semantic.loaded",
            result: {
              status: "error",
              message: `similar pages failed (${errorMessage(e)})`,
              edges: [],
            },
          });
        }
        return;
      case "describe":
        return guarded("describing an object", async () => {
          emit({
            type: "object.described",
            ref: effect.ref,
            text: await deps.describe(effect.display),
          });
        });
      case "expand":
        return guarded("expanding a node", async () => {
          emit({
            type: "expansion.loaded",
            results: [await deps.fetchExpansion(effect.ref)],
          });
        });
      case "loadSimilar":
        return guarded("loading similar pages", async () => {
          // One page that cannot be read must not cost the others.
          const settled = await Promise.allSettled(
            effect.refs.map(deps.fetchExpansion),
          );
          const results = settled.flatMap((r) =>
            r.status === "fulfilled" ? [r.value] : [],
          );
          // Always answered, even with nothing: the canvas waits for it.
          emit({ type: "similar.loaded", results });
        });
      case "expandRings": {
        if (rings) rings.cancelled = true;
        const mine = { cancelled: false };
        rings = mine;
        return guarded("loading rings", () =>
          expandLocalRings(
            effect.rootRef,
            effect.neighborRefs,
            effect.hops,
            deps.fetchExpansion,
            (results) => emit({ type: "expansion.loaded", results }),
            () => mine.cancelled,
          ),
        );
      }
      case "cancelRings":
        if (rings) rings.cancelled = true;
        rings = undefined;
        return;
      case "expandAll":
        return guarded("expanding all", () =>
          expandTransitively(
            effect.expanded,
            effect.pending,
            effect.hiddenLabels,
            deps.fetchExpansion,
            (results) => emit({ type: "expansion.loaded", results }),
          ),
        );
      case "focus":
        return guarded("focusing", async () => {
          emit({
            type: "focus.loaded",
            result: await deps.fetchFresh(effect.anchor),
          });
        });
      case "navigate":
        return guarded("navigation", async () => {
          await deps.navigate(effect.target);
          if (effect.close) await deps.closePanel();
        });
      case "openUrl":
        return guarded("opening a URL", () => deps.openUrl(effect.url));
      case "closePanel":
        return guarded("closing", () => deps.closePanel());
    }
  }

  return { emit, getState: () => state };
}
