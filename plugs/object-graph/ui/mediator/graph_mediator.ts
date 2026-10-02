/**
 * The graph panel's Mediator: one state machine that decides what every event
 * from the panel's components means. Components are passive views (they draw
 * what they are given and `emit` what the user did); none of them touches a
 * syscall.
 *
 * `transition` is pure: it returns the next state and the effects to run. The
 * runner performs the effects (datastore, sidecar, navigation) and feeds what
 * came back in as events, so the whole thing -- including the races between
 * those answers -- is testable without a DOM or a space.
 */
import type {
  Edge,
  ExpansionResult,
  Filters,
  ForceSettings,
  GraphUniverse,
  ObjectKind,
  RootViewModel,
  SemanticSettings,
} from "../../src/model.ts";
import { SEMANTIC_K_MAX, SEMANTIC_THRESHOLD_MIN } from "../../src/model.ts";
import {
  buildSemanticEdges,
  type SemanticGraphResult,
} from "../../src/semantic.ts";
import { computeVisible, type NodeState } from "../components/visibility.ts";

export type GraphState = {
  nodes: ReadonlyMap<string, NodeState>;
  /** Explicit relations only; semantic edges are derived (see `selectView`). */
  edges: readonly Edge[];
  selectedRef: string | null;
  /** Every tag, label, status and area the space has, for the filter lists. */
  universe: GraphUniverse;
  filters: Filters;
  forces: ForceSettings;
  semantic: SemanticSettings;
  /** null while the (lazy, possibly slow) sidecar request is in flight. */
  semanticResult: SemanticGraphResult | null;
  /** The selected object as text, for the sidebar. Null until it has been
   * produced, and dropped when the selection moves on. */
  objectText: { ref: string; text: string } | null;
  /** The page the graph was opened on: always visible, and the anchor of hops. */
  rootRef: string;
  /** The root's own neighbours as it was opened: where ring loading starts. */
  rootNeighborRefs: string[];
  /** The global view already holds every node; there are no rings to load. */
  allExpanded: boolean;
  /** Transient views must not overwrite the local view's saved filters. */
  persistFilters: boolean;
  /** Phone layout: the filters sheet is pulled up (collapsed otherwise). */
  sheetOpen: boolean;
  /** Similar pages are on their way in: the canvas must not call itself empty. */
  similarPending: boolean;
};

export type GraphEvent =
  /** The panel is up: start whatever it needs from outside. */
  | { type: "boot" }
  | { type: "semantic.loaded"; result: SemanticGraphResult }
  /** The answer to a `describe`: dropped if the selection has moved on. */
  | { type: "object.described"; ref: string; text: string }
  | { type: "node.click"; ref: string }
  /** Selection only (the node list's arrow keys): no expanding, no opening. */
  | { type: "node.select"; ref: string }
  /** A double click: go to the node (or open its URL). */
  | { type: "node.open"; ref: string; kind: ObjectKind }
  /** A double click on an edge: go to where the relation was written. */
  | { type: "edge.open"; page: string; pos?: number }
  /** The sidebar's link to the selected object. */
  | { type: "object.open"; ref: string }
  | { type: "node.remove"; ref: string }
  /** Delete / Backspace: removes whatever is selected. */
  | { type: "selection.remove" }
  | { type: "expansion.loaded"; results: ExpansionResult[] }
  /** The current page's similar pages, which are not links and so not yet nodes. */
  | { type: "similar.loaded"; results: ExpansionResult[] }
  | { type: "expandAll.request" }
  | { type: "focus.request" }
  | { type: "focus.loaded"; result: ExpansionResult }
  /** A view says what it changed, not what the whole setting now is. */
  | { type: "filters.patch"; patch: Partial<Filters> }
  | { type: "forces.patch"; patch: Partial<ForceSettings> }
  | { type: "semantic.patch"; patch: Partial<SemanticSettings> }
  /** The phone's filters sheet was pulled up or put away. */
  | { type: "sheet.set"; open: boolean }
  | { type: "panel.close" };

export type GraphEffect =
  | { type: "persist"; key: "filters" | "forces" | "semantic"; value: unknown }
  | { type: "fetchSemantic" }
  /** Render an object as text, answered by `object.described`. */
  | { type: "describe"; ref: string; display: Record<string, unknown> }
  /** Load one node's relations, answered by `expansion.loaded`. */
  | { type: "expand"; ref: string }
  /** Fetch pages that are only similar to the root, answered by `similar.loaded`. */
  | { type: "loadSimilar"; refs: string[] }
  /** Load the rings a hop radius needs, answered by `expansion.loaded`. */
  | {
      type: "expandRings";
      rootRef: string;
      neighborRefs: string[];
      hops: number;
    }
  /** Abandon an `expandRings` still in flight. */
  | { type: "cancelRings" }
  /** Follow every enabled relation outward until no ghost is left. */
  | {
      type: "expandAll";
      expanded: string[];
      pending: string[];
      hiddenLabels: string[];
    }
  /** Fetch `anchor` afresh (never from the cache), answered by `focus.loaded`. */
  | { type: "focus"; anchor: string }
  | { type: "navigate"; target: string; close: boolean }
  | { type: "openUrl"; url: string }
  | { type: "closePanel" };

