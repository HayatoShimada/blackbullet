import { describe, expect, it } from "vitest";
import type { Edge, Filters, ObjectNode } from "../../src/model.ts";
import { computeVisible, type NodeState } from "./visibility.ts";

const node = (
  ref: string,
  tags: string[] = [],
  rootTag: string | null = "page",
): ObjectNode => ({
  kind: "page",
  ref,
  title: ref,
  rootTag,
  primaryTag: tags[0] ?? null,
  tags,
  dangling: false,
  attributes: {},
});

const ns = (ref: string, tags: string[] = []): NodeState => ({
  node: node(ref, tags),
  status: "expanded",
});

const edge = (source: string, target: string, label: string): Edge => ({
  source,
  target,
  label,
  kind: "mention",
  refs: [],
  undirected: false,
});

const filters = (overrides: Partial<Filters> = {}): Filters => ({
  hiddenTags: [],
  hiddenLabels: [],
  hideEdgeLabels: false,
  hideOrphans: true,
  ...overrides,
});

describe("computeVisible", () => {
  it("keeps the root visible even with no edges", () => {
    const r = computeVisible(
      [ns("Root"), ns("B"), ns("C")],
      [],
      filters(),
      "Root",
    );
    expect(r.visibleNodes.map((n) => n.node.ref)).toEqual(["Root"]);
    expect(r.visibleEdges).toEqual([]);
  });

  it("hides orphans (non-root with no labeled edge)", () => {
    const r = computeVisible(
      [ns("Root"), ns("B"), ns("Orphan")],
      [edge("Root", "B", "mention")],
      filters(),
      "Root",
    );
    const refs = r.visibleNodes.map((n) => n.node.ref).sort();
    expect(refs).toEqual(["B", "Root"]);
  });

  it("hideOrphans=false keeps everyone visible regardless of edges", () => {
    const r = computeVisible(
      [ns("Root"), ns("B"), ns("Orphan")],
      [edge("Root", "B", "mention")],
      filters({ hideOrphans: false }),
      "Root",
    );
    expect(r.visibleNodes).toHaveLength(3);
  });

  it("drops edges with hidden labels and re-evaluates orphan status", () => {
    const r = computeVisible(
      [ns("Root"), ns("X")],
      [edge("Root", "X", "co-mention")],
      filters({ hiddenLabels: ["co-mention"] }),
      "Root",
    );
    // X is now an orphan because its only edge was filtered out.
    expect(r.visibleNodes.map((n) => n.node.ref)).toEqual(["Root"]);
    expect(r.visibleEdges).toEqual([]);
  });

  it("applies the tag filter uniformly (root excepted)", () => {
    const r = computeVisible(
      [ns("Root", []), ns("Driver", ["driver"]), ns("Engineer", ["engineer"])],
      [edge("Root", "Driver", "mention"), edge("Root", "Engineer", "mention")],
      filters({ hiddenTags: ["engineer"] }),
      "Root",
    );
    const refs = r.visibleNodes.map((n) => n.node.ref).sort();
    expect(refs).toEqual(["Driver", "Root"]);
    expect(r.visibleEdges).toHaveLength(1);
    expect(r.visibleEdges[0].target).toBe("Driver");
  });

  it("treats untagged nodes as a separate hideable bucket", () => {
    const r = computeVisible(
      [ns("Root"), ns("Untagged", [])],
      [edge("Root", "Untagged", "mention")],
      filters({ hiddenTags: ["(untagged)"] }),
      "Root",
    );
    expect(r.visibleNodes.map((n) => n.node.ref)).toEqual(["Root"]);
  });

  it("drops edges that touch a tag-filtered endpoint", () => {
    const r = computeVisible(
      [ns("Root"), ns("Visible", ["driver"]), ns("Hidden", ["engineer"])],
      [
        edge("Visible", "Hidden", "mention"),
        edge("Root", "Visible", "mention"),
      ],
      filters({ hiddenTags: ["engineer"] }),
      "Root",
    );
    expect(r.visibleEdges).toHaveLength(1);
    expect(r.visibleEdges[0].source).toBe("Root");
  });

  it("keeps an edge if any tag on a node passes (multi-tag union)", () => {
    const r = computeVisible(
      [ns("Root"), ns("Both", ["driver", "person"])],
      [edge("Root", "Both", "mention")],
      filters({ hiddenTags: ["driver"] }),
      "Root",
    );
    expect(r.visibleNodes.map((n) => n.node.ref).sort()).toEqual([
      "Both",
      "Root",
    ]);
  });
});

