import { Button, Checkbox, Input } from "@silverbulletmd/silverbullet/ui";
import { useMemo, useState } from "preact/hooks";
import {
  defaultForceSettings,
  defaultSemanticSettings,
  type Edge,
  type Filters,
  type ForceSettings,
  type GraphUniverse,
  type ObjectNode,
  SEMANTIC_K_MAX,
  SEMANTIC_STEP,
  SEMANTIC_THRESHOLD_MAX,
  SEMANTIC_THRESHOLD_MIN,
  type SemanticSettings,
} from "../../src/model.ts";
import {
  nodeAreas,
  nodeStatus,
  type SemanticGraphResult,
} from "../../src/semantic.ts";
import { colorForTag } from "../colors.ts";
import type { GraphEvent } from "../mediator/graph_mediator.ts";
import { NodeList } from "./node_list.tsx";
import { ViewControls } from "./view_controls.tsx";

type Props = {
  // Currently-visible nodes (used to compute counts for present-only filter UX).
  nodes: ObjectNode[];
  edges: Edge[];
  // Full set; used so the filter list still shows recently-hidden entries.
  allNodes: ObjectNode[];
  allEdges: Edge[];
  // Full option lists derived from the entire space.
  universe: GraphUniverse;
  filters: Filters;
  forces: ForceSettings;
  semantic: SemanticSettings;
  // null while the sidecar request is in flight.
  semanticResult: SemanticGraphResult | null;
  // Semantic edges currently drawn (after threshold / k / node presence).
  semanticCount: number;
  // Selected node; rendered as an object-detail section below the filters.
  selected: ObjectNode | null;
  // Pages "Hide orphans" keeps off the canvas, and the shape-of-graph
  // controls the phone's sheet carries instead of the header.
  hiddenOrphans: number;
  // Pages the Tags / Status / Area filters keep off the canvas.
  hiddenByFilters: number;
  ghostCount: number;
  // The phone's filters sheet: pulled up or put away.
  sheetOpen: boolean;
  // The selected node as text, once the Mediator has had it rendered.
  objectText: string;
  emit: (event: GraphEvent) => void;
};

const LONG_LIST_THRESHOLD = 10;
const MAX_VISIBLE = 50;

type Counted = { key: string; count: number };

export function Sidebar(props: Props) {
  const { sheetOpen, emit } = props;
  return (
    // On a phone this is a bottom sheet (CSS); on a wide panel a side column.
    <aside
      class={`gv-sidebar gv-sheet${sheetOpen ? " gv-sheet-open" : ""}`}
      aria-label="Filters"
    >
      <button
        type="button"
        class="gv-sheet-handle"
        aria-expanded={sheetOpen}
        aria-controls="gv-sheet-body"
        onClick={() => emit({ type: "sheet.set", open: !sheetOpen })}
      >
        <span class="gv-sheet-grip" aria-hidden="true" />
        <span class="gv-sheet-title">Filters</span>
        <span class="gv-sheet-summary">
          {props.nodes.length} {props.nodes.length === 1 ? "page" : "pages"}
          {props.hiddenByFilters + props.hiddenOrphans > 0 &&
            ` · ${props.hiddenByFilters + props.hiddenOrphans} hidden`}
        </span>
      </button>
      <div class="gv-sheet-body" id="gv-sheet-body">
        <div class="gv-sheet-actions">
          <ViewControls
            ghostCount={props.ghostCount}
            hideEdgeLabels={props.filters.hideEdgeLabels}
            hideOrphans={props.filters.hideOrphans}
            hops={props.semantic.hops}
            emit={emit}
          />
        </div>
        <HiddenByFilters
          count={props.hiddenByFilters}
          onShow={() =>
            emit({
              type: "filters.patch",
              patch: { hiddenTags: [], hiddenStatuses: [], hiddenAreas: [] },
            })
          }
        />
        <HiddenOrphans
          count={props.hiddenOrphans}
          onShow={() =>
            emit({ type: "filters.patch", patch: { hideOrphans: false } })
          }
        />
        <SimilarSection {...props} />
        <LegendSection />
        <TagsSection {...props} />
        <FrontmatterSection
          title="Status"
          keys={props.universe.statuses}
          valuesOf={(n) => [nodeStatus(n)]}
          hidden={props.filters.hiddenStatuses ?? []}
          onHiddenChange={(hiddenStatuses) =>
            emit({ type: "filters.patch", patch: { hiddenStatuses } })
          }
          allNodes={props.allNodes}
        />
        <FrontmatterSection
          title="Area"
          keys={props.universe.areas}
          valuesOf={nodeAreas}
          hidden={props.filters.hiddenAreas ?? []}
          onHiddenChange={(hiddenAreas) =>
            emit({ type: "filters.patch", patch: { hiddenAreas } })
          }
          allNodes={props.allNodes}
        />
        <LabelsSection {...props} />
        <ForcesSection forces={props.forces} emit={emit} />
        <NodesSection
          nodes={props.nodes}
          selectedRef={props.selected?.ref ?? null}
          emit={emit}
        />
        <ObjectSection
          selected={props.selected}
          text={props.objectText}
          emit={emit}
        />
      </div>
    </aside>
  );
}

