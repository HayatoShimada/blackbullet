import * as d3 from "d3-force";
import ForceGraphImpl from "force-graph";
import { Component } from "preact";
import { Button } from "@silverbulletmd/silverbullet/ui";
import type { Edge, ForceSettings, ObjectNode } from "../../src/model.ts";
import { STRUCTURAL_KINDS } from "../../src/model.ts";
import { SEMANTIC_KIND } from "../../src/semantic.ts";
import { type CanvasTheme, readCanvasTheme } from "../canvas_theme.ts";
import { fitCamera, MAX_AUTO_ZOOM, MIN_AUTO_ZOOM } from "../camera_fit.ts";
import { colorForTag } from "../colors.ts";
import type { GraphEvent } from "../mediator/graph_mediator.ts";

const CLICK_DELAY_MS = 220;
// Fit after simulation settles to avoid framing an incomplete layout.
// A from-scratch layout needs more settling than an incremental expansion.
const FIRST_FIT_COOLDOWN_TICKS = 140;
const REFIT_COOLDOWN_TICKS = 60;

// Where the camera frames the current page: the band under the canvas is kept
// clear for the controls (and, on the phone, the filters sheet), and nothing
// is framed closer to an edge than FIT_PADDING.
const SAFE_BOTTOM = 64;
const FIT_PADDING = 48;
// A label under the lowest node, in screen pixels.
const LABEL_ROOM = 20;
// How far above the middle (screen pixels) a lone page is framed when the
// canvas shows a note under it; the note starts just below the middle.
const EMPTY_NOTE_LIFT = 64;
// Ticks the force simulation runs before the first paint when motion is
// reduced: enough to settle, so the graph appears at rest.
const SETTLE_TICKS = 300;
// How long an idle canvas stays awake when motion is reduced (see wake()).
const IDLE_PAUSE_MS = 400;

type NodeStatus = "expanded" | "ghost";

type Props = {
  nodes: { node: ObjectNode; status: NodeStatus }[];
  edges: Edge[];
  selectedRef: string | null;
  hideEdgeLabels: boolean;
  forces: ForceSettings;
  /** Set when the page has nothing to draw but itself: the canvas says why. */
  empty: { hidden: number } | null;
  emit: (event: GraphEvent) => void;
};

type FGNode = {
  id: string;
  node: ObjectNode;
  status: NodeStatus;
  kind: ObjectNode["kind"];
  dangling: boolean;
  title: string;
  prefix?: string;
  degree: number;
  color: string;
  x?: number;
  y?: number;
  // Pin coordinates set on drag. Kept as `number` (never null) so FGNode
  // satisfies both force-graph's `NodeObject` and d3's `SimulationNodeDatum`.
  fx?: number;
  fy?: number;
};

// Panel-side merged edge — collapses parallel edges between the same pair
// of nodes (regardless of direction) into one record. `bidirectional` is
// set when at least one of the merged inputs ran the reverse direction.
type MergedEdge = Edge & { bidirectional: boolean };

type FGLink = {
  source: string | FGNode;
  target: string | FGNode;
  edge: MergedEdge;
};

// force-graph 1.51 ships class-style typings (`new ForceGraph(el)`), but the
// runtime default export is still the Kapsule factory invoked as
// `ForceGraph()(element)`. Bridge the two: keep the chainable instance type
// (parameterized with our own node/link shapes so the accessor callbacks
// below type-check) while treating the import as the runtime factory.
type ForceGraphInstance = ForceGraphImpl<FGNode, FGLink>;
const ForceGraph = ForceGraphImpl as unknown as () => (
  element: HTMLElement,
) => ForceGraphInstance;

type State = {
  edgeHover: { edge: MergedEdge; x: number; y: number } | null;
  ghostHover: { title: string; x: number; y: number } | null;
};

type ComputedGraph = {
  nodes: FGNode[];
  links: FGLink[];
  adjacency: Map<string, Set<string>>;
  radii: Map<string, number>;
};

function getId(end: string | FGNode): string {
  return typeof end === "string" ? end : end.id;
}

function nodeRadius(degree: number): number {
  // Modest growth with degree. Hubs go a bit larger but stay readable.
  return 6 + Math.min(degree, 10) * 0.5;
}

// Strip directory prefix; show just the last path segment for graph labels.
function displayName(title: string): string {
  const i = title.lastIndexOf("/");
  return i === -1 ? title : title.slice(i + 1);
}

// What an edge kind is called to a person (product design §1).
function displayLabel(label: string): string {
  return label === SEMANTIC_KIND ? "similar" : label;
}

// Label visibility thresholds expressed in zoom (graph→screen) scale.
const NODE_LABEL_MIN_SCALE = 0.4;
const EDGE_LABEL_MIN_SCALE = 1.8;

