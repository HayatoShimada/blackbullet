// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada

// The auto-fit camera, as a pure function so its guards can be tested without
// a canvas. The canvas feeds it the placed nodes and the room it may use and
// paints whatever it returns.

/** Below this a label is no longer drawn (see NODE_LABEL_MIN_SCALE in
 * graph_canvas.tsx), so framing never goes lower: a bigger graph is cropped
 * around the current page instead of shrunk into dots. */
export const MIN_AUTO_ZOOM = 0.4;
/** Framing never magnifies past this, so two close pages are not blown up to
 * fill the canvas. */
export const MAX_AUTO_ZOOM = 2;

export type FitNode = {
  id: string;
  x: number;
  y: number;
  /** Half the width a label extends past its node, in graph units at scale 1. */
  labelHalf: number;
};

export type FitInput = {
  nodes: FitNode[];
  /** Canvas size in pixels. */
  width: number;
  height: number;
  /** The part of the canvas the graph may use, in pixels from its top. */
  topEdge: number;
  bottomEdge: number;
  /** Pixels reserved under the lowest node for its label. */
  labelRoom: number;
  /** The current page; it stays on screen when the graph does not fit. */
  focusId: string | null;
};

export type Fit = {
  scale: number;
  /** The graph point the camera looks at. */
  x: number;
  y: number;
  /** True when the whole graph does not fit at a readable scale. */
  cropped: boolean;
};

export function fitCamera(input: FitInput): Fit | null {
  const { nodes, width: w, height: h } = input;
  if (nodes.length === 0 || w <= 0 || h <= 0) return null;
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const n of nodes) {
    minX = Math.min(minX, n.x);
    maxX = Math.max(maxX, n.x);
    minY = Math.min(minY, n.y);
    maxY = Math.max(maxY, n.y);
  }
  const midX = (minX + maxX) / 2;
  const midY = (minY + maxY) / 2;
  const room = Math.max(1, input.bottomEdge - input.topEdge - input.labelRoom);

  // Down, the room is the limit; across, a label reaches past its node.
  let limit = room / Math.max(1, maxY - minY);
  for (const n of nodes) {
    const dx = Math.abs(n.x - midX);
    if (dx > 0) limit = Math.min(limit, (w / 2 - 12 - n.labelHalf) / dx);
  }
  const cropped = limit < MIN_AUTO_ZOOM;
  const scale = Math.min(MAX_AUTO_ZOOM, Math.max(MIN_AUTO_ZOOM, limit));

  // Whole graph: its middle in the middle of the room. Cropped: the current
  // page there instead, so the page being read is never the part cut off.
  const focus = cropped ? nodes.find((n) => n.id === input.focusId) : undefined;
  const x = focus ? focus.x : midX;
  const y0 = focus ? focus.y : midY;
  const wantScreenY = input.topEdge + room / 2;
  return { scale, x, y: y0 + (h / 2 - wantScreenY) / scale, cropped };
}
