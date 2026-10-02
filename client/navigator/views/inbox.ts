// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada
//
// The Inbox in the tree: quick notes are `Inbox/<date>/<time>`, which reads as
// a path rather than as notes. Newest first; how a note is labelled ("Quick
// note · 11:17") is `../page_title.ts`. Display only: the name stays the name.

const INBOX = "Inbox";
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}-\d{2}-\d{2}$/;

type Named = { name: unknown; lastModified?: unknown };

/**
 * Orders two rows under `Inbox/` newest first at the first level where their
 * names differ: dated and timed names by name, descending; others by their
 * modified time, descending. 0 (leave it to the caller's order) for rows
 * outside the Inbox and for the same name.
 */
export function inboxOrder(a: Named, b: Named): number {
  const left = String(a.name).split("/");
  const right = String(b.name).split("/");
  if (left[0] !== INBOX || right[0] !== INBOX) return 0;
  for (let i = 1; i < Math.min(left.length, right.length); i++) {
    if (left[i] === right[i]) continue;
    const l = dated(left[i]);
    const r = dated(right[i]);
    if (l !== r) return l ? -1 : 1;
    if (l) return left[i] < right[i] ? 1 : -1;
    const lm = String(a.lastModified ?? "");
    const rm = String(b.lastModified ?? "");
    if (lm !== rm) return lm < rm ? 1 : -1;
    return 0;
  }
  return 0;
}

function dated(segment: string): boolean {
  return DATE.test(segment) || TIME.test(segment);
}
