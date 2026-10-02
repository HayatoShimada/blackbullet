import { Button } from "@silverbulletmd/silverbullet/ui";
import type { GraphEvent } from "../mediator/graph_mediator.ts";
import { ViewControls } from "./view_controls.tsx";

type Props = {
  ghostCount: number;
  hideEdgeLabels: boolean;
  hideOrphans: boolean;
  // Local-graph radius around the root page (0 = whole explored graph).
  hops: number;
  emit: (event: GraphEvent) => void;
};

export function Header({
  ghostCount,
  hideEdgeLabels,
  hideOrphans,
  hops,
  emit,
}: Props) {
  return (
    <header class="gv-header">
      <h1 class="gv-header-title">Graph</h1>
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
