import { describe, expect, test } from "vitest";
import type { DbEvent } from "./db_mediator.ts";
import {
  createPointerDrag,
  dropTargetOf,
  HOLD_MS,
  type PointerLike,
} from "./pointer_drag.ts";

const at = (
  x: number,
  y: number,
  pointerType = "mouse",
  pointerId = 1,
): PointerLike => ({
  pointerId,
  pointerType,
  clientX: x,
  clientY: y,
  button: 0,
});

function setup(targets: (x: number, y: number) => string | null = () => "col") {
  const events: DbEvent[] = [];
  const log: string[] = [];
  let pending: (() => void) | undefined;
  const drag = createPointerDrag({
    emit: (e) => events.push(e),
    targetAt: targets,
    onStart: (id) => log.push(`start ${id}`),
    onEnd: (id) => log.push(`end ${id}`),
    setTimer: (fn, ms) => {
      log.push(`timer ${ms}`);
      pending = fn;
      return 1;
    },
    clearTimer: () => {
      pending = undefined;
    },
  });
  return { drag, events, log, fire: () => pending?.() };
}

describe("pointer drag, mouse", () => {
  test("a small movement is a click, not a drag", () => {
    const { drag, events } = setup();
    drag.down("A", at(0, 0));
    drag.move(at(2, 2));
    drag.up(at(2, 2));
    expect(events).toEqual([]);
    expect(drag.consumeClick()).toBe(false);
  });

  test("past the threshold it drags and drops on the target under it", () => {
    const { drag, events, log } = setup((x) => (x > 50 ? "done" : "active"));
    drag.down("A", at(0, 0));
    drag.move(at(10, 0));
    drag.move(at(60, 0));
    drag.up(at(60, 0));
    expect(events).toEqual([
      { type: "card.drag", rowId: "A" },
      { type: "card.over", target: "active" },
      { type: "card.over", target: "done" },
      { type: "card.drop", target: "done" },
    ]);
    expect(log).toEqual(["start 1", "end 1"]);
    expect(drag.dragging()).toBe(false);
  });

  test("the click after a drag is swallowed once", () => {
    const { drag } = setup();
    drag.down("A", at(0, 0));
    drag.move(at(20, 0));
    drag.up(at(20, 0));
    expect(drag.consumeClick()).toBe(true);
    expect(drag.consumeClick()).toBe(false);
  });

  test("dropping on nothing cancels", () => {
    const { drag, events } = setup(() => null);
    drag.down("A", at(0, 0));
    drag.move(at(20, 0));
    drag.up(at(20, 0));
    expect(events.at(-1)).toEqual({ type: "card.cancel" });
  });

  test("pointer cancel ends a drag; other buttons and ignored targets do not start", () => {
    const { drag, events } = setup();
    drag.down("A", at(0, 0));
    drag.move(at(20, 0));
    drag.cancel();
    expect(events.at(-1)).toEqual({ type: "card.cancel" });
    drag.down("A", { ...at(0, 0), button: 2 });
    drag.move(at(30, 0));
    drag.down("A", at(0, 0), true);
    drag.move(at(30, 0));
    expect(events.filter((e) => e.type === "card.drag")).toHaveLength(1);
  });

  test("another pointer's events are ignored", () => {
    const { drag, events } = setup();
    drag.down("A", at(0, 0, "mouse", 1));
    drag.move(at(30, 0, "mouse", 2));
    expect(events).toEqual([]);
  });
});

describe("pointer drag, touch", () => {
  test("holding starts the drag; then moves and a lift drop it", () => {
    const { drag, events, log, fire } = setup(() => "someday");
    drag.down("A", at(5, 5, "touch"));
    expect(log).toEqual([`timer ${HOLD_MS}`]);
    expect(events).toEqual([]);
    fire();
    expect(events).toEqual([{ type: "card.drag", rowId: "A" }]);
    expect(drag.dragging()).toBe(true);
    drag.move(at(40, 5, "touch"));
    drag.up(at(40, 5, "touch"));
    expect(events.at(-1)).toEqual({ type: "card.drop", target: "someday" });
  });

  test("moving before the hold is up is a scroll: nothing starts", () => {
    const { drag, events, fire } = setup();
    drag.down("A", at(5, 5, "touch"));
    drag.move(at(5, 60, "touch"));
    fire();
    expect(events).toEqual([]);
    expect(drag.dragging()).toBe(false);
  });

  test("a lift before the hold is up is a tap", () => {
    const { drag, events, fire } = setup();
    drag.down("A", at(5, 5, "touch"));
    drag.up(at(5, 5, "touch"));
    fire();
    expect(events).toEqual([]);
    expect(drag.consumeClick()).toBe(false);
  });
});

describe("dropTargetOf", () => {
  const el = (drop: string | null) => ({
    closest: () => (drop === null ? null : { getAttribute: () => drop }),
  });
  test("is the nearest data-drop, empty text included, else null", () => {
    expect(dropTargetOf(el("done"))).toBe("done");
    expect(dropTargetOf(el(""))).toBe("");
    expect(dropTargetOf(el(null))).toBeNull();
    expect(dropTargetOf(null)).toBeNull();
  });
});
