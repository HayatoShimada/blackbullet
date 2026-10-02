// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada
import type { Rect } from "./db_mediator.ts";

export const POPOVER_GAP = 4;
export const POPOVER_EDGE = 8;
/** The widget frame is pulled under its own bottom edge (2ch) and the host
 * pads it: that much of `window.innerHeight` is never seen. The caller takes
 * it off the viewport height it reports. */
export const FRAME_BOTTOM_PULL = 16;

export type Placement = {
  left: number;
  top: number;
  /** The height the view needs so the menu is not clipped; 0 when it fits. */
  needed: number;
};

/**
 * Where a menu of `size` goes, hanging from `anchor`: right-aligned to it,
 * kept inside the viewport, and flipped above it near the bottom. When neither
 * side has room the menu stays below and `needed` says how tall the view must
 * grow. Pure: the view only reports the sizes it measured.
 */
export function placePopover(
  anchor: Rect | undefined,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
): Placement {
  const e = POPOVER_EDGE;
  const a = anchor ?? { left: e, top: e, right: e, bottom: e };
  const left = Math.max(
    e,
    Math.min(a.right - size.width, viewport.width - size.width - e),
  );
  let top = a.bottom + POPOVER_GAP;
  let needed = 0;
  if (top + size.height > viewport.height - e) {
    const above = a.top - POPOVER_GAP - size.height;
    if (above >= e) top = above;
    else needed = top + size.height + e;
  }
  return { left, top, needed };
}
