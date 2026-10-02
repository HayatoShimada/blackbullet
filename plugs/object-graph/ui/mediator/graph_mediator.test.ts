import { describe, expect, test } from "vitest";
import {
  defaultFilters,
  defaultForceSettings,
  defaultSemanticSettings,
  type Edge,
  type ExpansionResult,
  type ObjectNode,
  type RootViewModel,
} from "../../src/model.ts";
import {
  describeObject,
  initialState,
  navigationTarget,
  selectView,
  transition,
  type GraphEvent,
  type GraphState,
} from "./graph_mediator.ts";

const node = (ref: string, over: Partial<ObjectNode> = {}): ObjectNode => ({
  ref,
  kind: "page",
  title: ref,
  rootTag: "page",
  primaryTag: null,
  tags: [],
  dangling: false,
  attributes: {},
  ...over,
});

const edge = (source: string, target: string, label = "mention"): Edge => ({
  source,
  target,
  label,
  kind: label,
  refs: [],
  undirected: false,
});

const expansion = (
  ref: string,
  neighbors: string[],
  edges: Edge[] = neighbors.map((n) => edge(ref, n)),
): ExpansionResult => ({
  object: node(ref),
  neighbors: neighbors.map((n) => node(n)),
  edges,
});

function vm(over: Partial<RootViewModel> = {}): RootViewModel {
  return {
    root: expansion("A", ["B", "C"]),
    universe: { tags: [], labels: [], statuses: [], areas: [] },
    filters: { ...defaultFilters, hideOrphans: false },
    forces: defaultForceSettings,
    semantic: defaultSemanticSettings,
    ...over,
  };
}

function run(events: GraphEvent[], from: GraphState = initialState(vm())) {
  let state = from;
  const effects = [];
  for (const event of events) {
    const next = transition(state, event);
    state = next.state;
    effects.push(...next.effects);
  }
  return { state, effects };
}

const refs = (state: GraphState) => [...state.nodes.keys()].sort();

describe("initialState", () => {
  test("the root is expanded and its neighbours are ghosts", () => {
    const state = initialState(vm());
    expect(state.nodes.get("A")?.status).toBe("expanded");
    expect(state.nodes.get("B")?.status).toBe("ghost");
    expect(state.selectedRef).toBe("A");
    expect(state.semanticResult).toBeNull();
  });

  test("the global view starts with everything expanded and no ring loading", () => {
    const state = initialState(vm({ initialAllExpanded: true }));
    expect(state.nodes.get("B")?.status).toBe("expanded");
    expect(state.allExpanded).toBe(true);
  });

  test("a transient view does not persist its filters", () => {
    expect(initialState(vm({ persistFilters: false })).persistFilters).toBe(
      false,
    );
    expect(initialState(vm()).persistFilters).toBe(true);
  });
});

describe("boot", () => {
  test("asks for the semantic edges", () => {
    expect(run([{ type: "boot" }]).effects).toEqual([
      { type: "fetchSemantic" },
      { type: "describe", ref: "A", display: { tag: "page" } },
    ]);
  });

  test("a saved radius of 2 or more loads the rings from the start", () => {
    const state = initialState(
      vm({ semantic: { ...defaultSemanticSettings, hops: 3 } }),
    );
    expect(run([{ type: "boot" }], state).effects).toEqual([
      { type: "fetchSemantic" },
      { type: "describe", ref: "A", display: { tag: "page" } },
      {
        type: "expandRings",
        rootRef: "A",
        neighborRefs: ["B", "C"],
        hops: 3,
      },
    ]);
  });

  test("the global view never loads rings", () => {
    const state = initialState(
      vm({
        initialAllExpanded: true,
        semantic: { ...defaultSemanticSettings, hops: 3 },
      }),
    );
    expect(run([{ type: "boot" }], state).effects).toEqual([
      { type: "fetchSemantic" },
      { type: "describe", ref: "A", display: { tag: "page" } },
    ]);
  });
});