export type Transition = { state: GraphState; effects: GraphEffect[] };

export function initialState(vm: RootViewModel): GraphState {
  const nodes = new Map<string, NodeState>();
  const initialStatus: NodeState["status"] = vm.initialAllExpanded
    ? "expanded"
    : "ghost";
  nodes.set(vm.root.object.ref, { node: vm.root.object, status: "expanded" });
  for (const n of vm.root.neighbors) {
    if (!nodes.has(n.ref)) nodes.set(n.ref, { node: n, status: initialStatus });
  }
  return {
    nodes,
    edges: dedupe([], vm.root.edges),
    selectedRef: vm.root.object.ref,
    objectText: null,
    universe: vm.universe,
    filters: vm.filters,
    forces: vm.forces,
    semantic: vm.semantic,
    semanticResult: null,
    rootRef: vm.root.object.ref,
    rootNeighborRefs: vm.root.neighbors.map((n) => n.ref),
    allExpanded: vm.initialAllExpanded === true,
    persistFilters: vm.persistFilters !== false,
    sheetOpen: false,
    similarPending: false,
  };
}

export function edgeKey(e: Edge): string {
  return `${e.source} ${e.target} ${e.label} ${e.kind}`;
}

/** `prev` plus whichever of `incoming` it does not already hold. */
function dedupe(prev: readonly Edge[], incoming: readonly Edge[]): Edge[] {
  const keys = new Set(prev.map(edgeKey));
  const out = [...prev];
  for (const e of incoming) {
    const key = edgeKey(e);
    if (!keys.has(key)) {
      keys.add(key);
      out.push(e);
    }
  }
  return out.length === prev.length ? (prev as Edge[]) : out;
}

function applyExpansions(
  state: GraphState,
  results: ExpansionResult[],
): GraphState {
  if (results.length === 0) return state;
  const nodes = new Map(state.nodes);
  for (const r of results) {
    nodes.set(r.object.ref, { node: r.object, status: "expanded" });
    for (const n of r.neighbors) {
      if (!nodes.has(n.ref)) nodes.set(n.ref, { node: n, status: "ghost" });
    }
  }
  return {
    ...state,
    nodes,
    edges: dedupe(
      state.edges,
      results.flatMap((r) => r.edges),
    ),
  };
}

function removeNode(state: GraphState, ref: string): GraphState {
  if (!state.nodes.has(ref)) return state;
  const nodes = new Map(state.nodes);
  nodes.delete(ref);
  const edges = state.edges.filter((e) => e.source !== ref && e.target !== ref);
  return {
    ...state,
    nodes,
    edges: edges.length === state.edges.length ? state.edges : edges,
    selectedRef: state.selectedRef === ref ? null : state.selectedRef,
  };
}

/**
 * Where a node lives. An item or block whose ref carries no `@pos` holds a bare
 * `$anchor` name, so it is navigated through the anchor and the index resolves
 * it to wherever it is now; pages, files and positional refs go directly.
 */
export function navigationTarget(kind: ObjectKind, ref: string): string {
  const isAnchorRef =
    (kind === "item" || kind === "block") && !ref.includes("@");
  return isAnchorRef ? `$${ref}` : ref;
}

/** Whether rings beyond the root's own neighbourhood need loading. */
function needsRings(state: GraphState): boolean {
  return state.semantic.hops >= 2 && !state.allExpanded;
}

function ringsEffect(state: GraphState): GraphEffect {
  return {
    type: "expandRings",
    rootRef: state.rootRef,
    neighborRefs: state.rootNeighborRefs,
    hops: state.semantic.hops,
  };
}

/** What the sidebar shows of an object: its tag first, then everything indexed.
 * A stub node (a dangling ref, a URL, a file) carries no `tag` of its own, so
 * the node's structural tag or kind stands in. */
export function describeObject(node: {
  rootTag: string | null;
  kind: string;
  attributes: Record<string, unknown>;
}): Record<string, unknown> {
  return { tag: node.rootTag ?? node.kind, ...node.attributes };
}

/**
 * Pages the sidecar finds similar to the root that are not nodes yet. A page
 * with no links would otherwise open on a lone node while its similar pages
 * sit unseen, so they join the graph as ghosts (a click expands them like any
 * other). The same threshold and `k` that draw the edges choose them.
 */
