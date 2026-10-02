/**
 * How far to scroll, per frame, while a block is dragged near the edge of the
 * editor: nothing in the middle, faster the closer the pointer is to (or the
 * further past) an edge. Pure, so the feel of it can be pinned down in a test.
 */
export const EDGE_PX = 56;
export const MAX_SPEED_PX = 22;

export function autoScrollDelta(
  pointerY: number,
  viewTop: number,
  viewBottom: number,
  edge = EDGE_PX,
  maxSpeed = MAX_SPEED_PX,
): number {
  if (viewBottom - viewTop < edge * 2) return 0; // too small to have a middle
  const intoTop = viewTop + edge - pointerY;
  if (intoTop > 0)
    return -Math.min(maxSpeed, Math.ceil((intoTop / edge) * maxSpeed));
  const intoBottom = pointerY - (viewBottom - edge);
  if (intoBottom > 0)
    return Math.min(maxSpeed, Math.ceil((intoBottom / edge) * maxSpeed));
  return 0;
}