describe("selecting and expanding", () => {
  test("clicking a ghost selects it and loads its relations", () => {
    const { state, effects } = run([{ type: "node.click", ref: "B" }]);
    expect(state.selectedRef).toBe("B");
    expect(effects).toEqual([
      { type: "expand", ref: "B" },
      { type: "describe", ref: "B", display: { tag: "page" } },
    ]);
  });

  test("clicking an expanded node only selects it", () => {
    const { state, effects } = run([{ type: "node.click", ref: "A" }]);
    expect(state.selectedRef).toBe("A");
    expect(effects).toEqual([]);
  });

  test("an expansion makes the node expanded and its new neighbours ghosts", () => {
    const { state } = run([
      { type: "expansion.loaded", results: [expansion("B", ["A", "D"])] },
    ]);
    expect(state.nodes.get("B")?.status).toBe("expanded");
    expect(state.nodes.get("D")?.status).toBe("ghost");
    // A was already there: it keeps the state it had.
    expect(state.nodes.get("A")?.status).toBe("expanded");
  });

  test("the same relation arriving twice is one edge", () => {
    const again = expansion("B", ["A"], [edge("A", "B")]);
    const { state } = run([{ type: "expansion.loaded", results: [again] }]);
    expect(state.edges).toHaveLength(2);
  });

  test("an empty answer changes nothing, not even identity", () => {
    const before = initialState(vm());
    expect(
      transition(before, { type: "expansion.loaded", results: [] }).state,
    ).toBe(before);
  });

  test("an expansion that adds nothing new keeps the edge list as it was", () => {
    const before = initialState(vm());
    const next = transition(before, {
      type: "expansion.loaded",
      results: [expansion("A", ["B", "C"])],
    }).state;
    expect(next.edges).toBe(before.edges);
  });
});

describe("removing", () => {
  test("removes the node, its edges and its selection", () => {
    const { state } = run([
      { type: "node.click", ref: "B" },
      { type: "selection.remove" },
    ]);
    expect(refs(state)).toEqual(["A", "C"]);
    expect(state.edges.map((e) => e.target)).toEqual(["C"]);
    expect(state.selectedRef).toBeNull();
  });

  test("with nothing selected there is nothing to remove", () => {
    const base = { ...initialState(vm()), selectedRef: null };
    expect(transition(base, { type: "selection.remove" }).state).toBe(base);
  });

  test("removing another node keeps the selection", () => {
    const { state } = run([{ type: "node.remove", ref: "C" }]);
    expect(state.selectedRef).toBe("A");
    expect(refs(state)).toEqual(["A", "B"]);
  });
});

describe("expand all", () => {
  test("hands the runner what is expanded, what is pending and which labels to skip", () => {
    const base = initialState(
      vm({
        filters: {
          ...defaultFilters,
          hideOrphans: false,
          hiddenLabels: ["quiet"],
        },
      }),
    );
    expect(run([{ type: "expandAll.request" }], base).effects).toEqual([
      {
        type: "expandAll",
        expanded: ["A"],
        pending: ["B", "C"],
        hiddenLabels: ["quiet"],
      },
    ]);
  });

  test("with no ghost left, does nothing", () => {
    const { effects } = run([
      {
        type: "expansion.loaded",
        results: [expansion("B", []), expansion("C", [])],
      },
      { type: "expandAll.request" },
    ]);
    expect(effects).toEqual([]);
  });
});

describe("focus", () => {
  test("re-fetches the selected node, not the root", () => {
    const { effects } = run([
      { type: "node.click", ref: "B" },
      { type: "focus.request" },
    ]);
    expect(effects.at(-1)).toEqual({ type: "focus", anchor: "B" });
  });

  test("with nothing selected it falls back to the root", () => {
    const base = { ...initialState(vm()), selectedRef: null };
    expect(run([{ type: "focus.request" }], base).effects).toEqual([
      { type: "focus", anchor: "A" },
    ]);
  });

  test("the answer replaces everything explored, keeps the root, selects the anchor", () => {
    const { state } = run([
      { type: "expansion.loaded", results: [expansion("B", ["D", "E"])] },
      { type: "focus.loaded", result: expansion("B", ["D"]) },
    ]);
    expect(refs(state)).toEqual(["B", "D"]);
    expect(state.selectedRef).toBe("B");
    expect(state.rootRef).toBe("A");
    expect(state.edges).toHaveLength(1);
  });
});

