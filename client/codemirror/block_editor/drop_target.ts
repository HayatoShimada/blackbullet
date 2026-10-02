/**
 * Where a dragged block would land, from where the pointer is. Pure: the view
 * measures the document and hands over numbers; this decides.
 *
 * The candidates are the gaps between lines at which a block may be put
 * (`boundaries`, each with its height on screen). The pointer picks the
 * nearest one that is allowed, and -- for a list item -- its horizontal
 * position picks the depth, one indent step at a time.
 */
import type { Block } from "./blocks.ts";
import { allowedDepths, refusalFor } from "./plan_move.ts";

export type Boundary = {
  /** The block would go before this line (1-based). */
  insertAt: number;
  /** Where the gap is on screen, vertically. */
  y: number;
};

export type DropTarget = {
  insertAt: number;
  /** The depth a list item lands at; 0 for everything else. */
  depth: number;
  /** The gap's height on screen, for the line that shows it. */
  y: number;
};

export function pickDropTarget(opts: {
  /** The pointer. */
  x: number;
  y: number;
  boundaries: readonly Boundary[];
  blocks: readonly Block[];
  moving: Block;
  /** Where a top-level list item's text starts, and how far one level is. */
  baseLeft: number;
  indentPx: number;
}): DropTarget | null {
  const { blocks, moving } = opts;
  let best: Boundary | undefined;
  for (const boundary of opts.boundaries) {
    if (refusalFor(blocks, moving, boundary.insertAt)) continue;
    if (!best || Math.abs(boundary.y - opts.y) < Math.abs(best.y - opts.y)) {
      best = boundary;
    }
  }
  if (!best) return null;

  let depth = 0;
  if (moving.kind === "list-item") {
    const { min, max } = allowedDepths(blocks, moving, best.insertAt);
    const wanted =
      opts.indentPx > 0
        ? Math.round((opts.x - opts.baseLeft) / opts.indentPx)
        : moving.depth;
    depth = Math.min(max, Math.max(min, wanted));
  }
  return { insertAt: best.insertAt, depth, y: best.y };
}