export function similarCandidates(state: GraphState): string[] {
  const result = state.semanticResult;
  if (!state.semantic.show || result?.status !== "ok") return [];
  const threshold = Math.max(SEMANTIC_THRESHOLD_MIN, state.semantic.threshold);
  const k = Math.min(SEMANTIC_K_MAX, state.semantic.k);
  // The root's own k nearest (not "within the top k of either end", which would
  // let every leaf count the root as its nearest and ask for all of them).
  const best = new Map<string, number>();
  for (const e of result.edges) {
    if (e.from !== state.rootRef && e.to !== state.rootRef) continue;
    const other = e.from === state.rootRef ? e.to : e.from;
    if (other === state.rootRef || e.score < threshold) continue;
    best.set(other, Math.max(best.get(other) ?? 0, e.score));
  }
  const out = [...best]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, Math.max(0, k))
    .map(([ref]) => ref)
    .filter((ref) => !state.nodes.has(ref));
  return out;
}

/**
 * Wraps `step` with the one rule that spans all of it: whenever the selection
 * moves, the old object text is stale, and the new object has to be described.
 */
export function transition(state: GraphState, event: GraphEvent): Transition {
  const result = withSimilar(event, step(state, event));
  const before = state.selectedRef;
  const after = result.state.selectedRef;
  if (after === before) return result;
  const node = after ? result.state.nodes.get(after)?.node : undefined;
  return {
    state: { ...result.state, objectText: null },
    effects: node
      ? [
          ...result.effects,
          { type: "describe", ref: node.ref, display: describeObject(node) },
        ]
      : result.effects,
  };
}

/** Whatever moved the answer or the settings may have changed who is similar. */
function withSimilar(event: GraphEvent, t: Transition): Transition {
  if (event.type !== "semantic.loaded" && event.type !== "semantic.patch") {
    return t;
  }
  const refs = similarCandidates(t.state);
  if (refs.length === 0) return t;
  return {
    state: { ...t.state, similarPending: true },
    effects: [...t.effects, { type: "loadSimilar", refs }],
  };
}

function step(state: GraphState, event: GraphEvent): Transition {
  switch (event.type) {
    case "boot": {
      const effects: GraphEffect[] = [{ type: "fetchSemantic" }];
      const selected = state.selectedRef
        ? state.nodes.get(state.selectedRef)?.node
        : undefined;
      if (selected) {
        effects.push({
          type: "describe",
          ref: selected.ref,
          display: describeObject(selected),
        });
      }
      if (needsRings(state)) effects.push(ringsEffect(state));
      return { state, effects };
    }
    case "semantic.loaded":
      return { state: { ...state, semanticResult: event.result }, effects: [] };
    case "object.described":
      return {
        state:
          event.ref === state.selectedRef
            ? { ...state, objectText: { ref: event.ref, text: event.text } }
            : state,
        effects: [],
      };

    case "node.click": {
      const next = { ...state, selectedRef: event.ref };
      const status = state.nodes.get(event.ref)?.status;
      return {
        state: next,
        effects: status === "ghost" ? [{ type: "expand", ref: event.ref }] : [],
      };
    }
    case "node.select":
      return state.nodes.has(event.ref)
        ? { state: { ...state, selectedRef: event.ref }, effects: [] }
        : { state, effects: [] };
    case "node.open":
      return {
        state,
        effects:
          event.kind === "url"
            ? [{ type: "openUrl", url: event.ref }]
            : [
                {
                  type: "navigate",
                  target: navigationTarget(event.kind, event.ref),
                  close: true,
                },
              ],
      };
    case "edge.open":
      return {
        state,
        effects: [
          {
            type: "navigate",
            target:
              event.pos !== undefined
                ? `${event.page}@${event.pos}`
                : event.page,
            close: true,
          },
        ],
      };
    case "object.open":
      return {
        state,
        effects: [{ type: "navigate", target: event.ref, close: true }],
      };

    case "node.remove":
      return { state: removeNode(state, event.ref), effects: [] };
    case "selection.remove":
      return {
        state: state.selectedRef ? removeNode(state, state.selectedRef) : state,
        effects: [],
      };

    case "expansion.loaded":
      return { state: applyExpansions(state, event.results), effects: [] };

    case "similar.loaded": {
      // Only the pages themselves: their own relations load when one is clicked.
      let nodes: Map<string, NodeState> | null = null;
      for (const r of event.results) {
        if (state.nodes.has(r.object.ref)) continue;
        nodes ??= new Map(state.nodes);
        nodes.set(r.object.ref, { node: r.object, status: "ghost" });
      }
      return {
        state: { ...state, nodes: nodes ?? state.nodes, similarPending: false },
        effects: [],
      };
    }

    case "expandAll.request": {
      const { visibleNodes } = selectView(state);
      const expanded: string[] = [];
      const pending: string[] = [];
      for (const ns of visibleNodes) {
        (ns.status === "expanded" ? expanded : pending).push(ns.node.ref);
      }
      if (pending.length === 0) return { state, effects: [] };
      return {
        state,
        effects: [
          {
            type: "expandAll",
            expanded,
            pending,
            hiddenLabels: [...state.filters.hiddenLabels],
          },
        ],
      };
    }

    case "focus.request":
      return {
        state,
        effects: [
          { type: "focus", anchor: state.selectedRef ?? state.rootRef },
        ],
      };
    case "focus.loaded": {
      const { result } = event;
      const nodes = new Map<string, NodeState>();
      nodes.set(result.object.ref, { node: result.object, status: "expanded" });
      for (const n of result.neighbors) {
        if (!nodes.has(n.ref)) nodes.set(n.ref, { node: n, status: "ghost" });
      }
      return {
        state: {
          ...state,
          nodes,
          edges: dedupe([], result.edges),
          selectedRef: result.object.ref,
        },
        effects: [],
      };
    }

    case "filters.patch": {
      const filters = { ...state.filters, ...event.patch };
      return {
        state: { ...state, filters },
        effects: state.persistFilters
          ? [{ type: "persist", key: "filters", value: filters }]
          : [],
      };
    }
    case "forces.patch": {
      const forces = { ...state.forces, ...event.patch };
      return {
        state: { ...state, forces },
        effects: [{ type: "persist", key: "forces", value: forces }],
      };
    }
    case "semantic.patch": {
      const semantic = { ...state.semantic, ...event.patch };
      const next = { ...state, semantic };
      const effects: GraphEffect[] = [
        { type: "persist", key: "semantic", value: semantic },
      ];
      if (semantic.hops !== state.semantic.hops) {
        // A new radius abandons whatever the old one was still loading.
        effects.push({ type: "cancelRings" });
        if (needsRings(next)) effects.push(ringsEffect(next));
      }
      return { state: next, effects };
    }

    case "sheet.set":
      return event.open === state.sheetOpen
        ? { state, effects: [] }
        : { state: { ...state, sheetOpen: event.open }, effects: [] };

    case "panel.close":
      return { state, effects: [{ type: "closePanel" }] };
  }
}

