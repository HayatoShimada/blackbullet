import { describe, expect, test } from "vitest";
import { autoScrollDelta, EDGE_PX, MAX_SPEED_PX } from "./auto_scroll.ts";

const top = 100;
const bottom = 700;

describe("autoScrollDelta", () => {
  test("nothing in the middle of the editor", () => {
    expect(autoScrollDelta(400, top, bottom)).toBe(0);
    expect(autoScrollDelta(top + EDGE_PX, top, bottom)).toBe(0);
    expect(autoScrollDelta(bottom - EDGE_PX, top, bottom)).toBe(0);
  });

  test("up near the top edge, down near the bottom", () => {
    expect(autoScrollDelta(top + 10, top, bottom)).toBeLessThan(0);
    expect(autoScrollDelta(bottom - 10, top, bottom)).toBeGreaterThan(0);
  });

  test("faster the closer to the edge", () => {
    const slow = autoScrollDelta(bottom - EDGE_PX + 8, top, bottom);
    const fast = autoScrollDelta(bottom - 8, top, bottom);
    expect(fast).toBeGreaterThan(slow);
    expect(slow).toBeGreaterThan(0);
  });

  test("never faster than the cap, even far past the edge", () => {
    expect(autoScrollDelta(bottom + 500, top, bottom)).toBe(MAX_SPEED_PX);
    expect(autoScrollDelta(top - 500, top, bottom)).toBe(-MAX_SPEED_PX);
  });

  test("an editor too small to have a middle does not scroll", () => {
    expect(autoScrollDelta(150, 100, 180)).toBe(0);
  });

  test("symmetrical", () => {
    expect(autoScrollDelta(top + 20, top, bottom)).toBe(
      -autoScrollDelta(bottom - 20, top, bottom),
    );
  });
});
