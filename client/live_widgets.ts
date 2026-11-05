// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada
import type { EventHook } from "./plugos/hooks/event.ts";

/** How long after a deletion the widgets are told, when no indexing follows
 * it to announce a drained queue. */
export const DELETE_SETTLE_MS = 300;

/**
 * Tells the page's sandboxed widgets (db views) when the index has taken in
 * changes this tab did not write itself: another tab, an agent through MCP,
 * an edit on disk. They read their rows again; the client's own writes are
 * left out, since a view already reads again after its own.
 */
export function relayIndexChanges(
  eventHook: EventHook,
  tell: (message: { type: "index-changed" }) => void,
): void {
  let changed = false;
  let deleteTimer: ReturnType<typeof setTimeout> | undefined;
  const flush = () => {
    if (!changed) return;
    changed = false;
    tell({ type: "index-changed" });
  };
  eventHook.addLocalListener(
    "file:changed",
    (_path: string, _oldHash: number, _newHash: number, ownWrite: boolean) => {
      if (!ownWrite) changed = true;
    },
  );
  eventHook.addLocalListener("file:deleted", () => {
    changed = true;
    clearTimeout(deleteTimer);
    deleteTimer = setTimeout(flush, DELETE_SETTLE_MS);
  });
  eventHook.addLocalListener("mq:emptyQueue:indexQueue", flush);
}