describe("settings", () => {
  test("filters persist, unless the view is transient", () => {
    const base = initialState(vm());
    const filters = { ...base.filters, hideOrphans: true };
    expect(
      run([{ type: "filters.patch", patch: { hideOrphans: true } }], base)
        .effects,
    ).toEqual([{ type: "persist", key: "filters", value: filters }]);
    const transient = initialState(vm({ persistFilters: false }));
    const next = run(
      [{ type: "filters.patch", patch: { hideOrphans: true } }],
      transient,
    );
    expect(next.effects).toEqual([]);
    expect(next.state.filters.hideOrphans).toBe(true);
  });

  test("forces always persist", () => {
    const forces = { ...defaultForceSettings, linkDistance: 50 };
    expect(
      run(
        [{ type: "forces.patch", patch: { linkDistance: 50 } }],
        initialState(vm({ persistFilters: false })),
      ).effects,
    ).toEqual([{ type: "persist", key: "forces", value: forces }]);
  });

  test("a wider radius cancels the old load and starts the new one", () => {
    const semantic = { ...defaultSemanticSettings, hops: 2 };
    expect(
      run([{ type: "semantic.patch", patch: { hops: 2 } }]).effects,
    ).toEqual([
      { type: "persist", key: "semantic", value: semantic },
      { type: "cancelRings" },
      { type: "expandRings", rootRef: "A", neighborRefs: ["B", "C"], hops: 2 },
    ]);
  });

  test("going back to 1 hop or All only cancels", () => {
    const wide = initialState(
      vm({ semantic: { ...defaultSemanticSettings, hops: 3 } }),
    );
    const semantic = { ...defaultSemanticSettings, hops: 1 };
    expect(
      run([{ type: "semantic.patch", patch: { hops: 1 } }], wide).effects,
    ).toEqual([
      { type: "persist", key: "semantic", value: semantic },
      { type: "cancelRings" },
    ]);
  });

  test("changing the threshold does not touch the rings", () => {
    const semantic = { ...defaultSemanticSettings, threshold: 0.8 };
    expect(
      run([{ type: "semantic.patch", patch: { threshold: 0.8 } }]).effects,
    ).toEqual([{ type: "persist", key: "semantic", value: semantic }]);
  });

  test("the global view has no rings to load at any radius", () => {
    const global = initialState(vm({ initialAllExpanded: true }));
    expect(
      run([{ type: "semantic.patch", patch: { hops: 3 } }], global).effects.map(
        (e) => e.type,
      ),
    ).toEqual(["persist", "cancelRings"]);
  });
});

describe("going somewhere", () => {
  test("a node opens its page, then the panel closes", () => {
    expect(
      run([{ type: "node.open", ref: "Notes/Plan", kind: "page" }]).effects,
    ).toEqual([{ type: "navigate", target: "Notes/Plan", close: true }]);
  });

  test("a URL opens in the browser and the panel stays", () => {
    expect(
      run([{ type: "node.open", ref: "https://x.test", kind: "url" }]).effects,
    ).toEqual([{ type: "openUrl", url: "https://x.test" }]);
  });

  test("a bare anchor name goes through the anchor", () => {
    expect(navigationTarget("item", "pete-ref")).toBe("$pete-ref");
    expect(navigationTarget("block", "x")).toBe("$x");
    expect(navigationTarget("item", "Page@42")).toBe("Page@42");
    expect(navigationTarget("page", "Page")).toBe("Page");
    expect(navigationTarget("file", "a.png")).toBe("a.png");
  });

  test("an edge opens where the relation was written", () => {
    expect(
      run([{ type: "edge.open", page: "Notes", pos: 120 }]).effects,
    ).toEqual([{ type: "navigate", target: "Notes@120", close: true }]);
    expect(run([{ type: "edge.open", page: "Notes" }]).effects).toEqual([
      { type: "navigate", target: "Notes", close: true },
    ]);
  });

  test("the sidebar's link opens the selected ref as is", () => {
    expect(run([{ type: "object.open", ref: "$x" }]).effects).toEqual([
      { type: "navigate", target: "$x", close: true },
    ]);
  });

  test("closing", () => {
    expect(run([{ type: "panel.close" }]).effects).toEqual([
      { type: "closePanel" },
    ]);
  });
});

