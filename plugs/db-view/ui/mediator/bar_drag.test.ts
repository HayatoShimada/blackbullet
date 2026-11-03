// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada
import { describe, expect, test } from "vitest";
import { createBarDrag } from "./bar_drag.ts";
import type { DbEvent } from "./db_mediator.ts";
import { HOLD_MS } from "./pointer_drag.ts";

const mouse = (x: number, y = 0) => ({
  pointerId: 1,
  pointerType: "mouse",
  clientX: x,
  clientY: y,
  button: 0,
});
const touch = (x: number, y = 0) => ({
  pointerId: 2,
  pointerType: "touch",
  clientX: x,
  clientY: y,
});

function setup() {
  const events: DbEvent[] = [];
  let fire: (() => void) | null = null;
  const drag = createBarDrag({
    emit: (e) => events.push(e),
    pxPerDay: () => 20,
    // 20px a day from Oct 1; rows are 32px high: A, then B.
    dayAt: (x) =>
      x < 0
        ? null
        : `2026-10-${String(1 + Math.floor(x / 20)).padStart(2, "0")}`,
    rowAt: (_x, y) => (y < 32 ? "A" : y < 64 ? "B" : null),
    setTimer: (fn) => {
      fire = fn;
      return 1;
    },
    clearTimer: () => {
      fire = null;
    },
  });
  return { drag, events, hold: () => fire?.() };
}

describe("bar drag", () => {
  test("a mouse moves a bar by whole days", () => {
    const { drag, events } = setup();
    drag.down({ kind: "bar", rowId: "A", edge: "move" }, mouse(100));
    drag.move(mouse(103));
    expect(events).toEqual([]);
    drag.move(mouse(131));
    drag.up(mouse(145));
    expect(events).toEqual([
      { type: "tl.bar.drag", rowId: "A", edge: "move" },
      { type: "tl.bar.over", delta: 2 },
      { type: "tl.bar.over", delta: 2 },
      { type: "tl.bar.drop" },
    ]);
    expect(drag.consumeClick()).toBe(true);
    expect(drag.consumeClick()).toBe(false);
  });

  test("a press without a move is a click, not a drag", () => {
    const { drag, events } = setup();
    drag.down({ kind: "bar", rowId: "A", edge: "end" }, mouse(100));
    drag.up(mouse(101));
    expect(events).toEqual([]);
    expect(drag.consumeClick()).toBe(false);
  });

  test("a link is pulled to the bar under the pointer", () => {
    const { drag, events } = setup();
    drag.down({ kind: "link", rowId: "A" }, mouse(100, 10));
    drag.move(mouse(140, 40));
    drag.up(mouse(150, 45));
    expect(events.at(0)).toEqual({ type: "tl.link.start", rowId: "A" });
    expect(events.at(-2)).toEqual({ type: "tl.link.over", target: "B" });
    expect(events.at(-1)).toEqual({ type: "tl.link.drop" });
  });

  test("drawing keeps the last day when the pointer leaves the grid", () => {
    const { drag, events } = setup();
    drag.down({ kind: "draw", day: "2026-10-03" }, mouse(50));
    drag.move(mouse(90));
    drag.up(mouse(-30));
    expect(events).toEqual([
      { type: "tl.draw.start", day: "2026-10-03" },
      { type: "tl.draw.over", day: "2026-10-05" },
      { type: "tl.draw.over", day: "2026-10-05" },
      { type: "tl.draw.drop" },
    ]);
  });

  test("touch: a hold starts it; a quick swipe is a scroll", () => {
    const swipe = setup();
    swipe.drag.down({ kind: "place", rowId: "U" }, touch(10));
    swipe.drag.move(touch(60));
    swipe.hold();
    expect(swipe.events).toEqual([]);

    const held = setup();
    held.drag.down({ kind: "place", rowId: "U" }, touch(10));
    held.hold();
    held.drag.move(touch(70));
    held.drag.cancel();
    expect(held.events).toEqual([
      { type: "tl.place.drag", rowId: "U" },
      { type: "tl.place.over", day: "2026-10-04" },
      { type: "tl.cancel" },
    ]);
    expect(HOLD_MS).toBeGreaterThan(0);
  });
});