describe("computeVisible: semantic edges, hops, frontmatter filters", () => {
  const sem = (a: string, b: string): Edge => ({
    source: a,
    target: b,
    label: "semantic",
    kind: "semantic",
    refs: [],
    undirected: true,
    score: 0.9,
  });
  const nsAttr = (
    ref: string,
    attributes: Record<string, unknown>,
  ): NodeState => ({
    node: { ...node(ref), attributes },
    status: "expanded",
  });

  it("semantic edges count toward visibility like any edge", () => {
    const r = computeVisible(
      [ns("Root"), ns("B")],
      [sem("Root", "B")],
      filters(),
      "Root",
    );
    expect(r.visibleNodes).toHaveLength(2);
    expect(r.visibleEdges).toHaveLength(1);
  });

  it("explicit edges alone are unchanged when no semantic edges are present", () => {
    const edges = [edge("Root", "B", "mention")];
    const a = computeVisible([ns("Root"), ns("B")], edges, filters(), "Root");
    const b = computeVisible(
      [ns("Root"), ns("B")],
      edges,
      filters(),
      "Root",
      0,
    );
    expect(a).toEqual(b);
    expect(a.visibleEdges).toEqual(edges);
  });

  it("limits to N hops over explicit and semantic edges", () => {
    const nodes = [ns("Root"), ns("A"), ns("B"), ns("C")];
    const edges = [
      edge("Root", "A", "mention"),
      sem("A", "B"),
      edge("B", "C", "mention"),
    ];
    const refs = (hops: number) =>
      computeVisible(nodes, edges, filters(), "Root", hops)
        .visibleNodes.map((n) => n.node.ref)
        .sort();
    expect(refs(1)).toEqual(["A", "Root"]);
    expect(refs(2)).toEqual(["A", "B", "Root"]);
    expect(refs(3)).toEqual(["A", "B", "C", "Root"]);
    expect(refs(0)).toEqual(["A", "B", "C", "Root"]);
  });

  it("drops edges that leave the hop radius", () => {
    const r = computeVisible(
      [ns("Root"), ns("A"), ns("B")],
      [edge("Root", "A", "mention"), edge("A", "B", "mention")],
      filters(),
      "Root",
      1,
    );
    expect(r.visibleEdges.map((e) => e.target)).toEqual(["A"]);
  });

  it("filters by status but never hides the root", () => {
    const r = computeVisible(
      [
        nsAttr("Root", { status: "archived" }),
        nsAttr("A", { status: "active" }),
        nsAttr("B", { status: "archived" }),
      ],
      [edge("Root", "A", "mention"), edge("Root", "B", "mention")],
      filters({ hiddenStatuses: ["archived"] }),
      "Root",
    );
    expect(r.visibleNodes.map((n) => n.node.ref).sort()).toEqual(["A", "Root"]);
  });

  it("filters by area (frontmatter or folder)", () => {
    const r = computeVisible(
      [ns("Root"), ns("Areas/A"), ns("Projects/B")],
      [
        edge("Root", "Areas/A", "mention"),
        edge("Root", "Projects/B", "mention"),
      ],
      filters({ hiddenAreas: ["Projects"] }),
      "Root",
    );
    expect(r.visibleNodes.map((n) => n.node.ref).sort()).toEqual([
      "Areas/A",
      "Root",
    ]);
  });
});
