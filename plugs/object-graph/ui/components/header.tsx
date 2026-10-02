import { Button, Checkbox } from "@silverbulletmd/silverbullet/ui";
import type { GraphEvent } from "../mediator/graph_mediator.ts";

type Props = {
  ghostCount: number;
  hideEdgeLabels: boolean;
  hideOrphans: boolean;
  // Local-graph radius around the root page (0 = whole explored graph).
  hops: number;
  // Small note shown when the semantic overlay is unavailable.
  semanticNotice: string | null;
  emit: (event: GraphEvent) => void;
};

export function Header({
  ghostCount,
  hideEdgeLabels,
  hideOrphans,
  hops,
  semanticNotice,
  emit,
}: Props) {
  return (
    <header class="gv-header">
      <h1 class="gv-header-title">Object Graph</h1>
      <div class="gv-header-actions">
        {semanticNotice && (
          <span class="gv-header-notice" title={semanticNotice}>
            {semanticNotice}
          </span>
        )}
        <label
          class="gv-header-toggle"
          title="Limit the graph to the root page and the pages within N hops"
        >
          Hops
          <select
            class="gv-hops-select"
            value={hops}
            onChange={(e) =>
              emit({
                type: "semantic.patch",
                patch: {
                  hops: Number((e.currentTarget as HTMLSelectElement).value),
                },
              })
            }
          >
            <option value={0}>All</option>
            <option value={1}>1</option>
            <option value={2}>2</option>
            <option value={3}>3</option>
          </select>
        </label>
        <label
          class="gv-header-toggle"
          title="Suppress edge labels on the canvas"
        >
          <Checkbox
            checked={hideEdgeLabels}
            onChange={(e) =>
              emit({
                type: "filters.patch",
                patch: {
                  hideEdgeLabels: (e.currentTarget as HTMLInputElement).checked,
                },
              })
            }
          />
          Hide labels
        </label>
        <label
          class="gv-header-toggle"
          title="Hide nodes with no visible incoming or outgoing relation"
        >
          <Checkbox
            checked={hideOrphans}
            onChange={(e) =>
              emit({
                type: "filters.patch",
                patch: {
                  hideOrphans: (e.currentTarget as HTMLInputElement).checked,
                },
              })
            }
          />
          Hide orphans
        </label>
        <Button
          title="Follow every enabled relation outward until no ghosts remain"
          disabled={ghostCount === 0}
          onClick={() => emit({ type: "expandAll.request" })}
        >
          Expand all
        </Button>
        <Button
          title="Reset view to the selected object and its direct relations"
          onClick={() => emit({ type: "focus.request" })}
        >
          Focus
        </Button>
        <Button
          variant="icon"
          class="gv-close-button"
          title="Close (Esc)"
          onClick={() => emit({ type: "panel.close" })}
        >
          ×
        </Button>
      </div>
    </header>
  );
}
