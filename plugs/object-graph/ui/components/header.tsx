import { Button, Tabs } from "@silverbulletmd/silverbullet/ui";
import type { GraphEvent, GraphScope } from "../mediator/graph_mediator.ts";
import { ViewControls } from "./view_controls.tsx";

type Props = {
  ghostCount: number;
  hideEdgeLabels: boolean;
  hideOrphans: boolean;
  // Local-graph radius around the root page (0 = whole explored graph).
  hops: number;
  /** (BlackBullet) Around the page it was opened on, or the whole space. */
  scope: GraphScope;
  emit: (event: GraphEvent) => void;
};

export function Header({
  ghostCount,
  hideEdgeLabels,
  hideOrphans,
  hops,
  scope,
  emit,
}: Props) {
  return (
    <header class="gv-header">
      <h1 class="gv-header-title">Graph</h1>
      <Tabs
        class="gv-scope"
        label="What the graph shows"
        items={[
          {
            label: "This page",
            active: scope === "page",
            onSelect: () => emit({ type: "scope.switch", scope: "page" }),
          },
          {
            label: "Whole space",
            active: scope === "space",
            onSelect: () => emit({ type: "scope.switch", scope: "space" }),
          },
        ]}
      />
      <div class="gv-header-controls">
        <ViewControls
          ghostCount={ghostCount}
          hideEdgeLabels={hideEdgeLabels}
          hideOrphans={hideOrphans}
          hops={hops}
          emit={emit}
        />
      </div>
      <Button
        variant="icon"
        class="gv-close-button"
        title="Close · Esc"
        aria-label="Close"
        onClick={() => emit({ type: "panel.close" })}
      >
        ×
      </Button>
    </header>
  );
}
