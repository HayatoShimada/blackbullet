// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada
import { useLayoutEffect, useState } from "preact/hooks";

/** Where the table becomes a list of cards (the stylesheet's container query
 * says the same: `@container (max-width: 480px)` on `.db-app`). */
export const NARROW_PX = 480;
/** `.db-app`'s horizontal padding, before it is in the DOM to be measured. */
const APP_PAD = 24;

const widthOf = (app: Element | null): number => {
  if (!app) return document.documentElement.clientWidth - APP_PAD;
  const css = getComputedStyle(app);
  return (
    app.clientWidth -
    (Number.parseFloat(css.paddingLeft) || 0) -
    (Number.parseFloat(css.paddingRight) || 0)
  );
};

/**
 * Whether the view is narrower than a table can use: one measurement of the
 * frame, kept current by a ResizeObserver. It lets the view mount the table or
 * the card list, not both. It reports a size and nothing else.
 */
export function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(
    () => widthOf(document.querySelector(".db-app")) <= NARROW_PX,
  );
  useLayoutEffect(() => {
    const app = document.querySelector(".db-app");
    const check = () => setNarrow(widthOf(app) <= NARROW_PX);
    check();
    if (!app) return;
    const watcher = new ResizeObserver(check);
    watcher.observe(app);
    return () => watcher.disconnect();
  }, []);
  return narrow;
}