function computeGraph(
  inputNodes: Props["nodes"],
  edges: Edge[],
): ComputedGraph {
  const degree = new Map<string, number>();
  const adj = new Map<string, Set<string>>();
  for (const ns of inputNodes) {
    degree.set(ns.node.ref, 0);
    adj.set(ns.node.ref, new Set());
  }
  for (const e of edges) {
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
    adj.get(e.source)?.add(e.target);
    adj.get(e.target)?.add(e.source);
  }
  const fgNodes: FGNode[] = inputNodes.map(({ node, status }) => ({
    id: node.ref,
    node,
    status,
    kind: node.kind,
    dangling: node.dangling,
    title: node.title,
    prefix: node.prefix,
    degree: degree.get(node.ref) ?? 0,
    color: colorForTag(node.primaryTag),
  }));
  // Merge all edges between the same pair of nodes (unordered) into a
  // single visual edge with a comma-joined label, combined provenance,
  // and a `bidirectional` flag when both directions were present.
  type Accum = MergedEdge & { labels: Set<string> };
  const merged = new Map<string, Accum>();
  for (const e of edges) {
    const [a, b] =
      e.source < e.target ? [e.source, e.target] : [e.target, e.source];
    const key = `${a}\x00${b}`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, {
        ...e,
        refs: [...e.refs],
        labels: new Set([e.label]),
        bidirectional: false,
      });
      continue;
    }
    existing.labels.add(e.label);
    existing.refs.push(...e.refs);
    if (e.kind === SEMANTIC_KIND) {
      // A semantic overlay never changes how an explicit edge is drawn.
      existing.score = e.score;
      continue;
    }
    if (existing.kind === SEMANTIC_KIND) {
      // First seen was the semantic overlay: take the explicit edge's identity.
      existing.source = e.source;
      existing.target = e.target;
      existing.undirected = e.undirected;
      existing.kind = e.kind;
      existing.bidirectional = false;
      continue;
    }
    if (e.undirected) existing.undirected = true;
    if (e.source !== existing.source) existing.bidirectional = true;
    // Non-mention kinds beat `mention` for styling purposes.
    if (existing.kind === "mention" && e.kind !== "mention") {
      existing.kind = e.kind;
    }
  }
  const fgLinks: FGLink[] = [...merged.values()].map((acc) => {
    const { labels, ...edge } = acc;
    edge.label = [...labels].map(displayLabel).join(", ");
    return { source: edge.source, target: edge.target, edge };
  });
  const rmap = new Map<string, number>();
  for (const n of fgNodes) rmap.set(n.id, nodeRadius(n.degree));
  return {
    nodes: fgNodes,
    links: fgLinks,
    adjacency: adj,
    radii: rmap,
  };
}

export class GraphCanvas extends Component<Props, State> {
  state: State = { edgeHover: null, ghostHover: null };

  // DOM + force-graph handles.
  private containerRef: HTMLDivElement | null = null;
  private fg: ForceGraphInstance | null = null;

  // Hover/adjacency state read by draw callbacks every frame.
  private hoveredId: string | null = null;
  private neighbors: Set<string> = new Set();
  private adjacency: Map<string, Set<string>> = new Map();
  private theme: CanvasTheme = readCanvasTheme();
  private radiusMap: Map<string, number> = new Map();

  // Mouse position relative to the canvas container; drives the edge tooltip.
  private mousePos: { x: number; y: number } = { x: 0, y: 0 };

  // Click-cancel timers for distinguishing single vs. double click.
  private clickTimer: number | null = null;
  private edgeClickTimer: number | null = null;

  // Whether we've fed data once already. Both the first feed and later ones
  // (expansions/collapses) arm `pendingFit` and auto-fit once the simulation
  // settles (see onEngineStop); only the cooldown budget differs.
  private fedOnce = false;

  // Set when a data-driven feed wants the camera re-fitted after the
  // simulation next settles. Gated so node drags (which also re-heat and
  // fire onEngineStop) don't trigger camera jumps.
  private pendingFit = false;

  // Cached computation of nodes/links/adjacency/radii; recomputed in
  // componentDidUpdate when props.nodes or props.edges identity changes.
  private computed: ComputedGraph;

  // Listeners/observers we own and must tear down.
  private resizeObserver: ResizeObserver | null = null;
  private mql: MediaQueryList | null = null;
  private themeObserver: MutationObserver | null = null;
  private themeTimer: number | null = null;

  // Reduced motion: the layout is settled before it is painted, the camera
  // jumps instead of gliding, and the render loop sleeps when nothing moves.
  private motionQuery: MediaQueryList | null = null;
  private reduceMotion = false;
  private idleTimer: number | null = null;
  // The layout engine is ticking (a feed, a force change or a drag started it;
  // onEngineStop ends it): the loop must not sleep through that.
  private engineRunning = false;

  // Whether the person has moved the camera since it was last framed. While
  // they have not, a change of the canvas's size (the phone's sheet opening, a
  // window resized, the sidebar dragged) frames the graph again.
  private cameraTouched = false;
  private refitTimer: number | null = null;

  constructor(props: Props) {
    super(props);
    this.computed = computeGraph(props.nodes, props.edges);
    // Bind handlers used as listener references / bare JSX onClicks so
    // `this` resolves correctly and identities stay stable across
    // add/removeEventListener pairs.
    this.onMouseMove = this.onMouseMove.bind(this);
    this.onThemeChange = this.onThemeChange.bind(this);
    this.onMotionChange = this.onMotionChange.bind(this);
    this.wake = this.wake.bind(this);
    this.markTouched = this.markTouched.bind(this);
    this.onKeyDown = this.onKeyDown.bind(this);
    this.zoomIn = this.zoomIn.bind(this);
    this.zoomOut = this.zoomOut.bind(this);
    this.pan = this.pan.bind(this);
    this.recenter = this.recenter.bind(this);
  }

  private onMouseMove(ev: MouseEvent) {
    if (!this.containerRef) return;
    const rect = this.containerRef.getBoundingClientRect();
    this.mousePos = {
      x: ev.clientX - rect.left,
      y: ev.clientY - rect.top,
    };
  }

  private onThemeChange() {
    this.theme = readCanvasTheme();
    this.rerender();
  }

  private awaitTheme(attempt = 0) {
    if (this.theme.ready || attempt > 100) return;
    this.themeTimer = window.setTimeout(() => {
      this.themeTimer = null;
      this.theme = readCanvasTheme();
      if (this.theme.ready) this.rerender();
      else this.awaitTheme(attempt + 1);
    }, 50);
  }

