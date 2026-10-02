// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada
import { expect, test } from "vitest";
import { FRAME_BOTTOM_PULL, placePopover } from "./popover_place.ts";

const view = { width: 400, height: 300 };
const menu = { width: 120, height: 100 };
const rect = (left: number, top: number, w = 28, h = 28) => ({
  left,
  top,
  right: left + w,
  bottom: top + h,
});

test("hangs below the button, right-aligned to it", () => {
  const p = placePopover(rect(300, 20), menu, view);
  expect(p).toEqual({ left: 208, top: 52, needed: 0 });
});

test("stays inside the viewport edge", () => {
  expect(placePopover(rect(0, 20), menu, view).left).toBe(8);
  expect(placePopover(rect(390, 20), menu, view).left).toBe(272);
});

test("flips above near the bottom", () => {
  expect(placePopover(rect(300, 250), menu, view)).toMatchObject({
    top: 146,
    needed: 0,
  });
});

test("asks the view to grow when neither side has room", () => {
  const p = placePopover(rect(300, 40), menu, { width: 400, height: 120 });
  expect(p.top).toBe(72);
  expect(p.needed).toBe(180);
});

test("a menu that fits the window but not the visible frame flips", () => {
  // The last row's button at the bottom of a 261px window: the menu would end
  // inside the 16px the frame hides, so the caller reports the shorter height.
  const anchor = rect(300, 180, 28, 28);
  const shown = { width: 400, height: 261 - FRAME_BOTTOM_PULL };
  const p = placePopover(anchor, { width: 120, height: 34 }, shown);
  expect(p.top).toBe(180 - 4 - 34);
  expect(p.needed).toBe(0);
  // Against the full window it would have stayed below, clipped.
  expect(
    placePopover(
      anchor,
      { width: 120, height: 34 },
      { width: 400, height: 261 },
    ).top,
  ).toBe(212);
});