// The line that says the Tags / Status / Area filters are hiding pages, with
// the way back.
function HiddenByFilters({
  count,
  onShow,
}: {
  count: number;
  onShow: () => void;
}) {
  if (count <= 0) return null;
  return (
    <div class="gv-hidden-line" role="status">
      <span>{count} hidden by filters</span>
      <button type="button" class="gv-more gv-link-button" onClick={onShow}>
        Show all
      </button>
    </div>
  );
}

// The line that says what "Hide orphans" is doing, with the way back.
function HiddenOrphans({
  count,
  onShow,
}: {
  count: number;
  onShow: () => void;
}) {
  if (count <= 0) return null;
  return (
    <div class="gv-hidden-line" role="status">
      <span>
        {count} {count === 1 ? "page" : "pages"} hidden (no connections)
      </span>
      <button type="button" class="gv-more gv-link-button" onClick={onShow}>
        Show
      </button>
    </div>
  );
}

function NodesSection({
  nodes,
  selectedRef,
  emit,
}: {
  nodes: ObjectNode[];
  selectedRef: string | null;
  emit: (event: GraphEvent) => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div class="gv-section">
      <SectionHeader
        title={`Nodes · ${nodes.length}`}
        open={open}
        onToggle={() => setOpen(!open)}
      />
      {open && (
        <div class="gv-section-body">
          <NodeList nodes={nodes} selectedRef={selectedRef} emit={emit} />
        </div>
      )}
    </div>
  );
}

function LegendSection() {
  const [open, setOpen] = useState(true);
  return (
    <div class="gv-section">
      <SectionHeader
        title="Legend"
        open={open}
        onToggle={() => setOpen(!open)}
      />
      {open && (
        <ul class="gv-section-body gv-legend">
          <li class="gv-legend-row">
            <span class="gv-legend-line gv-legend-link" aria-hidden="true" />
            Link
          </li>
          <li class="gv-legend-row">
            <span class="gv-legend-line gv-legend-mention" aria-hidden="true" />
            Mention
          </li>
          <li class="gv-legend-row">
            <span class="gv-legend-line gv-legend-similar" aria-hidden="true" />
            Similar page
          </li>
        </ul>
      )}
    </div>
  );
}

/** A section's title row: a button, so the keyboard folds it like a click does. */
function SectionHeader({
  title,
  open,
  onToggle,
  actions,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  actions?: preact.ComponentChildren;
}) {
  return (
    <header class="gv-section-header">
      <button
        type="button"
        class="gv-section-toggle"
        aria-expanded={open}
        onClick={onToggle}
      >
        <span
          class={`gv-twisty ${open ? "open" : "closed"}`}
          aria-hidden="true"
        >
          ▸
        </span>
        {title}
      </button>
      {actions && <span class="gv-section-actions">{actions}</span>}
    </header>
  );
}

