// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada
//
// Pages that were just created from the UI. A new page has no file until its
// first edit and no row until the index has seen that file, so the tree would
// show nothing for a while. These are drawn as rows (the way an aspiring page
// is) from the moment of creation until the real one shows up, or a while has
// passed with nothing written.

import { events } from "@silverbulletmd/silverbullet/syscalls";

/** Local event the tree refreshes on. */
export const PENDING_PAGES_EVENT = "navigator:pending-pages";

/** How long a page that never got a first edit keeps its row. */
export const PENDING_TTL_MS = 10 * 60 * 1000;

type Row = {
  name: string;
  ref: string;
  tag: "page";
  isPending: true;
};

export function createPendingPages(now: () => number = Date.now) {
  const added = new Map<string, number>();
  return {
    add(name: string): void {
      added.set(name, now());
    },
    has(name: string): boolean {
      return added.has(name);
    },
    clear(): void {
      added.clear();
    },
    /** A row per pending page. */
    rows(): Row[] {
      return [...added.keys()].map((name) => ({
        name,
        ref: name,
        tag: "page" as const,
        isPending: true as const,
      }));
    },
    /**
     * Forgets whatever now exists for real, or has waited too long. `names`
     * includes this class's own rows, so only the ones the index (or the file
     * listing) produced count -- a name seen twice has a real page.
     */
    settle(names: string[]): void {
      const seen = new Map<string, number>();
      for (const name of names) seen.set(name, (seen.get(name) ?? 0) + 1);
      for (const [name, at] of added) {
        if ((seen.get(name) ?? 0) > 1 || now() - at > PENDING_TTL_MS) {
          added.delete(name);
        }
      }
    },
  };
}

export const pendingPages = createPendingPages();

/** Shows `name` in the tree at once. */
export async function showPendingPage(name: string): Promise<void> {
  pendingPages.add(name);
  try {
    await events.dispatchEvent(PENDING_PAGES_EVENT, { name });
  } catch {
    // The tree catches up on the next index event.
  }
}
