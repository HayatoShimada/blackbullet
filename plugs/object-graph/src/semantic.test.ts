import { describe, expect, it } from "vitest";
import {
  buildSemanticEdges,
  expandLocalRings,
  filterSemanticEdges,
  nodeAreas,
  nodeStatus,
  nodesWithinHops,
  parseGraphResponse,
  type SemanticEdgeRaw,
} from "./semantic.ts";

const raw = (from: string, to: string, score: number): SemanticEdgeRaw => ({
  from,
  to,
  score,
});

describe("parseGraphResponse", () => {
  it("keeps well-formed edges and drops the rest", () => {
    const body = {
      edges: [
        { from: "A", to: "B", kind: "semantic", score: 0.9 },
        { from: "A", to: "C" },
        { from: "A", to: "D", score: "0.9" },
        null,
      ],
    };
    expect(parseGraphResponse(body)).toEqual([raw("A", "B", 0.9)]);
  });

  it("returns [] for unexpected bodies", () => {
    expect(parseGraphResponse(null)).toEqual([]);
    expect(parseGraphResponse({ error: "x" })).toEqual([]);
    expect(parseGraphResponse("nope")).toEqual([]);
  });
});

describe("filterSemanticEdges", () => {
  it("drops edges below the threshold and self loops", () => {
    const r = filterSemanticEdges(
      [raw("A", "B", 0.95), raw("A", "C", 0.7), raw("A", "A", 0.99)],
      0.8,
      10,
    );
    expect(r).toEqual([raw("A", "B", 0.95)]);
  });

  it("merges A-B and B-A, keeping the higher score", () => {
    const r = filterSemanticEdges(
      [raw("B", "A", 0.8), raw("A", "B", 0.9)],
      0,
      3,
    );
    expect(r).toEqual([raw("A", "B", 0.9)]);
  });

  it("keeps a pair that is in the top-k of either endpoint", () => {
    // Hub H has 3 neighbours but k=1: only H-X survives from H's side, yet
    // H-Y is X-less spoke Y's single best edge, so it stays too.
    const r = filterSemanticEdges(
      [
        raw("H", "X", 0.99),
        raw("H", "Y", 0.9),
        raw("H", "Z", 0.85),
        raw("Z", "W", 0.95),
      ],
      0,
      1,
    );
    const pairs = r.map((e) => `${e.from}-${e.to}`).sort();
    // H-X (best for H and X), Z-W (best for Z and W), H-Y (best for Y).
    expect(pairs).toEqual(["H-X", "H-Y", "W-Z"]);
  });

  it("returns edges sorted by score descending", () => {
    const r = filterSemanticEdges(
      [raw("A", "B", 0.8), raw("C", "D", 0.9)],
      0,
      3,
    );
    expect(r.map((e) => e.score)).toEqual([0.9, 0.8]);
  });

  it("k = 0 keeps nothing", () => {
    expect(filterSemanticEdges([raw("A", "B", 0.9)], 0, 0)).toEqual([]);
  });
});

describe("buildSemanticEdges", () => {
  const all = [raw("A", "B", 0.9), raw("A", "Ghost", 0.95), raw("B", "C", 0.7)];
  const refs = new Set(["A", "B", "C"]);

  it("only connects existing nodes and marks edges semantic", () => {
    const e = buildSemanticEdges(
      all,
      { show: true, threshold: 0.6, k: 5 },
      refs,
    );
    expect(e.map((x) => `${x.source}-${x.target}`)).toEqual(["A-B", "B-C"]);
    expect(e[0]).toMatchObject({
      kind: "semantic",
      label: "semantic",
      undirected: true,
      refs: [],
      score: 0.9,
    });
  });

  it("applies the threshold", () => {
    const e = buildSemanticEdges(
      all,
      { show: true, threshold: 0.8, k: 5 },
      refs,
    );
    expect(e.map((x) => x.score)).toEqual([0.9]);
  });

  it("returns nothing when hidden", () => {
    expect(
      buildSemanticEdges(all, { show: false, threshold: 0.6, k: 5 }, refs),
    ).toEqual([]);
  });

  it("clamps settings to the slider range", () => {
    // threshold below the slider minimum is raised to it.
    const e = buildSemanticEdges(
      [raw("A", "B", 0.5), raw("A", "C", 0.65)],
      { show: true, threshold: 0.1, k: 99 },
      refs,
    );
    expect(e.map((x) => x.score)).toEqual([0.65]);
  });
});