  private onMotionChange() {
    this.reduceMotion = this.motionQuery?.matches ?? false;
    if (!this.reduceMotion) this.wakeFully();
  }

  // Milliseconds for a camera move: none when motion is reduced.
  private ms(ms: number): number {
    return this.reduceMotion ? 0 : ms;
  }

  // With reduced motion the render loop is parked once everything has settled
  // (a loop that paints identical frames is motion a person asked not to
  // have, and it costs battery). Anything that can change the picture wakes it.
  private wake() {
    const fg = this.fg;
    if (!fg || !this.reduceMotion) return;
    fg.resumeAnimation();
    if (this.idleTimer !== null) clearTimeout(this.idleTimer);
    this.idleTimer = window.setTimeout(() => {
      this.idleTimer = null;
      if (this.reduceMotion && !this.engineRunning) {
        this.fg?.pauseAnimation();
      }
    }, IDLE_PAUSE_MS);
  }

  private markTouched() {
    this.cameraTouched = true;
  }

  private wakeFully() {
    if (this.idleTimer !== null) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    this.fg?.resumeAnimation();
  }

  private onKeyDown(e: KeyboardEvent) {
    const tgt = e.target as HTMLElement | null;
    // A text field, a select or the node list keeps its own arrow keys.
    if (
      tgt &&
      (tgt.tagName === "INPUT" ||
        tgt.tagName === "TEXTAREA" ||
        tgt.tagName === "SELECT" ||
        tgt.isContentEditable ||
        tgt.closest?.('[role="listbox"]'))
    )
      return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    switch (e.key) {
      case "ArrowUp":
        this.pan(0, -1);
        break;
      case "ArrowDown":
        this.pan(0, 1);
        break;
      case "ArrowLeft":
        this.pan(-1, 0);
        break;
      case "ArrowRight":
        this.pan(1, 0);
        break;
      case "PageUp":
      case "+":
      case "=":
        this.zoomIn();
        break;
      case "PageDown":
      case "-":
      case "_":
        this.zoomOut();
        break;
      case "f":
      case "F":
        this.recenter();
        break;
      default:
        return;
    }
    e.preventDefault();
  }

  // Configure the link force's strength + distance accessors. The link
  // set itself is owned by force-graph (rebound from graphData on every
  // update), so we only set the per-link knobs. Multi-edge pairs get a
  // proportionally stronger spring for Obsidian-style cluster pull.
  private configureLinkForce() {
    const fg = this.fg;
    if (!fg) return;
    const f = this.props.forces;
    const linkForce = fg.d3Force("link") as d3.ForceLink<FGNode, FGLink> | null;
    if (!linkForce) return;
    // Semantic-only pairs have no provenance refs; give them a weak pull.
    const mult = (l: FGLink) =>
      l.edge.kind === SEMANTIC_KIND ? 0.5 : Math.min(l.edge.refs.length, 6);
    linkForce.strength((l: FGLink) => f.linkStrength * mult(l));
    linkForce.distance(f.linkDistance);
  }

  private applyForces() {
    const fg = this.fg;
    if (!fg) return;
    const f = this.props.forces;
    const centerStrength = (n: FGNode) =>
      n.degree === 0 ? f.centerStrength * 6 : f.centerStrength;
    (fg.d3Force("x") as d3.ForceX<FGNode> | null)?.strength(centerStrength);
    (fg.d3Force("y") as d3.ForceY<FGNode> | null)?.strength(centerStrength);
    (fg.d3Force("charge") as d3.ForceManyBody<FGNode> | null)?.strength(
      f.chargeStrength,
    );
    this.configureLinkForce();
    if (this.reduceMotion) {
      // Settle the new force field before painting rather than animating to
      // it: feeding the same data again runs the warm-up ticks synchronously.
      fg.warmupTicks(SETTLE_TICKS).cooldownTicks(0);
      fg.graphData(fg.graphData());
    } else {
      // Re-heat softly so the new force field has a chance to settle.
      fg.d3ReheatSimulation();
    }
    this.engineRunning = true;
    this.wake();
  }

