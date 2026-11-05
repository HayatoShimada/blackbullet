// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada

/** The build stamp in a precache name (`cache-<unix millis>`), or 0. */
function stampOf(name: string): number {
  const m = /^cache-(\d+)$/.exec(name);
  return m ? Number(m[1]) : 0;
}

/**
 * The caches a newly activated worker deletes: every one but its own and
 * the newest one before it. That previous one still holds the chunks a tab
 * opened on the old version loads lazily, so the tab keeps working until it
 * reloads; it goes with the next version.
 */
export function cachesToDrop(names: string[], current: string): string[] {
  const others = names.filter((name) => name !== current);
  const previous = others
    .filter((name) => stampOf(name) > 0)
    .sort((a, b) => stampOf(b) - stampOf(a))[0];
  return others.filter((name) => name !== previous);
}
