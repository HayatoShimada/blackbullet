// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada

/** How often an open tab asks the server for a newer client. */
export const UPDATE_CHECK_MS = 30 * 60_000;
/** Coming back to the tab asks again, at most this often. */
export const FOCUS_CHECK_MIN_MS = 60_000;
/** A new client that takes over this soon after loading (the reload that
 * found it) loads at once, unless something is waiting to be saved. */
export const BOOT_RELOAD_WINDOW_MS = 15_000;

export type UpdateWatch = {
  registration: { update(): Promise<unknown> };
  /** `navigator.serviceWorker`: fires `controllerchange`. */
  container: EventTarget & { controller: unknown };
  /** The document: fires `visibilitychange`. */
  page: EventTarget & { visibilityState: string };
  bootedAt: number;
  now: () => number;
  hasUnsavedChanges: () => boolean;
  reload: () => void;
  /** Offers the reader a reload (a notification with a Reload action). */
  announce: (reload: () => void) => void;
  every: (run: () => void, ms: number) => void;
};

/**
 * Keeps an open tab from running an old client for days. The browser only
 * looks for a new service worker when a page loads, and the page that finds
 * one keeps the old code: asks now and then (and on returning to the tab),
 * and when a new client takes over, loads it — at once right after a reload,
 * otherwise by offering a Reload, so nothing typed is thrown away.
 */
export function watchForUpdates(w: UpdateWatch): void {
  // The first install also takes control; that is not an update.
  let controlled = !!w.container.controller;
  let handled = false;
  let lastCheck = w.now();
  const check = () => {
    lastCheck = w.now();
    w.registration.update().catch(() => {
      // Offline or the server is restarting: the next check tries again.
    });
  };
  w.every(check, UPDATE_CHECK_MS);
  w.page.addEventListener("visibilitychange", () => {
    if (w.page.visibilityState !== "visible") return;
    if (w.now() - lastCheck >= FOCUS_CHECK_MIN_MS) check();
  });
  w.container.addEventListener("controllerchange", () => {
    if (!controlled) {
      controlled = true;
      return;
    }
    if (handled) return;
    handled = true;
    if (
      w.now() - w.bootedAt < BOOT_RELOAD_WINDOW_MS &&
      !w.hasUnsavedChanges()
    ) {
      w.reload();
    } else {
      w.announce(w.reload);
    }
  });
}