export type GraphView = {
  visibleNodes: NodeState[];
  visibleEdges: Edge[];
  /** Explicit relations plus the semantic overlay: what the sidebar tallies. */
  allEdges: Edge[];
  semanticEdges: Edge[];
  ghostCount: number;
  /** Nodes "Hide orphans" is keeping off the canvas (0 when the filter is off). */
  hiddenOrphans: number;
  /** Pages the Tags / Status / Area filters keep off the canvas (apart from the
   * orphan rule, which hiddenOrphans counts). */
  hiddenByFilters: number;
};

/** What the panel paints, derived from the state. Pure, so a view can call it
 * per render and a transition can reason about what is on screen. */
export function selectView(state: GraphState): GraphView {
  // Semantic edges only connect pages that are already nodes in the graph.
  const semanticEdges =
    state.semanticResult?.status === "ok"
      ? buildSemanticEdges(
          state.semanticResult.edges,
          state.semantic,
          new Set(state.nodes.keys()),
        )
      : [];
  const allEdges = semanticEdges.length
    ? [...state.edges, ...semanticEdges]
    : (state.edges as Edge[]);
  const { visibleNodes, visibleEdges } = computeVisible(
    state.nodes.values(),
    allEdges,
    state.filters,
    state.rootRef,
    state.semantic.hops,
  );
  // What the orphan rule is hiding: the difference to the same view without it.
  const hiddenOrphans = state.filters.hideOrphans
    ? computeVisible(
        state.nodes.values(),
        allEdges,
        { ...state.filters, hideOrphans: false },
        state.rootRef,
        state.semantic.hops,
      ).visibleNodes.length - visibleNodes.length
    : 0;
  // The pages those filters remove: the difference to the same view with them
  // cleared. Both sides ignore the orphan rule so no page is counted twice.
  const open: Filters = { ...state.filters, hideOrphans: false };
  const hiddenByFilters =
    computeVisible(
      state.nodes.values(),
      allEdges,
      { ...open, hiddenTags: [], hiddenStatuses: [], hiddenAreas: [] },
      state.rootRef,
      state.semantic.hops,
    ).visibleNodes.length -
    computeVisible(
      state.nodes.values(),
      allEdges,
      open,
      state.rootRef,
      state.semantic.hops,
    ).visibleNodes.length;
  return {
    visibleNodes,
    visibleEdges,
    allEdges,
    semanticEdges,
    hiddenOrphans,
    hiddenByFilters,
    ghostCount: visibleNodes.reduce(
      (n, ns) => n + (ns.status === "ghost" ? 1 : 0),
      0,
    ),
  };
}
