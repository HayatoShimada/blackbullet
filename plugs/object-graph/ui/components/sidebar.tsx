import { Checkbox, Input } from "@silverbulletmd/silverbullet/ui";
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
  // The selected node as text, once the Mediator has had it rendered.
  objectText: string;
  emit: (event: GraphEvent) => void;
};

const LONG_LIST_THRESHOLD = 10;
const MAX_VISIBLE = 50;

type Counted = { key: string; count: number };

export function Sidebar(props: Props) {
  return (
    <aside class="gv-sidebar">
      <SemanticSection {...props} />
      <TagsSection {...props} />
      <FrontmatterSection
        title="Status"
        keys={props.universe.statuses}
        valuesOf={(n) => [nodeStatus(n)]}
        hidden={props.filters.hiddenStatuses ?? []}
        onHiddenChange={(hiddenStatuses) =>
          props.emit({ type: "filters.patch", patch: { hiddenStatuses } })
        }
        allNodes={props.allNodes}
      />
      <FrontmatterSection
        title="Area"
        keys={props.universe.areas}
        valuesOf={nodeAreas}
        hidden={props.filters.hiddenAreas ?? []}
        onHiddenChange={(hiddenAreas) =>
          props.emit({ type: "filters.patch", patch: { hiddenAreas } })
        }
        allNodes={props.allNodes}
      />
      <LabelsSection {...props} />
      <ForcesSection forces={props.forces} emit={props.emit} />
      <ObjectSection
        selected={props.selected}
        text={props.objectText}
        emit={props.emit}
      />
    </aside>
  );
}

function SemanticSection({
  semantic,
  semanticResult,
  semanticCount,
  emit,
}: Props) {
  const [open, setOpen] = useState(true);
  const update = (patch: Partial<SemanticSettings>) =>
    emit({ type: "semantic.patch", patch });
  const ok = semanticResult?.status === "ok";
  return (
    <div class="gv-section">
      <header class="gv-section-header" onClick={() => setOpen(!open)}>
        <span class="gv-section-title">
          <span class={`gv-twisty ${open ? "open" : "closed"}`}>▸</span>
          Semantic edges
        </span>
        <span class="gv-section-actions" onClick={(e) => e.stopPropagation()}>
          <a
            onClick={() =>
              // Everything but the hop radius, which lives in the header.
              update({
                show: defaultSemanticSettings.show,
                threshold: defaultSemanticSettings.threshold,
                k: defaultSemanticSettings.k,
              })
            }
          >
            reset
          </a>
        </span>
      </header>
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
            <span class="gv-semantic-swatch" />
            Show similar pages
            {ok && <span class="gv-count">{semanticCount}</span>}
          </label>
          {semanticResult === null && (
            <div class="gv-semantic-note">Loading from sidecar…</div>
          )}
          {semanticResult && !ok && (
            <div class="gv-semantic-note">{semanticResult.message}</div>
          )}
          {ok && (
            <>
              <label class="gv-force-row">
                <div class="gv-force-label">
                  <span>Similarity ≥</span>
                  <span class="gv-force-value">
                    {semantic.threshold.toFixed(2)}
                  </span>
                </div>
                <input
                  type="range"
                  min={SEMANTIC_THRESHOLD_MIN}
                  max={SEMANTIC_THRESHOLD_MAX}
                  step={0.01}
                  value={semantic.threshold}
                  disabled={!semantic.show}
                  onInput={(e) =>
                    update({
                      threshold: Number((e.target as HTMLInputElement).value),
                    })
                  }
                />
              </label>
              <label class="gv-force-row">
                <div class="gv-force-label">
                  <span>Neighbors per page (k)</span>
                  <span class="gv-force-value">{semantic.k}</span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={SEMANTIC_K_MAX}
                  step={1}
                  value={semantic.k}
                  disabled={!semantic.show}
                  onInput={(e) =>
                    update({ k: Number((e.target as HTMLInputElement).value) })
                  }
                />
              </label>
            </>
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
      <header class="gv-section-header" onClick={() => setOpen(!open)}>
        <span class="gv-section-title">
          <span class={`gv-twisty ${open ? "open" : "closed"}`}>▸</span>
          Forces
        </span>
        <span class="gv-section-actions" onClick={(e) => e.stopPropagation()}>
          <a onClick={() => update(defaultForceSettings)}>reset</a>
        </span>
      </header>
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
      <header class="gv-section-header" onClick={() => setOpen(!open)}>
        <span class="gv-section-title">
          <span class={`gv-twisty ${open ? "open" : "closed"}`}>▸</span>
          {title}
        </span>
        <span class="gv-section-actions" onClick={(e) => e.stopPropagation()}>
          <a onClick={onAll}>all</a>
          {" · "}
          <a onClick={onNone}>none</a>
        </span>
      </header>
      {open && (
        <div class="gv-section-body">
          {rows.length > LONG_LIST_THRESHOLD && (
            <Input
              type="text"
              class="gv-section-search"
              placeholder="Filter…"
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
            <a class="gv-more" onClick={() => setShowAll(true)}>
              show {overflow} more
            </a>
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
