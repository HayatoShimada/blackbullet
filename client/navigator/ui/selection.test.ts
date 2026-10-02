// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada

import { expect, test } from "vitest";
import { leadingPassive, settleSelectable } from "./selection.ts";

const rows = (...passive: boolean[]) =>
  passive.map((p) => ({ row: { passive: p || undefined } }));

test("leading passive rows are counted from the top only", () => {
  expect(leadingPassive(rows(true, true, false, true))).toBe(2);
  expect(leadingPassive(rows(false, true))).toBe(0);
  expect(leadingPassive([])).toBe(0);
});

test("the default selection skips a passive first row", () => {
  const passive = [true, false, false];
  expect(settleSelectable((i) => passive[i], 2, 0, 1)).toBe(1);
});

test("arrows step over passive rows in the direction of travel", () => {
  const passive = [false, true, false];
  expect(settleSelectable((i) => passive[i], 2, 1, 1)).toBe(2);
  expect(settleSelectable((i) => passive[i], 2, 1, -1)).toBe(0);
});

test("with nothing selectable that way it settles the other way", () => {
  const passive = [true, false];
  // ArrowUp from the first real row would land on the passive one.
  expect(settleSelectable((i) => passive[i], 1, 0, -1)).toBe(1);
});

test("a list of nothing but passive rows keeps the clamped index", () => {
  expect(settleSelectable(() => true, 2, 5, 1)).toBe(2);
  expect(settleSelectable(() => true, 2, -3, -1)).toBe(0);
});
