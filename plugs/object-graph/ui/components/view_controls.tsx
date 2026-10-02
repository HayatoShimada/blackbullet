// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada

import { Button, Checkbox, Select } from "@silverbulletmd/silverbullet/ui";
import type { GraphEvent } from "../mediator/graph_mediator.ts";

type Props = {
  ghostCount: number;
  hideEdgeLabels: boolean;
  hideOrphans: boolean;
  // Local-graph radius around the root page (0 = whole explored graph).
  hops: number;
  emit: (event: GraphEvent) => void;
};

/**
 * What changes the shape of the graph rather than which pages it holds: the
 * radius, the labels, orphans, expand and focus. A passive view of the
 * Mediator's state: it draws the props and emits what was chosen. The header
 * shows it on a wide panel and the filters sheet on a phone (CSS picks one;
 * the other is `display: none`, so it is not in the accessibility tree).
 */
export function ViewControls({
  ghostCount,
  hideEdgeLabels,
  hideOrphans,
  hops,
  emit,
}: Props) {
  return (
    <div class="gv-view-controls">
      <label
        class="gv-control"
        title="Limit the graph to the current page and the pages within N links"
      >
        <span>Hops</span>
        <Select
          class="gv-hops-select"
          aria-label="Hops"
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
        </Select>
      </label>
      <label
        class="gv-control"
        title="Hide the words on the lines between pages"
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
        <span>Hide labels</span>
      </label>
      <label
        class="gv-control"
        title="Hide pages that have no visible connection"
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
        <span>Hide orphans</span>
      </label>
      <Button
        title="Expand all"
        disabled={ghostCount === 0}
        onClick={() => emit({ type: "expandAll.request" })}
      >
        Expand all
      </Button>
      <Button
        title="Focus on current page"
        onClick={() => emit({ type: "focus.request" })}
      >
        Focus
      </Button>
    </div>
  );
}
