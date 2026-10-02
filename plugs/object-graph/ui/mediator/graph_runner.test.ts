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
import { initialState, type GraphState } from "./graph_mediator.ts";
import {
  createGraphRunner,
  expandTransitively,
  type GraphRunnerDeps,
} from "./graph_runner.ts";

const node = (ref: string): ObjectNode => ({
  ref,
  kind: "page",
  title: ref,
  rootTag: "page",
  primaryTag: null,
  tags: [],
  dangling: false,
  attributes: {},
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
  label = "mention",
): ExpansionResult => ({
  object: node(ref),
  neighbors: neighbors.map(node),
  edges: neighbors.map((n) => edge(ref, n, label)),
});

/** A chain A - B - C - D - E, so each ring is one more hop. */
const CHAIN: Record<string, ExpansionResult> = {
  A: expansion("A", ["B"]),
  B: { ...expansion("B", ["A", "C"]), edges: [edge("A", "B"), edge("B", "C")] },
  C: { ...expansion("C", ["B", "D"]), edges: [edge("B", "C"), edge("C", "D")] },
  D: { ...expansion("D", ["C", "E"]), edges: [edge("C", "D"), edge("D", "E")] },
  E: expansion("E", []),
};

function vm(over: Partial<RootViewModel> = {}): RootViewModel {
  return {
    root: CHAIN.A,
    universe: { tags: [], labels: [], statuses: [], areas: [] },
    filters: { ...defaultFilters, hideOrphans: false },
    forces: defaultForceSettings,
    semantic: defaultSemanticSettings,
    ...over,
  };
}

function setup(over: Partial<GraphRunnerDeps> = {}, view = vm()) {
  const log: string[] = [];
  const states: GraphState[] = [];
  const fetched: string[] = [];
  const deps: GraphRunnerDeps = {
    async persist(key) {
      log.push(`persist ${key}`);
    },
    async fetchSemantic() {
      log.push("fetchSemantic");
      return { status: "ok", edges: [] };
    },
    async describe(display) {
      return JSON.stringify(display);
    },
    async fetchExpansion(ref) {
      fetched.push(ref);
      return CHAIN[ref] ?? expansion(ref, []);
    },
    async fetchFresh(ref) {
      log.push(`fresh ${ref}`);
      return CHAIN[ref] ?? expansion(ref, []);
    },
    async navigate(target) {
      log.push(`navigate ${target}`);
    },
    async openUrl(url) {
      log.push(`openUrl ${url}`);
    },
    async closePanel() {
      log.push("close");
    },
    onState: (s) => states.push(s),
    ...over,
  };
  const runner = createGraphRunner(initialState(view), deps);
  return { runner, log, states, fetched };
}

const settle = () => new Promise((r) => setTimeout(r, 0));
const refs = (s: GraphState) => [...s.nodes.keys()].sort();

describe("graph runner", () => {
  test("boot fetches the semantic edges and the answer lands in the state", async () => {
    const { runner, log } = setup();
    runner.emit({ type: "boot" });
    await settle();
    expect(log).toEqual(["fetchSemantic"]);
    expect(runner.getState().semanticResult).toEqual({
      status: "ok",
      edges: [],
    });
  });

  test("a failing sidecar becomes a notice, never an exception", async () => {
    const { runner } = setup({
      async fetchSemantic() {
        throw new Error("boom");
      },
    });
    runner.emit({ type: "boot" });
    await settle();
    expect(runner.getState().semanticResult).toEqual({
      status: "error",
      message: "similar pages failed (boom)",
      edges: [],
    });
  });

  test("the root's similar pages join the graph as ghosts, even if one cannot be read", async () => {
    const { runner, fetched } = setup({
      async fetchSemantic() {
        return {
          status: "ok",
          edges: [
            { from: "A", to: "S1", score: 0.9 },
            { from: "A", to: "Broken", score: 0.88 },
          ],
        };
      },
      async fetchExpansion(ref) {
        if (ref === "Broken") throw new Error("gone");
        return CHAIN[ref] ?? expansion(ref, ["Far"]);
      },
    });
    runner.emit({ type: "boot" });
    await settle();
    await settle();
    expect(fetched).toEqual([]);
    expect(refs(runner.getState())).toEqual(["A", "B", "S1"]);
    expect(runner.getState().nodes.get("S1")?.status).toBe("ghost");
  });

  test("clicking a ghost loads it", async () => {
    const { runner } = setup();
    runner.emit({ type: "node.click", ref: "B" });
    await settle();
    expect(runner.getState().nodes.get("B")?.status).toBe("expanded");
    expect(refs(runner.getState())).toEqual(["A", "B", "C"]);
  });

  test("a failing expansion leaves the graph as it was", async () => {
    const { runner } = setup({
      async fetchExpansion() {
        throw new Error("worker gone");
      },
    });
    runner.emit({ type: "node.click", ref: "B" });
    await settle();
    expect(runner.getState().nodes.get("B")?.status).toBe("ghost");
    expect(runner.getState().selectedRef).toBe("B");
  });

  test("settings persist under their own keys", async () => {
    const { runner, log } = setup();
    runner.emit({ type: "filters.patch", patch: { hideOrphans: true } });
    runner.emit({ type: "forces.patch", patch: { linkDistance: 10 } });
    runner.emit({ type: "semantic.patch", patch: { threshold: 0.8 } });
    await settle();
    expect(log).toEqual([
      "persist filters",
      "persist forces",
      "persist semantic",
    ]);
  });

  test("the radius loads exactly the rings it needs", async () => {
    const { runner, fetched } = setup();
    runner.emit({ type: "semantic.patch", patch: { hops: 3 } });
    await settle();
    // Rings 1..2 are expanded to reveal ring 3: B, then C.
    expect(fetched).toEqual(["B", "C"]);
    expect(refs(runner.getState())).toEqual(["A", "B", "C", "D"]);
  });

  test("a new radius abandons the load in flight", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { runner } = setup({
      async fetchExpansion(ref) {
        await gate;
        return CHAIN[ref] ?? expansion(ref, []);
      },
    });
    runner.emit({ type: "semantic.patch", patch: { hops: 3 } });
    runner.emit({ type: "semantic.patch", patch: { hops: 1 } });
    release();
    await settle();
    // The abandoned load never applied its rings.
    expect(refs(runner.getState())).toEqual(["A", "B"]);
  });

  test("focus asks for the node afresh and starts over from it", async () => {
    const { runner, log } = setup();
    runner.emit({ type: "node.click", ref: "B" });
    await settle();
    runner.emit({ type: "focus.request" });
    await settle();
    expect(log).toContain("fresh B");
    expect(refs(runner.getState())).toEqual(["A", "B", "C"]);
    expect(runner.getState().selectedRef).toBe("B");
  });

  test("opening a node navigates and then closes the panel", async () => {
    const { runner, log } = setup();
    runner.emit({ type: "node.open", ref: "Notes/Plan", kind: "page" });
    await settle();
    expect(log).toEqual(["navigate Notes/Plan", "close"]);
  });

  test("a failed navigation does not close the panel", async () => {
    const { runner, log } = setup({
      async navigate() {
        throw new Error("no such page");
      },
    });
    runner.emit({ type: "node.open", ref: "X", kind: "page" });
    await settle();
    expect(log).toEqual([]);
  });

  test("a URL opens without closing", async () => {
    const { runner, log } = setup();
    runner.emit({ type: "node.open", ref: "https://x.test", kind: "url" });
    await settle();
    expect(log).toEqual(["openUrl https://x.test"]);
  });

  test("the state is announced only when it changed", async () => {
    const { runner, states } = setup();
    runner.emit({ type: "node.click", ref: "A" }); // already selected, expanded
    runner.emit({ type: "panel.close" });
    await settle();
    expect(states.length).toBe(1); // node.click returns a fresh object
    runner.emit({ type: "boot" });
    await settle();
    expect(states.length).toBe(3); // + the semantic answer, + the root's text
    expect(runner.getState().objectText).toEqual({
      ref: "A",
      text: JSON.stringify({ tag: "page" }),
    });
  });
});

