// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada

/** How often an open tab asks the server for a newer client. */
export const UPDATE_CHECK_MS = 30 * 60_000;
/** Coming back to the tab asks again, at most this often. */
export const FOCUS_CHECK_MIN_MS = 60_000;
/** A new client found this soon after loading (the reload that found it)
 * loads at once, unless something is waiting to be saved. */
export const BOOT_RELOAD_WINDOW_MS = 15_000;
/** A stale chunk reloads the page at most this often (no reload loop). */
export const STALE_RELOAD_MIN_MS = 60_000;

/** A service worker as this module sees it. */
export type WorkerLike = EventTarget & {
  readonly state: string;
  postMessage(message: unknown): void;
};

export type UpdateWatch = {
  registration: EventTarget & {
    update(): Promise<unknown>;
    readonly waiting: WorkerLike | null;
    readonly installing: WorkerLike | null;
  };
  /** `navigator.serviceWorker`: fires `controllerchange`. */
  container: EventTarget & { controller: unknown };
  /** The document: fires `visibilitychange`. */
  page: EventTarget & { visibilityState: string };
  bootedAt: number;
  now: () => number;
  hasUnsavedChanges: () => boolean;
  reload: () => void;
  /** Offers the reader a reload (one notification with a Reload action). */
  announce: (reload: () => void) => void;
  every: (run: () => void, ms: number) => void;
};

/**
 * Keeps an open tab from running an old client for days, and is the one
 * place that says a new version is there. The browser only looks for a new
 * service worker when a page loads; this asks now and then (and on returning
 * to the tab). A new worker waits (the worker does not skip waiting on its
 * own, so code is never swapped under a running tab) until this tab takes
 * it: at once right after a reload, when nothing waits to be saved;
 * otherwise "A new version is ready · Reload". When another tab took it
 * first, this tab offers the reload the same way.
 */
export function watchForUpdates(w: UpdateWatch): void {
  // The first install also takes control; that is not an update.
  let controlled = !!w.container.controller;
  let offered = false;
  let taking = false;
  let lastCheck = w.now();
  const fresh = () =>
    w.now() - w.bootedAt < BOOT_RELOAD_WINDOW_MS && !w.hasUnsavedChanges();
  const offer = (run: () => void) => {
    if (offered) return;
    offered = true;
    w.announce(run);
  };
  /** Lets the waiting worker take over; `controllerchange` then reloads. */
  const take = (worker: WorkerLike) => {
    if (worker.state !== "installed") {
      // Already taken (by another tab) or gone: just load what is current.
      w.reload();
      return;
    }
    taking = true;
    worker.postMessage({ type: "skip-waiting" });
  };
  const waitingFound = (worker: WorkerLike) => {
    // With no controller this is the first install, which activates itself.
    if (!controlled) return;
    if (fresh()) take(worker);
    else offer(() => take(worker));
  };
  const check = () => {
    lastCheck = w.now();
    w.registration.update().catch(() => {
      // Offline or the server is restarting: the next check tries again.
    });
  };

  if (w.registration.waiting) waitingFound(w.registration.waiting);
  w.registration.addEventListener("updatefound", () => {
    const worker = w.registration.installing;
    if (!worker) return;
    worker.addEventListener("statechange", () => {
      if (worker.state === "installed") waitingFound(worker);
    });
  });
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
    if (taking || fresh()) {
      taking = false;
      w.reload();
      return;
    }
    // Another tab took the new version: this one runs the old code still.
    // A notice already up for the waiting worker now just reloads (take()).
    offer(w.reload);
  });
}

export type StaleChunkWatch = {
  /** `window`: fires `unhandledrejection`. */
  target: EventTarget;
  now: () => number;
  /** When this tab last reloaded for a stale chunk (survives the reload). */
  lastReload: () => number;
  markReload: (at: number) => void;
  hasUnsavedChanges: () => boolean;
  reload: () => void;
  announce: (reload: () => void) => void;
};

const STALE_CHUNK =
  /dynamically imported module|Importing a module script failed|error loading dynamically imported/i;

/** Whether a rejection is a lazily loaded chunk that is no longer there. */
export function isStaleChunkError(reason: unknown): boolean {
  const message =
    reason instanceof Error ? reason.message : String(reason ?? "");
  return STALE_CHUNK.test(message);
}

/**
 * A tab that outlived two versions asks for a chunk no cache or server has.
 * It loads the current version then: at once when nothing waits to be saved
 * (once a minute at most, so a broken deploy cannot loop), otherwise by
 * offering a Reload.
 */
export function reloadOnStaleChunks(s: StaleChunkWatch): void {
  s.target.addEventListener("unhandledrejection", (event) => {
    if (!isStaleChunkError((event as PromiseRejectionEvent).reason)) return;
    const now = s.now();
    if (!s.hasUnsavedChanges() && now - s.lastReload() >= STALE_RELOAD_MIN_MS) {
      s.markReload(now);
      s.reload();
    } else {
      s.announce(s.reload);
    }
  });
}
