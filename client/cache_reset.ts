// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada

/**
 * "Client: Reset Cache": throws away the app's cached code (every
 * CacheStorage cache and the service worker) and loads it fresh from the
 * server, for when the app looks wrong after an update. The synced notes
 * (IndexedDB) stay: edits not yet sent are sent by the next worker's first
 * sync. It needs the server, since the app is loaded from it right after.
 */
export type CacheReset = {
  /** Whether the server answers now. */
  reachable: () => Promise<boolean>;
  /** What the reader is asked; false keeps everything as it was. */
  confirm: (message: string) => Promise<boolean>;
  notify: (message: string) => void;
  /** Usage and whether the browser keeps the data (storage.persisted()). */
  storage: () => Promise<{ usage?: number; persisted?: boolean }>;
  /** Deletes every cache and unregisters the service worker. */
  flush: () => Promise<void>;
  reload: () => void;
};

export function describeStorage(s: {
  usage?: number;
  persisted?: boolean;
}): string {
  const parts: string[] = [];
  if (s.usage !== undefined) {
    parts.push(`Stored on this device: ${(s.usage / 1e6).toFixed(1)} MB`);
  }
  if (s.persisted !== undefined) {
    parts.push(
      s.persisted
        ? "The browser keeps it (persistent storage)."
        : "The browser may clear it when space runs low.",
    );
  }
  return parts.join(". ");
}

export async function resetCache(r: CacheReset): Promise<boolean> {
  if (!(await r.reachable())) {
    r.notify(
      "The server cannot be reached, so the app could not be loaded again. Try again when online.",
    );
    return false;
  }
  const info = describeStorage(await r.storage());
  const ok = await r.confirm(
    `Reload the app from the server, dropping its cached code? Your notes stay on this device, and edits not yet sent are sent after the reload.${info ? `\n\n${info}` : ""}`,
  );
  if (!ok) return false;
  await r.flush();
  r.reload();
  return true;
}