describe("nodesWithinHops", () => {
  const edges = [
    { source: "R", target: "A" },
    { source: "B", target: "A" },
    { source: "B", target: "C" },
    { source: "D", target: "C" },
  ];

  it("is unlimited (null) for hops <= 0", () => {
    expect(nodesWithinHops(edges, "R", 0)).toBeNull();
  });

  it("expands one ring per hop, ignoring direction", () => {
    expect([...nodesWithinHops(edges, "R", 1)!].sort()).toEqual(["A", "R"]);
    expect([...nodesWithinHops(edges, "R", 2)!].sort()).toEqual([
      "A",
      "B",
      "R",
    ]);
    expect([...nodesWithinHops(edges, "R", 3)!].sort()).toEqual([
      "A",
      "B",
      "C",
      "R",
    ]);
  });

  it("always contains the root, even when isolated", () => {
    expect([...nodesWithinHops([], "R", 2)!]).toEqual(["R"]);
  });
});

describe("node frontmatter helpers", () => {
  const n = (
    ref: string,
    attributes: Record<string, unknown>,
    kind: "page" | "url" = "page",
  ) => ({ ref, kind, attributes });

  it("reads status, defaulting to (none)", () => {
    expect(nodeStatus(n("A", { status: "active" }))).toBe("active");
    expect(nodeStatus(n("A", {}))).toBe("(none)");
    expect(nodeStatus(n("A", { status: "  " }))).toBe("(none)");
  });

  it("prefers frontmatter area, else the top folder, else (none)", () => {
    expect(nodeAreas(n("Projects/X", { area: "Work" }))).toEqual(["Work"]);
    expect(nodeAreas(n("Projects/X", { area: ["A", "B"] }))).toEqual([
      "A",
      "B",
    ]);
    expect(nodeAreas(n("Projects/X", {}))).toEqual(["Projects"]);
    expect(nodeAreas(n("Inbox", {}))).toEqual(["(none)"]);
    expect(nodeAreas(n("https://a/b", {}, "url"))).toEqual(["(none)"]);
  });
});

describe("expandLocalRings", () => {
  // R - A1, A2 (ring 1); A1 - B1; A2 - B2 (ring 2); B1 - C1 (ring 3)
  const graph: Record<string, string[]> = {
    R: ["A1", "A2"],
    A1: ["R", "B1"],
    A2: ["R", "B2"],
    B1: ["A1", "C1"],
    B2: ["A2"],
    C1: ["B1"],
  };
  const run = async (hops: number) => {
    const fetched: string[] = [];
    await expandLocalRings(
      "R",
      graph.R,
      hops,
      async (ref) => {
        fetched.push(ref);
        return { neighbors: graph[ref].map((r) => ({ ref: r })) };
      },
      () => {},
    );
    return fetched.sort();
  };

  it("needs no round trips for 1 hop (the root is already expanded)", async () => {
    expect(await run(1)).toEqual([]);
  });

  it("expands ring 1 for 2 hops, which is what reveals ring 2", async () => {
    expect(await run(2)).toEqual(["A1", "A2"]);
  });

  it("expands rings 1 and 2 for 3 hops, never refetching the root", async () => {
    expect(await run(3)).toEqual(["A1", "A2", "B1", "B2"]);
  });

  it("stops when cancelled before applying", async () => {
    const applied: unknown[] = [];
    await expandLocalRings(
      "R",
      graph.R,
      3,
      async (ref) => ({ neighbors: graph[ref].map((r) => ({ ref: r })) }),
      (r) => applied.push(r),
      () => true,
    );
    expect(applied).toEqual([]);
  });
});
