// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada

/**
 * (BlackBullet) What `?open=` may start once the app is up: the targets of
 * the installed app's shortcuts that are commands rather than pages. A
 * fixed list, so a link cannot run an arbitrary command.
 */
export const BOOT_OPEN: Record<string, string> = {
  journal: "Journal: Today",
  graph: "Graph: Open",
};

/** The command a page load's `?open=` asks for, if it is one we allow. */
export function bootCommand(search: string): string | undefined {
  const target = new URLSearchParams(search).get("open");
  return target && Object.hasOwn(BOOT_OPEN, target)
    ? BOOT_OPEN[target]
    : undefined;
}