  componentDidMount() {
    if (!this.containerRef) return;
    // The shared stylesheet is a <link> and may still be loading (a canvas that
    // reads its colours and font too early paints in the browser's defaults):
    // read again, and keep reading until the tokens are there.
    this.theme = readCanvasTheme();
    this.awaitTheme();
    const fg = ForceGraph()(this.containerRef);
    this.fg = fg;

    fg.backgroundColor("transparent")
      .nodeId("id")
      .nodeCanvasObjectMode(() => "replace")
      .nodeCanvasObject(
        (node: FGNode, ctx: CanvasRenderingContext2D, scale: number) =>
          this.drawNode(node, ctx, scale),
      )
      .nodePointerAreaPaint(
        (node: FGNode, color: string, ctx: CanvasRenderingContext2D) => {
          ctx.fillStyle = color;
          ctx.beginPath();
          const r = (this.radiusMap.get(node.id) ?? 12) + 4;
          ctx.arc(node.x ?? 0, node.y ?? 0, r, 0, 2 * Math.PI);
          ctx.fill();
        },
      )
      .linkCanvasObjectMode(() => "replace")
      .linkCanvasObject(
        (link: FGLink, ctx: CanvasRenderingContext2D, scale: number) =>
          this.drawLink(link, ctx, scale),
      )
      .onNodeHover((node: FGNode | null) => {
        const id = node?.id ?? null;
        this.hoveredId = id;
        this.neighbors = id ? (this.adjacency.get(id) ?? new Set()) : new Set();
        if (node && node.status === "ghost") {
          this.setState({
            ghostHover: {
              title: node.title,
              x: this.mousePos.x,
              y: this.mousePos.y,
            },
          });
        } else if (this.state.ghostHover) {
          this.setState({ ghostHover: null });
        }
        this.rerender();
      })
      .onNodeClick((node: FGNode) => this.handleNodeClick(node))
      .onLinkHover((link: FGLink | null) => {
        if (!link) {
          this.setState({ edgeHover: null });
          return;
        }
        this.setState({
          edgeHover: {
            edge: link.edge,
            x: this.mousePos.x,
            y: this.mousePos.y,
          },
        });
      })
      .onLinkClick((link: FGLink) => this.handleLinkClick(link))
      .onNodeDrag((node: FGNode) => {
        this.engineRunning = true;
        // Pin node where it's dragged.
        node.fx = node.x;
        node.fy = node.y;
      })
      .onNodeDragEnd((node: FGNode) => {
        node.fx = node.x;
        node.fy = node.y;
      })
      .onEngineStop(() => {
        this.engineRunning = false;
        this.wake(); // (re)arms the idle pause now that the layout is at rest
        // After a data-driven feed re-heats the simulation and it settles,
        // re-fit the camera so newly added/removed nodes stay in view.
        // Gated by pendingFit so drag-induced settles don't move the camera.
        if (this.pendingFit) {
          this.pendingFit = false;
          this.recenter();
        }
      });

    const f = this.props.forces;
    // Center pull, degree-aware: isolated nodes (degree 0) get a much
    // stronger pull so they don't drift off into the void; well-connected
    // nodes use the slider's base strength so clusters can still spread.
    const centerStrength = (n: FGNode) =>
      n.degree === 0 ? f.centerStrength * 6 : f.centerStrength;
    fg.d3Force("x", d3.forceX<FGNode>(0).strength(centerStrength));
    fg.d3Force("y", d3.forceY<FGNode>(0).strength(centerStrength));
    // Generous collide padding so node labels (rendered below each node)
    // have room to breathe and don't overlap with neighbors.
    fg.d3Force(
      "collide",
      d3
        .forceCollide<FGNode>((n) => (this.radiusMap.get(n.id) ?? 12) + 16)
        .strength(0.85),
    );
    (fg.d3Force("charge") as d3.ForceManyBody<any> | null)?.strength(
      f.chargeStrength,
    );
    // Force-graph maintains the link force itself: its `update()` runs
    // after each graphData change and rebinds the link set from the
    // merged links we pass in. We only override the per-link strength
    // accessor (Obsidian-style cluster pull: pairs joined by multiple
    // relations get a proportionally stronger spring) and the rest
    // length, plus the radial center pull above.
    this.configureLinkForce();

    let lastW = 0;
    let lastH = 0;
    const resize = () => {
      if (!this.containerRef) return;
      const w = this.containerRef.clientWidth;
      const h = this.containerRef.clientHeight;
      fg.width(w);
      fg.height(h);
      const changed = Math.abs(w - lastW) > 1 || Math.abs(h - lastH) > 1;
      const first = lastW === 0 && lastH === 0;
      lastW = w;
      lastH = h;
      if (!changed || first || this.cameraTouched) return;
      // Settle first: a resize arrives as a stream of sizes.
      if (this.refitTimer !== null) clearTimeout(this.refitTimer);
      this.refitTimer = window.setTimeout(() => {
        this.refitTimer = null;
        if (!this.cameraTouched && !this.pendingFit) this.recenter();
      }, 120);
    };
    resize();
    this.resizeObserver = new ResizeObserver(resize);
    this.resizeObserver.observe(this.containerRef);

    this.containerRef.addEventListener("mousemove", this.onMouseMove);

    this.mql = window.matchMedia("(prefers-color-scheme: dark)");
    this.mql.addEventListener?.("change", this.onThemeChange);
    // The host may switch the explicit theme (data-theme) without the system
    // preference changing.
    this.themeObserver = new MutationObserver(this.onThemeChange);
    this.themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "class"],
    });

    this.motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    this.reduceMotion = this.motionQuery.matches;
    this.motionQuery.addEventListener?.("change", this.onMotionChange);
    for (const type of ["pointerdown", "pointermove", "wheel", "touchstart"]) {
      this.containerRef.addEventListener(type, this.wake, { passive: true });
    }
    for (const type of ["pointerdown", "wheel"]) {
      this.containerRef.addEventListener(type, this.markTouched, {
        passive: true,
      });
    }

    window.addEventListener("keydown", this.onKeyDown);

    // Initial data feed.
    this.feedData();
  }

  componentDidUpdate(prevProps: Props) {
    // Recompute derived graph data if either input identity changed.
    const inputsChanged =
      prevProps.nodes !== this.props.nodes ||
      prevProps.edges !== this.props.edges;
    if (inputsChanged) {
      this.computed = computeGraph(this.props.nodes, this.props.edges);
      this.feedData();
    }

    if (prevProps.hideEdgeLabels !== this.props.hideEdgeLabels) {
      // Edge-label visibility flipped: force a repaint via no-op accessor swap.
      const fg = this.fg;
      if (fg) fg.linkCanvasObject(fg.linkCanvasObject());
      this.wake();
    }

    if (prevProps.selectedRef !== this.props.selectedRef) {
      // Selected-node ring change: force a repaint.
      const fg = this.fg;
      if (fg) fg.nodeCanvasObject(fg.nodeCanvasObject());
      this.wake();
    }

    if (prevProps.forces !== this.props.forces) {
      this.applyForces();
    }
  }

  componentWillUnmount() {
    this.cancelClickTimer();
    this.cancelEdgeClickTimer();
    if (this.containerRef) {
      this.containerRef.removeEventListener("mousemove", this.onMouseMove);
    }
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.mql?.removeEventListener?.("change", this.onThemeChange);
    this.mql = null;
    if (this.themeTimer !== null) clearTimeout(this.themeTimer);
    this.themeObserver?.disconnect();
    this.themeObserver = null;
    this.motionQuery?.removeEventListener?.("change", this.onMotionChange);
    this.motionQuery = null;
    if (this.idleTimer !== null) clearTimeout(this.idleTimer);
    if (this.refitTimer !== null) clearTimeout(this.refitTimer);
    if (this.containerRef) {
      for (const type of [
        "pointerdown",
        "pointermove",
        "wheel",
        "touchstart",
      ]) {
        this.containerRef.removeEventListener(type, this.wake);
      }
      for (const type of ["pointerdown", "wheel"]) {
        this.containerRef.removeEventListener(type, this.markTouched);
      }
    }
    window.removeEventListener("keydown", this.onKeyDown);
    if (this.fg) {
      this.fg.pauseAnimation();
      (this.fg as any)._destructor?.();
    }
    if (this.containerRef) this.containerRef.innerHTML = "";
    this.fg = null;
  }

  private rerender() {
    // No-op accessor swap forces force-graph to repaint immediately.
    const fg = this.fg;
    if (!fg) return;
    fg.nodeCanvasObject(fg.nodeCanvasObject());
    this.wake();
  }

  // Feed nodes/links into force-graph, preserving positions and softly
  // re-heating the simulation. The first feed auto-fits the camera after a
  // short delay; later feeds re-fit once the simulation settles.
  private feedData() {
    const fg = this.fg;
    if (!fg) return;
    const { nodes, links, adjacency, radii } = this.computed;
    this.adjacency = adjacency;
    this.radiusMap = radii;

    // Carry over positions from the previous data so existing nodes stay put
    // and new ghosts emerge from the position of an already-placed neighbor
    // (rather than dropping in from random coordinates).
    const prev = fg.graphData().nodes as FGNode[];
    const prevById = new Map<string, FGNode>();
    for (const p of prev) prevById.set(p.id, p);

    for (const n of nodes) {
      const old = prevById.get(n.id);
      if (old) {
        // Existing node — preserve its current physics state.
        n.x = old.x;
        n.y = old.y;
        n.fx = old.fx;
        n.fy = old.fy;
        continue;
      }
      // New node — start at an already-placed connected neighbor.
      const neighbors = adjacency.get(n.id);
      if (!neighbors) continue;
      for (const nbId of neighbors) {
        const placed = prevById.get(nbId);
        if (placed && placed.x !== undefined && placed.y !== undefined) {
          // Tiny jitter avoids stacking new ghosts perfectly on top of each other.
          n.x = placed.x + (Math.random() - 0.5) * 2;
          n.y = placed.y + (Math.random() - 0.5) * 2;
          break;
        }
      }
    }

    fg.graphData({ nodes, links });
    // Re-apply our link-force tuning. force-graph's update() runs after
    // graphData and rebinds the link set from the merged links, but
    // doesn't touch strength/distance accessors. Re-set them now so the
    // per-link multiplicity factor still applies after the rebind.
    this.configureLinkForce();
    this.hoveredId = null;
    this.neighbors = new Set();

    // Auto-fit the camera once the simulation cools (onEngineStop →
    // recenter), never on a fixed timer — fitting mid-layout leaves nodes
    // half off-screen. Bound the run with cooldownTicks so the first
    // from-scratch layout settles in a few hundred ms instead of the
    // engine's multi-second default. recenter() handles the single-node and
    // MAX_AUTO_ZOOM cases.
    this.pendingFit = true;
    if (this.reduceMotion) {
      // Settle before the first paint: the engine runs its ticks now, stops
      // after the next one, and onEngineStop frames the camera.
      fg.warmupTicks(SETTLE_TICKS).cooldownTicks(0);
    } else {
      fg.warmupTicks(0).cooldownTicks(
        this.fedOnce ? REFIT_COOLDOWN_TICKS : FIRST_FIT_COOLDOWN_TICKS,
      );
    }
    this.fedOnce = true;
    this.engineRunning = true;
    this.wake();
  }

  private cancelClickTimer() {
    if (this.clickTimer !== null) {
      clearTimeout(this.clickTimer);
      this.clickTimer = null;
    }
  }

  private handleNodeClick(node: FGNode) {
    if (this.clickTimer !== null) {
      // Second click within window → treat as double-click.
      this.cancelClickTimer();
      this.handleDoubleClick(node);
      return;
    }
    this.clickTimer = window.setTimeout(() => {
      this.clickTimer = null;
      this.props.emit({ type: "node.click", ref: node.id });
    }, CLICK_DELAY_MS);
  }

  private cancelEdgeClickTimer() {
    if (this.edgeClickTimer !== null) {
      clearTimeout(this.edgeClickTimer);
      this.edgeClickTimer = null;
    }
  }

  private handleLinkClick(link: FGLink) {
    if (this.edgeClickTimer !== null) {
      this.cancelEdgeClickTimer();
      this.handleLinkDoubleClick(link);
      return;
    }
    this.edgeClickTimer = window.setTimeout(() => {
      this.edgeClickTimer = null;
      // Single click on an edge: no-op for now (no edge selection model).
    }, CLICK_DELAY_MS);
  }

  private handleLinkDoubleClick(link: FGLink) {
    const prov = link.edge.refs[0];
    if (!prov) return;
    this.props.emit({ type: "edge.open", page: prov.page, pos: prov.pos });
  }

  private handleDoubleClick(node: FGNode) {
    this.props.emit({ type: "node.open", ref: node.id, kind: node.kind });
  }

  private isHighlighted(id: string): boolean {
    const hov = this.hoveredId;
    if (!hov) return true;
    return id === hov || this.neighbors.has(id);
  }

  private linkTouchesHover(link: FGLink): boolean {
    const hov = this.hoveredId;
    if (!hov) return false;
    return getId(link.source) === hov || getId(link.target) === hov;
  }

  private drawNode(node: FGNode, ctx: CanvasRenderingContext2D, scale: number) {
    const t = this.theme;
    const radius = this.radiusMap.get(node.id) ?? nodeRadius(node.degree);
    const x = node.x ?? 0;
    const y = node.y ?? 0;
    const highlighted = this.isHighlighted(node.id);
    const isSelected = node.id === this.props.selectedRef;
    const ghost = node.status === "ghost";

    ctx.save();
    // Ghosts and nodes dimmed by a hover are fainter than the rest but never
    // so faint that their outline or label is lost (labels paint at full
    // opacity below).
    // Only the fill is faint: the outline of a ghost or a missing page stays
    // at full strength so the mark itself keeps 3:1 against the page.
    const hoverFade = highlighted ? 1 : 0.4;
    const fillAlpha = (ghost ? 0.55 : 1) * hoverFade;
    ctx.globalAlpha = fillAlpha;

    if (node.dangling) {
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fillStyle = t.bg;
      ctx.fill();
      ctx.globalAlpha = hoverFade;
      ctx.setLineDash([3 / scale, 2 / scale]);
      ctx.lineWidth = 1.5 / scale;
      ctx.strokeStyle = t.nodeDim;
      ctx.stroke();
      ctx.setLineDash([]);
    } else {
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      // The fill is a theme colour per tag, resolved from the stylesheet, so
      // an untagged node is grey in both schemes (a var() would be ignored).
      const hue = t.resolve(node.color) || t.link;
      ctx.fillStyle = hue;
      ctx.fill();
      if (ghost) {
        // A translucent fill inside a full-strength ring of the same hue.
        ctx.globalAlpha = hoverFade;
        ctx.lineWidth = 1.5 / scale;
        ctx.strokeStyle = hue;
      } else {
        // A 1px outline in the page colour keeps every node legible against
        // its neighbours and the edges that cross it.
        ctx.lineWidth = 1 / scale;
        ctx.strokeStyle = t.nodeStroke;
      }
      ctx.stroke();
    }

    if (isSelected) {
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(x, y, radius + 2 / scale, 0, Math.PI * 2);
      ctx.lineWidth = 2 / scale;
      ctx.strokeStyle = t.accent;
      ctx.stroke();
    }

    // Label rendered BELOW the node, scaled to constant screen pixels.
    // Hide when zoomed way out OR when this node is dimmed by hover.
    // The current page is always named, however far out the camera is.
    const showLabel =
      (isSelected || scale >= NODE_LABEL_MIN_SCALE) &&
      (highlighted || this.hoveredId === null);
    if (showLabel) {
      ctx.globalAlpha = 1;
      const fontPx = isSelected ? 13 : 12;
      const fontSize = fontPx / scale;
      ctx.font = `${isSelected ? "600 " : ""}${fontSize}px ${t.font}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      const name = displayName(node.title);
      const label = node.prefix ? `${node.prefix}${name}` : name;
      const gap = 4 / scale;
      // A halo in the page colour keeps the label readable over edges.
      ctx.lineJoin = "round";
      ctx.lineWidth = 3 / scale;
      ctx.strokeStyle = t.bg;
      ctx.strokeText(label, x, y + radius + gap);
      ctx.fillStyle = node.dangling ? t.nodeDim : ghost ? t.labelDim : t.label;
      ctx.fillText(label, x, y + radius + gap);
    }
    ctx.restore();
  }

  private drawLink(link: FGLink, ctx: CanvasRenderingContext2D, scale: number) {
    const t = this.theme;
    const source = link.source as FGNode;
    const target = link.target as FGNode;
    if (
      typeof source !== "object" ||
      typeof target !== "object" ||
      source.x === undefined ||
      target.x === undefined
    )
      return;

    const sx = source.x!;
    const sy = source.y!;
    const tx = target.x!;
    const ty = target.y!;
    const dx = tx - sx;
    const dy = ty - sy;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const sR = this.radiusMap.get(source.id) ?? 12;
    const tR = this.radiusMap.get(target.id) ?? 12;
    const ax = sx + sR * ux;
    const ay = sy + sR * uy;
    const bx = tx - tR * ux;
    const by = ty - tR * uy;

    // Three kinds, three strokes (the sidebar's legend shows the same):
    // a link is solid, a mention dotted, a similar page dashed.
    const kind: string = link.edge.kind;
    const similar = kind === SEMANTIC_KIND;
    const mention = STRUCTURAL_KINDS.has(kind);
    const hov = this.hoveredId;
    const touches = this.linkTouchesHover(link);

    let strokeStyle = similar
      ? t.linkSimilar
      : mention
        ? t.linkMention
        : t.link;
    if (hov) strokeStyle = touches ? t.linkHot : t.linkDim;

    ctx.save();
    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth = (touches ? 2 : 1.25) / scale;
    ctx.lineCap = mention ? "round" : "butt";
    if (similar) ctx.setLineDash([4 / scale, 3 / scale]);
    else if (mention) ctx.setLineDash([0.01 / scale, 3 / scale]);
    else ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineCap = "butt";

    // Arrowheads — skip on undirected co-mention collapses.
    if (!link.edge.undirected) {
      const headLen = 7 / scale;
      const drawHead = (hx: number, hy: number, angle: number) => {
        ctx.beginPath();
        ctx.moveTo(hx, hy);
        ctx.lineTo(
          hx - headLen * Math.cos(angle - Math.PI / 6),
          hy - headLen * Math.sin(angle - Math.PI / 6),
        );
        ctx.lineTo(
          hx - headLen * Math.cos(angle + Math.PI / 6),
          hy - headLen * Math.sin(angle + Math.PI / 6),
        );
        ctx.closePath();
        ctx.fillStyle = strokeStyle;
        ctx.fill();
      };
      // Target-end arrow.
      drawHead(bx, by, Math.atan2(uy, ux));
      // Source-end arrow when both directions exist between this pair.
      if (link.edge.bidirectional) drawHead(ax, ay, Math.atan2(-uy, -ux));
    }

    // Rotated edge label riding above the midpoint.
    // Suppressed entirely when the global "hide labels" toggle is on,
    // unless the edge is incident to the hovered node.
    const label = link.edge.label;
    const labelsAllowed = !this.props.hideEdgeLabels || touches;
    const showLabel =
      label && labelsAllowed && (touches || scale >= EDGE_LABEL_MIN_SCALE);
    if (showLabel) {
      const mx = (ax + bx) / 2;
      const my = (ay + by) / 2;
      let angle = Math.atan2(by - ay, bx - ax);
      if (angle > Math.PI / 2) angle -= Math.PI;
      if (angle < -Math.PI / 2) angle += Math.PI;
      ctx.translate(mx, my);
      ctx.rotate(angle);
      const fontSize = 12 / scale;
      ctx.font = `${fontSize}px ${t.font}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.lineJoin = "round";
      ctx.lineWidth = 3 / scale;
      ctx.strokeStyle = t.bg;
      ctx.strokeText(label, 0, -2 / scale);
      ctx.fillStyle = mention || similar ? t.labelDim : t.label;
      ctx.fillText(label, 0, -2 / scale);
    }
    ctx.restore();
  }

  private zoomIn() {
    const fg = this.fg;
    if (!fg) return;
    this.wake();
    this.cameraTouched = true;
    fg.zoom(fg.zoom() * 1.4, this.ms(250));
  }

  private zoomOut() {
    const fg = this.fg;
    if (!fg) return;
    this.wake();
    this.cameraTouched = true;
    fg.zoom(fg.zoom() / 1.4, this.ms(250));
  }

  // dx/dy in {-1, 0, 1} — step scales inversely with zoom so the visual
  // pan distance stays constant.
  private pan(dx: number, dy: number) {
    const fg = this.fg;
    if (!fg) return;
    this.wake();
    this.cameraTouched = true;
    const step = 80 / fg.zoom();
    const c = fg.centerAt();
    if (!c) return;
    fg.centerAt(c.x + dx * step, c.y + dy * step, this.ms(250));
  }

  // Frame the graph: every node and its label inside the canvas, as close as
  // fits, in the part of it the controls do not cover; then, if the current
  // page still lands under a control, lift the camera until it clears it.
  private recenter() {
    const fg = this.fg;
    if (!fg) return;
    this.wake();
    this.cameraTouched = false;
    const nodes = this.computed.nodes;
    if (nodes.length <= 1) {
      // A lone page is framed above the middle when the canvas has a note to
      // show (it sits just under the middle), so the two never overlap.
      const lone = nodes[0];
      const lx = lone?.x ?? 0;
      const ly = lone?.y ?? 0;
      const lift = this.props.empty ? EMPTY_NOTE_LIFT / 2 : 0;
      fg.centerAt(lx, ly + lift, this.ms(400));
      fg.zoom(MAX_AUTO_ZOOM, this.ms(400));
      return;
    }
    const w = this.containerRef?.clientWidth ?? 0;
    const h = this.containerRef?.clientHeight ?? 0;
    const placed = nodes.filter(
      (n) => n.x !== undefined && n.y !== undefined,
    ) as (FGNode & { x: number; y: number })[];
    if (placed.length === 0 || !w || !h) {
      // Nothing to measure: centre on what is placed and keep the zoom inside
      // the auto-zoom range. (zoomToFit would leave the camera mid-animation,
      // so a zoom read right after it is stale.)
      const cx = placed.length
        ? placed.reduce((a, n) => a + n.x, 0) / placed.length
        : 0;
      const cy = placed.length
        ? placed.reduce((a, n) => a + n.y, 0) / placed.length
        : 0;
      fg.centerAt(cx, cy, this.ms(400));
      fg.zoom(
        Math.min(MAX_AUTO_ZOOM, Math.max(MIN_AUTO_ZOOM, fg.zoom())),
        this.ms(400),
      );
      return;
    }
    // Where the controls are, in canvas pixels (the pad and the zoom stack
    // sit in the bottom corners, 16px in).
    const box = this.containerRef?.getBoundingClientRect();
    const controls: {
      left: number;
      top: number;
      right: number;
      bottom: number;
    }[] = [];
    for (const el of this.containerRef?.parentElement?.querySelectorAll<HTMLElement>(
      ".graph-pan, .graph-zoom",
    ) ?? []) {
      if (!box || el.offsetHeight === 0) continue;
      const r = el.getBoundingClientRect();
      controls.push({
        left: r.left - box.left,
        top: r.top - box.top,
        right: r.right - box.left,
        bottom: r.bottom - box.top,
      });
    }
    const controlsTop = controls.length
      ? Math.min(...controls.map((c) => c.top))
      : h - SAFE_BOTTOM;
    // The band kept clear under the graph: at least SAFE_BOTTOM, and the
    // controls' own height when they are taller.
    const bottomEdge = Math.min(h - SAFE_BOTTOM, controlsTop - 8);
    const topEdge = FIT_PADDING - 8;
    const fit = fitCamera({
      nodes: placed.map((n) => ({
        id: n.id,
        x: n.x,
        y: n.y,
        labelHalf: Math.min(80, 3.4 * displayName(n.title).length + 4),
      })),
      width: w,
      height: h,
      topEdge,
      bottomEdge,
      labelRoom: LABEL_ROOM,
      focusId: this.props.selectedRef,
    });
    if (!fit) return;
    const { scale, x: camX } = fit;
    let camY = fit.y;

    // The current page must not sit under a control.
    const current = placed.find((n) => n.id === this.props.selectedRef);
    if (current) {
      const r = (this.radiusMap.get(current.id) ?? 12) + 10;
      const sx = w / 2 + (current.x - camX) * scale;
      for (const c of controls) {
        const sy = h / 2 + (current.y - camY) * scale;
        const hit =
          sx + r > c.left &&
          sx - r < c.right &&
          sy + r > c.top &&
          sy - r < c.bottom;
        if (hit) camY += (sy - (c.top - r - 8)) / scale;
      }
    }
    fg.centerAt(camX, camY, this.ms(400));
    fg.zoom(scale, this.ms(400));
  }

  render() {
    const { edgeHover, ghostHover } = this.state;
    const { empty } = this.props;
    const isEmpty = this.computed.nodes.length === 0;
    return (
      <div class="gv-canvas-wrap">
        <div
          ref={(el) => {
            this.containerRef = el;
          }}
          class="graph-canvas"
          role="img"
          aria-label="Graph of pages and the lines between them. The Nodes list in the filters is the way to browse it with a keyboard."
        />
        {isEmpty && (
          <div class="gv-empty" role="status">
            <p>There are no pages in the graph.</p>
          </div>
        )}
        {!isEmpty && empty && (
          <EmptyNote hidden={empty.hidden} emit={this.props.emit} />
        )}
        {edgeHover && <EdgeTooltip {...edgeHover} />}
        {ghostHover && !edgeHover && <GhostTooltip {...ghostHover} />}
        <div class="graph-pan" role="group" aria-label="Pan">
          <button
            type="button"
            class="graph-pan-up"
            title="Pan up"
            aria-label="Pan up"
            onClick={() => this.pan(0, -1)}
          >
            ↑
          </button>
          <button
            type="button"
            class="graph-pan-left"
            title="Pan left"
            aria-label="Pan left"
            onClick={() => this.pan(-1, 0)}
          >
            ←
          </button>
          <button
            type="button"
            class="graph-pan-center"
            title="Center on current page"
            aria-label="Center on current page"
            onClick={this.recenter}
          >
            ⊙
          </button>
          <button
            type="button"
            class="graph-pan-right"
            title="Pan right"
            aria-label="Pan right"
            onClick={() => this.pan(1, 0)}
          >
            →
          </button>
          <button
            type="button"
            class="graph-pan-down"
            title="Pan down"
            aria-label="Pan down"
            onClick={() => this.pan(0, 1)}
          >
            ↓
          </button>
        </div>
        <div class="graph-zoom" role="group" aria-label="Zoom">
          <button
            type="button"
            title="Zoom in"
            aria-label="Zoom in"
            onClick={this.zoomIn}
          >
            +
          </button>
          <button
            type="button"
            title="Zoom out"
            aria-label="Zoom out"
            onClick={this.zoomOut}
          >
            −
          </button>
          {/* The phone has no pan pad: the centre button moves here. */}
          <button
            type="button"
            class="graph-fit"
            title="Center on current page"
            aria-label="Center on current page"
            onClick={this.recenter}
          >
            ⊙
          </button>
        </div>
      </div>
    );
  }
}