describe("selectView", () => {
  test("counts the ghosts that are on screen", () => {
    expect(selectView(initialState(vm())).ghostCount).toBe(2);
  });

  test("an unconfigured sidecar says so, an answer from it stays quiet", () => {
    const base = initialState(vm());
    const off = transition(base, {
      type: "semantic.loaded",
      result: {
        status: "unconfigured",
        message: "no memoSidecar",
        edges: [],
      },
    }).state;
    expect(selectView(off).semanticNotice).toBe(
      "Semantic edges off: no memoSidecar",
    );
    const ok = transition(base, {
      type: "semantic.loaded",
      result: { status: "ok", edges: [] },
    }).state;
    expect(selectView(ok).semanticNotice).toBeNull();
    expect(selectView(base).semanticNotice).toBeNull();
  });

  test("semantic edges join the graph only between nodes that are in it", () => {
    const loaded = transition(initialState(vm()), {
      type: "semantic.loaded",
      result: {
        status: "ok",
        edges: [
          { from: "B", to: "C", score: 0.97 },
          { from: "B", to: "Elsewhere", score: 0.99 },
        ],
      },
    }).state;
    const view = selectView(loaded);
    expect(view.semanticEdges).toHaveLength(1);
    expect(view.semanticEdges[0]).toMatchObject({ kind: "semantic" });
    expect(view.allEdges).toHaveLength(loaded.edges.length + 1);
  });

  test("the radius limits what is drawn to the root's neighbourhood", () => {
    const state = run([
      { type: "expansion.loaded", results: [expansion("B", ["D"])] },
      { type: "semantic.patch", patch: { hops: 1 } },
    ]).state;
    expect(
      selectView(state)
        .visibleNodes.map((n) => n.node.ref)
        .sort(),
    ).toEqual(["A", "B", "C"]);
  });
});

describe("describing the selected object", () => {
  test("boot describes the root, the selection it starts with", () => {
    const { effects } = run([{ type: "boot" }]);
    expect(effects).toContainEqual({
      type: "describe",
      ref: "A",
      display: { tag: "page" },
    });
  });

  test("moving the selection describes the new object and drops the old text", () => {
    const described = run([
      { type: "object.described", ref: "A", text: "tag: page" },
    ]).state;
    expect(described.objectText).toEqual({ ref: "A", text: "tag: page" });
    const { state, effects } = run(
      [{ type: "node.click", ref: "B" }],
      described,
    );
    expect(state.objectText).toBeNull();
    expect(effects).toContainEqual({
      type: "describe",
      ref: "B",
      display: { tag: "page" },
    });
  });

  test("an answer for an object no longer selected is dropped", () => {
    const { state } = run([
      { type: "node.click", ref: "B" },
      { type: "object.described", ref: "A", text: "stale" },
    ]);
    expect(state.objectText).toBeNull();
  });

  test("clicking what is already selected does not describe it again", () => {
    const { effects } = run([{ type: "node.click", ref: "A" }]);
    expect(effects).toEqual([]);
  });

  test("removing the selection clears the text and asks for nothing", () => {
    const { state, effects } = run([
      { type: "object.described", ref: "A", text: "t" },
      { type: "selection.remove" },
    ]);
    expect(state.selectedRef).toBeNull();
    expect(state.objectText).toBeNull();
    expect(effects).toEqual([]);
  });

  test("a stub node falls back to its kind for the tag", () => {
    expect(
      describeObject({ rootTag: null, kind: "url", attributes: { a: 1 } }),
    ).toEqual({ tag: "url", a: 1 });
    expect(
      describeObject({
        rootTag: "page",
        kind: "page",
        attributes: { tag: "x" },
      }),
    ).toEqual({ tag: "x" });
  });
});