describe("expandTransitively", () => {
  test("walks the whole chain from the first ghost", async () => {
    const applied: string[][] = [];
    await expandTransitively(
      ["A"],
      ["B"],
      [],
      async (ref) => CHAIN[ref],
      (results) => applied.push(results.map((r) => r.object.ref)),
    );
    expect(applied).toEqual([["B"], ["C"], ["D"], ["E"]]);
  });

  test("does not follow a hidden label, but still records the edge", async () => {
    const applied: string[] = [];
    await expandTransitively(
      ["A"],
      ["B"],
      ["mention"],
      async (ref) => CHAIN[ref],
      (results) => applied.push(...results.map((r) => r.object.ref)),
    );
    expect(applied).toEqual(["B"]);
  });

  test("stops at the cap", async () => {
    const applied: string[][] = [];
    await expandTransitively(
      ["A"],
      ["B"],
      [],
      async (ref) => CHAIN[ref],
      (results) => applied.push(results.map((r) => r.object.ref)),
      3,
    );
    expect(applied.flat()).toEqual(["B", "C"]);
  });

  test("never fetches a node twice", async () => {
    const fetched: string[] = [];
    await expandTransitively(
      ["A"],
      ["B"],
      [],
      async (ref) => {
        fetched.push(ref);
        return CHAIN[ref];
      },
      () => {},
    );
    expect(new Set(fetched).size).toBe(fetched.length);
  });
});