/** One press of "more" moves the threshold down a step and lets one more
 * neighbour per page in; "fewer" is the way back. */
function stepSimilar(
  semantic: SemanticSettings,
  direction: 1 | -1,
): Partial<SemanticSettings> {
  const threshold = Math.round(
    Math.min(
      SEMANTIC_THRESHOLD_MAX,
      Math.max(
        SEMANTIC_THRESHOLD_MIN,
        semantic.threshold - direction * SEMANTIC_STEP,
      ),
    ) * 100,
  );
  return {
    threshold: threshold / 100,
    k: Math.min(SEMANTIC_K_MAX, Math.max(1, semantic.k + direction)),
  };
}

function SimilarSection({
  semantic,
  semanticResult,
  semanticCount,
  emit,
}: Props) {
  const [open, setOpen] = useState(true);
  const update = (patch: Partial<SemanticSettings>) =>
    emit({ type: "semantic.patch", patch });
  const ok = semanticResult?.status === "ok";
  const canMore =
    semantic.threshold > SEMANTIC_THRESHOLD_MIN + 1e-9 ||
    semantic.k < SEMANTIC_K_MAX;
  const canFewer =
    semantic.threshold < SEMANTIC_THRESHOLD_MAX - 1e-9 || semantic.k > 1;
  return (
    <div class="gv-section">
      <SectionHeader
        title="Similar pages"
        open={open}
        onToggle={() => setOpen(!open)}
        actions={
          <button
            type="button"
            class="gv-link-button"
            onClick={() =>
              // Everything but the hop radius, which lives with the view controls.
              update({
                show: defaultSemanticSettings.show,
                threshold: defaultSemanticSettings.threshold,
                k: defaultSemanticSettings.k,
              })
            }
          >
            reset
          </button>
        }
      />
      {open && (
        <div class="gv-section-body gv-forces-body">
          <label class="gv-row">
            <Checkbox
              checked={semantic.show}
              disabled={!ok}
              onChange={(e) =>
                update({ show: (e.currentTarget as HTMLInputElement).checked })
              }
            />
            <span class="gv-semantic-swatch" aria-hidden="true" />
            Show similar pages
            {ok && <span class="gv-count">{semanticCount}</span>}
          </label>
          {semanticResult === null && (
            <div class="gv-semantic-note">Loading…</div>
          )}
          {semanticResult?.status === "unconfigured" && (
            <div class="gv-semantic-note" role="status">
              <span class="gv-note-icon" aria-hidden="true">
                ⓘ
              </span>
              Similar pages need Search by meaning
            </div>
          )}
          {semanticResult?.status === "error" && (
            <div class="gv-semantic-note" role="status">
              <span class="gv-note-icon" aria-hidden="true">
                ⓘ
              </span>
              {semanticResult.message}
            </div>
          )}
          {ok && (
            <div class="gv-more-fewer" role="group" aria-label="Similar pages">
              <Button
                disabled={!semantic.show || !canFewer}
                title="Fewer similar pages"
                onClick={() => update(stepSimilar(semantic, -1))}
              >
                Fewer
              </Button>
              <Button
                disabled={!semantic.show || !canMore}
                title="More similar pages"
                onClick={() => update(stepSimilar(semantic, 1))}
              >
                More
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ForcesSection({
  forces,
  emit,
}: {
  forces: ForceSettings;
  emit: (event: GraphEvent) => void;
}) {
  const [open, setOpen] = useState(false);
  const update = (patch: Partial<ForceSettings>) =>
    emit({ type: "forces.patch", patch });
  const sliders: {
    label: string;
    key: keyof ForceSettings;
    min: number;
    max: number;
    step: number;
  }[] = [
    {
      label: "Center pull",
      key: "centerStrength",
      min: 0,
      max: 0.3,
      step: 0.005,
    },
    {
      label: "Repulsion",
      key: "chargeStrength",
      min: -800,
      max: 0,
      step: 10,
    },
    { label: "Link distance", key: "linkDistance", min: 10, max: 600, step: 1 },
    {
      label: "Link strength",
      key: "linkStrength",
      min: 0.01,
      max: 1,
      step: 0.01,
    },
  ];
  return (
    <div class="gv-section">
      <SectionHeader
        title="Forces"
        open={open}
        onToggle={() => setOpen(!open)}
        actions={
          <button
            type="button"
            class="gv-link-button"
            onClick={() => update(defaultForceSettings)}
          >
            reset
          </button>
        }
      />
      {open && (
        <div class="gv-section-body gv-forces-body">
          {sliders.map((s) => (
            <label class="gv-force-row" key={s.key}>
              <div class="gv-force-label">
                <span>{s.label}</span>
                <span class="gv-force-value">
                  {forces[s.key].toFixed(s.step < 0.1 ? 3 : 0)}
                </span>
              </div>
              <input
                type="range"
                min={s.min}
                max={s.max}
                step={s.step}
                value={forces[s.key]}
                onInput={(e) =>
                  update({
                    [s.key]: Number((e.target as HTMLInputElement).value),
                  })
                }
              />
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

function ObjectSection({
  selected,
  text,
  emit,
}: {
  selected: ObjectNode | null;
  text: string;
  emit: (event: GraphEvent) => void;
}) {
  if (!selected) return null;
  const swatch = colorForTag(selected.primaryTag);

  return (
    <div class="gv-object-section">
      <header class="gv-object-header">
        <a
          class="gv-object-title gv-object-title-link"
          title={`Open ${selected.title}`}
          onClick={() => emit({ type: "object.open", ref: selected.ref })}
        >
          <span class="gv-swatch" style={{ background: swatch }} />
          {selected.title}
        </a>
      </header>
      <pre class="gv-object-body">{text}</pre>
    </div>
  );
}

function Section({
  title,
  rows,
  hidden,
  onToggle,
  onAll,
  onNone,
  renderRow,
}: {
  title: string;
  rows: Counted[];
  hidden: string[];
  onToggle: (key: string) => void;
  onAll: () => void;
  onNone: () => void;
  renderRow: (r: Counted) => preact.ComponentChildren;
}) {
  const [open, setOpen] = useState(true);
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const filtered = query
    ? rows.filter((r) => r.key.toLowerCase().includes(query.toLowerCase()))
    : rows;
  const display = showAll ? filtered : filtered.slice(0, MAX_VISIBLE);
  const overflow = filtered.length - display.length;

  return (
    <div class="gv-section">
      <SectionHeader
        title={title}
        open={open}
        onToggle={() => setOpen(!open)}
        actions={
          <>
            <button type="button" class="gv-link-button" onClick={onAll}>
              all
            </button>
            {" · "}
            <button type="button" class="gv-link-button" onClick={onNone}>
              none
            </button>
          </>
        }
      />
      {open && (
        <div class="gv-section-body">
          {rows.length > LONG_LIST_THRESHOLD && (
            <Input
              type="text"
              class="gv-section-search"
              placeholder="Filter…"
              aria-label={`Filter ${title}`}
              value={query}
              onInput={(e) =>
                setQuery((e.currentTarget as HTMLInputElement).value)
              }
            />
          )}
          {display.map((r) => (
            <label class="gv-row" key={r.key}>
              <Checkbox
                checked={!hidden.includes(r.key)}
                onChange={() => onToggle(r.key)}
              />
              {renderRow(r)}
              <span class="gv-count">{r.count}</span>
            </label>
          ))}
          {overflow > 0 && (
            <button
              type="button"
              class="gv-more gv-link-button"
              onClick={() => setShowAll(true)}
            >
              show {overflow} more
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Build a `Counted[]` whose key set is exactly `keys`, with counts pulled
 * from the explored-graph tally (defaulting to 0). Sorted: present-in-graph
 * entries first (by count desc), then absent entries alphabetically.
 */
function universeRows(keys: string[], counts: Map<string, number>): Counted[] {
  const rows: Counted[] = keys.map((key) => ({
    key,
    count: counts.get(key) ?? 0,
  }));
  rows.sort((a, b) => {
    if (a.count !== b.count) return b.count - a.count;
    return a.key.localeCompare(b.key);
  });
  return rows;
}

function TagsSection({ allNodes, universe, filters, emit }: Props) {
  const rows = useMemo(() => {
    const counts = new Map<string, number>();
    for (const n of allNodes) {
      if (n.tags.length === 0) {
        counts.set("(untagged)", (counts.get("(untagged)") ?? 0) + 1);
        continue;
      }
      for (const t of n.tags) {
        counts.set(t, (counts.get(t) ?? 0) + 1);
      }
    }
    // "(untagged)" is always presented at the bottom of the universe list
    // — it's a bucket, not a real tag.
    return universeRows([...universe.tags, "(untagged)"], counts);
  }, [allNodes, universe.tags]);
  const hide = (hiddenTags: string[]) =>
    emit({ type: "filters.patch", patch: { hiddenTags } });
  const toggle = (key: string) =>
    hide(
      filters.hiddenTags.includes(key)
        ? filters.hiddenTags.filter((x) => x !== key)
        : [...filters.hiddenTags, key],
    );
  return (
    <Section
      title="Tags"
      rows={rows}
      hidden={filters.hiddenTags}
      onToggle={toggle}
      onAll={() => hide([])}
      onNone={() => hide(rows.map((r) => r.key))}
      renderRow={(r) => (
        <span class="gv-tag-row">
          <span
            class="gv-swatch"
            style={{
              background: colorForTag(r.key === "(untagged)" ? null : r.key),
            }}
          />
          {r.key}
        </span>
      )}
    />
  );
}

function LabelsSection({ allEdges, universe, filters, emit }: Props) {
  const rows = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of allEdges)
      counts.set(e.label, (counts.get(e.label) ?? 0) + 1);
    return universeRows(universe.labels, counts);
  }, [allEdges, universe.labels]);
  const hide = (hiddenLabels: string[]) =>
    emit({ type: "filters.patch", patch: { hiddenLabels } });
  const toggle = (key: string) =>
    hide(
      filters.hiddenLabels.includes(key)
        ? filters.hiddenLabels.filter((x) => x !== key)
        : [...filters.hiddenLabels, key],
    );
  return (
    <Section
      title="Kind"
      rows={rows}
      hidden={filters.hiddenLabels}
      onToggle={toggle}
      onAll={() => hide([])}
      onNone={() => hide(rows.map((r) => r.key))}
      renderRow={(r) => <span>{r.key}</span>}
    />
  );
}

/**
 * Checkbox filter over a frontmatter-derived value (status, area). The option
 * list comes from the whole space; counts reflect the explored graph.
 */
function FrontmatterSection({
  title,
  keys,
  valuesOf,
  hidden,
  onHiddenChange,
  allNodes,
}: {
  title: string;
  keys: string[];
  valuesOf: (n: ObjectNode) => string[];
  hidden: string[];
  onHiddenChange: (hidden: string[]) => void;
  allNodes: ObjectNode[];
}) {
  const rows = useMemo(() => {
    const counts = new Map<string, number>();
    for (const n of allNodes) {
      for (const v of valuesOf(n)) counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    return universeRows(keys, counts);
  }, [allNodes, keys, valuesOf]);
  // Nothing to filter on (e.g. no status frontmatter anywhere).
  if (rows.length <= 1) return null;
  return (
    <Section
      title={title}
      rows={rows}
      hidden={hidden}
      onToggle={(key) =>
        onHiddenChange(
          hidden.includes(key)
            ? hidden.filter((x) => x !== key)
            : [...hidden, key],
        )
      }
      onAll={() => onHiddenChange([])}
      onNone={() => onHiddenChange(rows.map((r) => r.key))}
      renderRow={(r) => <span>{r.key}</span>}
    />
  );
}