// What the canvas says when the page has nothing around it (product design §5):
// why, and the one thing that might help.
function EmptyNote({
  hidden,
  emit,
}: {
  hidden: number;
  emit: (event: GraphEvent) => void;
}) {
  return (
    <div class="gv-empty" role="status">
      <p>
        This page has no links or similar pages yet.
        {hidden > 0 &&
          ` ${hidden} ${hidden === 1 ? "page is" : "pages are"} hidden because ${hidden === 1 ? "it is" : "they are"} not connected.`}
      </p>
      {hidden > 0 && (
        <Button
          onClick={() =>
            emit({ type: "filters.patch", patch: { hideOrphans: false } })
          }
        >
          Show them
        </Button>
      )}
    </div>
  );
}

function GhostTooltip({
  title,
  x,
  y,
}: {
  title: string;
  x: number;
  y: number;
}) {
  return (
    <div
      class="gv-ghost-tooltip"
      style={{ left: `${x + 14}px`, top: `${y + 14}px` }}
    >
      Click to add <strong>{title}</strong> to the graph
    </div>
  );
}

function EdgeTooltip({
  edge,
  x,
  y,
}: {
  edge: MergedEdge;
  x: number;
  y: number;
}) {
  // Collect distinct, trimmed snippets across all merged provenance refs.
  const snippets: string[] = [];
  const seen = new Set<string>();
  for (const r of edge.refs) {
    const s = r.snippet?.trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    snippets.push(s);
  }
  return (
    <div
      class="gv-edge-tooltip"
      style={{ left: `${x + 14}px`, top: `${y + 14}px` }}
    >
      <div class="gv-edge-tooltip-label">
        {edge.label}
        {edge.score !== undefined && ` · ${edge.score.toFixed(2)}`}
      </div>
      {snippets.length === 0
        ? // Pure semantic edges have no source text; the score says it all.
          edge.score === undefined && (
            <div class="gv-edge-tooltip-snippet gv-edge-tooltip-empty">
              (no snippet)
            </div>
          )
        : snippets.map((s, i) => (
            <div class="gv-edge-tooltip-snippet" key={i}>
              {s}
            </div>
          ))}
    </div>
  );
}
