import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { ObjectNode } from "../../src/model.ts";
import {
  type GraphEvent,
  type GraphState,
  selectView,
} from "../mediator/graph_mediator.ts";
import { GraphCanvas } from "./graph_canvas.tsx";
import { Header } from "./header.tsx";
import { Sidebar } from "./sidebar.tsx";

/**
 * The panel's root view. It owns no graph state: everything it draws comes
 * from the Mediator's `state`, and everything a user does goes back as an
 * event. (The sidebar's width is the one thing it keeps: a layout detail.)
 */
export function App({
  state,
  emit,
}: {
  state: GraphState;
  emit: (event: GraphEvent) => void;
}) {
  const [sidebarWidth, setSidebarWidth] = useState<number>(230);

  // What is painted, derived from the explored graph and the settings that
  // shape it. Not from `forces`, `selectedRef`, ...: moving a slider must not
  // re-derive the whole graph.
  const view = useMemo(
    () => selectView(state),
    [
      state.nodes,
      state.edges,
      state.filters,
      state.semantic,
      state.semanticResult,
      state.rootRef,
    ],
  );

  // Stable arrays for the sidebar's tally inputs (they change only when the
  // graph does; fresh identities per render would re-tally everything).
  const allObjectNodes = useMemo(
    () => [...state.nodes.values()].map((ns) => ns.node),
    [state.nodes],
  );
  const visibleObjectNodes = useMemo(
    () => view.visibleNodes.map((ns) => ns.node),
    [view.visibleNodes],
  );

  const selected: ObjectNode | null = state.selectedRef
    ? (state.nodes.get(state.selectedRef)?.node ?? null)
    : null;

  return (
    <div class="gv-app">
      <Header
        ghostCount={view.ghostCount}
        hideEdgeLabels={state.filters.hideEdgeLabels}
        hideOrphans={state.filters.hideOrphans}
        hops={state.semantic.hops}
        semanticNotice={view.semanticNotice}
        emit={emit}
      />
      <div
        class="gv-body"
        style={{ "--gv-sidebar-width": `${sidebarWidth}px` }}
      >
        <Sidebar
          nodes={visibleObjectNodes}
          edges={view.visibleEdges}
          allNodes={allObjectNodes}
          allEdges={view.allEdges}
          semantic={state.semantic}
          semanticResult={state.semanticResult}
          semanticCount={view.semanticEdges.length}
          universe={state.universe}
          filters={state.filters}
          forces={state.forces}
          selected={selected}
          objectText={
            state.objectText?.ref === state.selectedRef
              ? state.objectText.text
              : ""
          }
          emit={emit}
        />
        <SidebarResizer width={sidebarWidth} onResize={setSidebarWidth} />
        <GraphCanvas
          nodes={view.visibleNodes}
          edges={view.visibleEdges}
          selectedRef={state.selectedRef}
          hideEdgeLabels={state.filters.hideEdgeLabels}
          forces={state.forces}
          emit={emit}
        />
      </div>
    </div>
  );
}

const MIN_SIDEBAR_WIDTH = 160;
const MAX_SIDEBAR_WIDTH = 600;

function SidebarResizer({
  width,
  onResize,
}: {
  width: number;
  onResize: (w: number) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const startRef = useRef<{ x: number; w: number } | null>(null);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      const start = startRef.current;
      if (!start) return;
      const next = Math.min(
        MAX_SIDEBAR_WIDTH,
        Math.max(MIN_SIDEBAR_WIDTH, start.w + (e.clientX - start.x)),
      );
      onResize(next);
    };
    const onUp = () => setDragging(false);
    globalThis.addEventListener("mousemove", onMove);
    globalThis.addEventListener("mouseup", onUp);
    return () => {
      globalThis.removeEventListener("mousemove", onMove);
      globalThis.removeEventListener("mouseup", onUp);
    };
  }, [dragging, onResize]);

  return (
    <div
      class={`gv-resizer${dragging ? " dragging" : ""}`}
      onMouseDown={(e) => {
        startRef.current = { x: e.clientX, w: width };
        setDragging(true);
        e.preventDefault();
      }}
    />
  );
}
