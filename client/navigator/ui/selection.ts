// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada

// Which list rows can hold the selection. Passive rows -- a count, a sentence,
// a group title -- cannot: arrows step over them, the default selection skips
// them, and Enter never reaches one.

/** How many rows at the top of `rows` are passive. */
export function leadingPassive(rows: { row: { passive?: boolean } }[]): number {
  let count = 0;
  while (count < rows.length && rows[count].row.passive === true) count++;
  return count;
}

/**
 * The nearest selectable index from `index` going `direction`, and the other
 * way when nothing is left that way; `index` itself (clamped) when no row can
 * be selected at all.
 */
export function settleSelectable(
  isPassive: (index: number) => boolean,
  lastIndex: number,
  index: number,
  direction: 1 | -1,
): number {
  const from = Math.max(0, Math.min(lastIndex, index));
  for (const step of [direction, -direction]) {
    for (let i = from; i >= 0 && i <= lastIndex; i += step) {
      if (!isPassive(i)) return i;
    }
  }
  return from;
}
