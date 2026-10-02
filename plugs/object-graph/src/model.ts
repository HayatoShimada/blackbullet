// The relation `kind` is either a reserved structural value (`mention`,
// `co-mention`) or a user predicate (e.g. `spouse`). Mirrors `plugs/index/relation.ts`.
export const STRUCTURAL_KINDS = new Set(["mention", "co-mention"]);

export type ObjectKind = "page" | "item" | "block" | "url" | "file";

/**
 * A node in the explored graph. Carries enough data for the panel to render
 * the node, drive filters, and populate the right-panel object view.
 */
export type ObjectNode = {
  ref: string;
  kind: ObjectKind;
  title: string;
  // Single core tag (page/item/task/block); drives the Root-tags filter.
  rootTag: string | null;
  // First non-core tag; drives node color. null when none.
  primaryTag: string | null;
  // All non-core tags; drives the Tags filter.
  tags: string[];
  dangling: boolean;
  // pageDecoration.prefix passthrough (e.g. emoji prefix).
  prefix?: string;
  // Full indexed payload, rendered verbatim into the object view.
  attributes: Record<string, unknown>;
};

export type EdgeProvenance = {
  page: string;
  pos?: number;
  snippet?: string;
};

/**
 * One edge between two ObjectNodes. Parallel typed edges between the same
 * pair stay distinct. Co-mention pairs in opposite directions are collapsed
 * into one record with `undirected: true`.
 */
export type Edge = {
  source: string;
  target: string;
  label: string; // == kind
  kind: string;
  refs: EdgeProvenance[];
  undirected: boolean;
  // Cosine similarity of a `semantic` edge (from the memo sidecar).
  score?: number;
};

export type ExpansionResult = {
  object: ObjectNode;
  neighbors: ObjectNode[];
  edges: Edge[];
};

export type Filters = {
  hiddenTags: string[];
  hiddenLabels: string[];
  // When true, edge labels on the canvas are suppressed entirely.
  hideEdgeLabels: boolean;
  // When true, nodes with no visible incoming or outgoing relation in
  // the current filter set are hidden (except the root).
  hideOrphans: boolean;
  // Frontmatter `status` / area values to hide. Optional so filters
  // persisted before these existed keep loading.
  hiddenStatuses?: string[];
  hiddenAreas?: string[];
};

// Tunable force-simulation knobs exposed as sliders in the sidebar.
export type ForceSettings = {
  centerStrength: number;
  chargeStrength: number;
  linkDistance: number;
  linkStrength: number;
};

export const defaultForceSettings: ForceSettings = {
  centerStrength: 0.18,
  chargeStrength: -430,
  linkDistance: 223,
  linkStrength: 0.1,
};

export const defaultFilters: Filters = {
  hiddenTags: [],
  hiddenLabels: [],
  hideEdgeLabels: false,
  hideOrphans: true,
};

/**
 * Universe of filter options that exist in the whole space, regardless of
 * what the user has currently explored. Drives the sidebar's option lists
 * so checkboxes for not-yet-visible tags / labels remain togglable.
 * Counts in the sidebar still reflect the explored subgraph.
 */
export type GraphUniverse = {
  tags: string[];
  labels: string[];
  statuses: string[];
  areas: string[];
};

/**
 * Semantic-edge view settings, persisted across sessions. `threshold` and `k`
 * are applied client-side to the edges fetched once from the sidecar.
 */
export type SemanticSettings = {
  show: boolean;
  threshold: number;
  k: number;
  // Local-graph radius around the root page in hops; 0 = no limit.
  hops: number;
  // Set once settings have been through `migrateSemanticSettings`; saved
  // settings without it predate the 0.80 default.
  version?: number;
};

export const SEMANTIC_THRESHOLD_MIN = 0.6;
export const SEMANTIC_THRESHOLD_MAX = 0.95;
export const SEMANTIC_K_MAX = 10;
// One press of "more" / "fewer" moves the threshold by this much.
export const SEMANTIC_STEP = 0.04;

// multilingual-e5 cosines are compressed (most page pairs are >= 0.85), but a
// threshold near the top of the range left the graph without similar pages on
// first open. 0.80 with the three nearest pages per page shows the neighbours
// of the current page without anyone touching a control.
export const defaultSemanticSettings: SemanticSettings = {
  show: true,
  threshold: 0.8,
  k: 3,
  hops: 0,
};

// The default before 0.80. Settings saved while it was the default hold this
// value without the person ever having chosen it, so it reads as "unset".
export const LEGACY_SEMANTIC_THRESHOLD = 0.92;
export const SEMANTIC_SETTINGS_VERSION = 2;

/**
 * Merges saved settings over the defaults. Unversioned settings holding the
 * old default threshold are reset once; the result carries the version, so a
 * 0.92 chosen afterwards is saved with it and kept.
 */
export function migrateSemanticSettings(
  raw: Partial<SemanticSettings> | undefined,
): SemanticSettings {
  const merged = { ...defaultSemanticSettings, ...raw };
  if (
    raw &&
    raw.version === undefined &&
    raw.threshold === LEGACY_SEMANTIC_THRESHOLD
  ) {
    merged.threshold = defaultSemanticSettings.threshold;
  }
  merged.version = SEMANTIC_SETTINGS_VERSION;
  return merged;
}

export type RootViewModel = {
  root: ExpansionResult;
  universe: GraphUniverse;
  filters: Filters;
  forces: ForceSettings;
  semantic: SemanticSettings;
  /**
   * When true, the panel marks all of `root.neighbors` as already-expanded
   * (instead of the default ghost state). Used by the global view, which
   * ships every page at once and lets the user trim down rather than walk out.
   */
  initialAllExpanded?: boolean;
  /**
   * When false, the panel does not persist in-session filter changes back
   * to the datastore. Used by transient views like the global view so they
   * don't pollute the local-view filter preferences.
   */
  persistFilters?: boolean;
};
