import {
  type Edge,
  type ObjectNode,
  SEMANTIC_K_MAX,
  SEMANTIC_THRESHOLD_MIN,
  type SemanticSettings,
} from "./model.ts";

// Pure helpers for the memo-sidecar "semantic" edges and the local-graph hop
// filter. No syscalls here so everything is unit-testable.

export const SEMANTIC_KIND = "semantic";
export const NONE_KEY = "(none)";

/** One page pair as returned by the sidecar's /api/graph. */
export type SemanticEdgeRaw = { from: string; to: string; score: number };

export type SemanticGraphResult =
  | { status: "ok"; edges: SemanticEdgeRaw[] }
  // `unconfigured`: no `memoSidecar` config. `error`: unreachable / bad reply.
  | { status: "unconfigured" | "error"; message: string; edges: [] };

/**
 * Validate the /api/graph body, keeping only well-formed edges. Anything
 * unexpected yields an empty list rather than throwing: semantic edges are
 * an optional overlay and must never break the graph.
 */
export function parseGraphResponse(body: unknown): SemanticEdgeRaw[] {
  const raw = (body as { edges?: unknown } | null)?.edges;
  if (!Array.isArray(raw)) return [];
  const out: SemanticEdgeRaw[] = [];
  for (const e of raw) {
    if (
      e &&
      typeof e.from === "string" &&
      typeof e.to === "string" &&
      typeof e.score === "number" &&
      Number.isFinite(e.score)
    ) {
      out.push({ from: e.from, to: e.to, score: e.score });
    }
  }
  return out;
}

/**
 * Apply the threshold and per-page top-k to the raw sidecar edges. The pair is
 * unordered (A-B and B-A merge, keeping the higher score), and a pair is kept
 * when it is within the top `k` neighbours of EITHER endpoint, mirroring the
 * server's own k semantics so the slider can re-filter without a refetch.
 */
export function filterSemanticEdges(
  raw: SemanticEdgeRaw[],
  threshold: number,
  k: number,
): SemanticEdgeRaw[] {
  const pairs = new Map<string, SemanticEdgeRaw>();
  for (const e of raw) {
    if (e.from === e.to || e.score < threshold) continue;
    const [a, b] = e.from < e.to ? [e.from, e.to] : [e.to, e.from];
    const key = `${a}\x00${b}`;
    const prev = pairs.get(key);
    if (!prev || e.score > prev.score) {
      pairs.set(key, { from: a, to: b, score: e.score });
    }
  }
  const all = [...pairs.entries()];
  const byNode = new Map<string, [string, number][]>();
  for (const [key, e] of all) {
    for (const id of [e.from, e.to]) {
      let l = byNode.get(id);
      if (!l) byNode.set(id, (l = []));
      l.push([key, e.score]);
    }
  }
  const keep = new Set<string>();
  for (const l of byNode.values()) {
    // Ties break on the pair key so the result is deterministic.
    l.sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1));
    for (const [key] of l.slice(0, Math.max(0, k))) keep.add(key);
  }
  return all
    .filter(([key]) => keep.has(key))
    .map(([, e]) => e)
    .sort((x, y) => y.score - x.score);
}

/**
 * Semantic edges as graph `Edge`s. Never introduces nodes: pairs with an
 * endpoint outside `nodeRefs` are dropped.
 */
export function buildSemanticEdges(
  raw: SemanticEdgeRaw[],
  settings: Pick<SemanticSettings, "show" | "threshold" | "k">,
  nodeRefs: ReadonlySet<string>,
): Edge[] {
  if (!settings.show) return [];
  const threshold = Math.max(SEMANTIC_THRESHOLD_MIN, settings.threshold);
  const k = Math.min(SEMANTIC_K_MAX, settings.k);
  const present = raw.filter((e) => nodeRefs.has(e.from) && nodeRefs.has(e.to));
  return filterSemanticEdges(present, threshold, k).map((e) => ({
    source: e.from,
    target: e.to,
    label: SEMANTIC_KIND,
    kind: SEMANTIC_KIND,
    refs: [],
    undirected: true,
    score: e.score,
  }));
}

/**
 * Refs within `hops` edges of `root` (inclusive), walking edges in either
 * direction. `hops <= 0` means no limit and returns null.
 */
export function nodesWithinHops(
  edges: Pick<Edge, "source" | "target">[],
  root: string,
  hops: number,
): Set<string> | null {
  if (hops <= 0) return null;
  const adj = new Map<string, string[]>();
  const link = (a: string, b: string) => {
    const l = adj.get(a);
    if (l) l.push(b);
    else adj.set(a, [b]);
  };
  for (const e of edges) {
    link(e.source, e.target);
    link(e.target, e.source);
  }
  const seen = new Set([root]);
  let frontier = [root];
  for (let i = 0; i < hops && frontier.length > 0; i++) {
    const next: string[] = [];
    for (const r of frontier) {
      for (const n of adj.get(r) ?? []) {
        if (!seen.has(n)) {
          seen.add(n);
          next.push(n);
        }
      }
    }
    frontier = next;
  }
  return seen;
}

/**
 * Loads the explicit relations a local graph of radius `hops` needs. The root
 * is already expanded, so its 1-hop ring is known; to see N hops the nodes of
 * rings 1..N-1 must be expanded (that is what reveals ring N). Hence
 * `hops - 1` rounds that start from the root's neighbours, not from the root.
 */
export async function expandLocalRings<
  R extends { neighbors: { ref: string }[] },
>(
  rootRef: string,
  rootNeighborRefs: string[],
  hops: number,
  fetchExpansion: (ref: string) => Promise<R>,
  apply: (results: R[]) => void,
  isCancelled: () => boolean = () => false,
): Promise<void> {
  const seen = new Set([rootRef]);
  let frontier: string[] = [];
  for (const ref of rootNeighborRefs) {
    if (!seen.has(ref)) {
      seen.add(ref);
      frontier.push(ref);
    }
  }
  for (let i = 0; i < hops - 1 && frontier.length > 0; i++) {
    const results = await Promise.all(frontier.map(fetchExpansion));
    if (isCancelled()) return;
    apply(results);
    frontier = [];
    for (const r of results) {
      for (const n of r.neighbors) {
        if (!seen.has(n.ref)) {
          seen.add(n.ref);
          frontier.push(n.ref);
        }
      }
    }
  }
}

function asStrings(v: unknown): string[] {
  const list = Array.isArray(v) ? v : [v];
  return list
    .filter((x) => typeof x === "string" || typeof x === "number")
    .map((x) => String(x).trim())
    .filter((x) => x !== "");
}

/** Frontmatter `status` of a node, or "(none)". */
export function nodeStatus(n: Pick<ObjectNode, "attributes">): string {
  return asStrings(n.attributes.status)[0] ?? NONE_KEY;
}

/**
 * Areas of a node: frontmatter `area` (string or list), falling back to the
 * top-level folder of the page name (PARA-style spaces: Areas/, Projects/…).
 */
export function nodeAreas(
  n: Pick<ObjectNode, "attributes" | "kind" | "ref">,
): string[] {
  const fm = asStrings(n.attributes.area);
  if (fm.length > 0) return fm;
  if (n.kind === "page" && n.ref.includes("/")) return [n.ref.split("/")[0]];
  return [NONE_KEY];
}
