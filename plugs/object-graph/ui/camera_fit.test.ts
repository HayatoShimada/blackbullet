// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada

import { describe, expect, it } from "vitest";
import {
  fitCamera,
  type FitInput,
  MAX_AUTO_ZOOM,
  MIN_AUTO_ZOOM,
} from "./camera_fit.ts";

const base = (over: Partial<FitInput> = {}): FitInput => ({
  nodes: [],
  width: 800,
  height: 600,
  topEdge: 40,
  bottomEdge: 536,
  labelRoom: 20,
  focusId: null,
  ...over,
});
const n = (id: string, x: number, y: number) => ({ id, x, y, labelHalf: 40 });

describe("fitCamera", () => {
  it("has nothing to frame without nodes or a canvas", () => {
    expect(fitCamera(base())).toBeNull();
    expect(fitCamera(base({ nodes: [n("a", 0, 0)], width: 0 }))).toBeNull();
  });

  it("frames a small graph around its middle", () => {
    const fit = fitCamera(
      base({ nodes: [n("a", -100, 0), n("b", 100, 0), n("c", 0, 100)] }),
    );
    expect(fit?.cropped).toBe(false);
    expect(fit?.x).toBe(0);
  });

  it("never magnifies past the ceiling", () => {
    const fit = fitCamera(base({ nodes: [n("a", 0, 0), n("b", 5, 5)] }));
    expect(fit?.scale).toBe(MAX_AUTO_ZOOM);
  });

  it("never shrinks below the readable floor, and keeps the current page", () => {
    const fit = fitCamera(
      base({
        nodes: [n("a", -5000, -5000), n("b", 5000, 5000), n("cur", 700, -300)],
        focusId: "cur",
      }),
    );
    expect(fit?.scale).toBe(MIN_AUTO_ZOOM);
    expect(fit?.cropped).toBe(true);
    expect(fit?.x).toBe(700);
    // The current page lands inside the room, not off the canvas.
    const screenY = 300 + (-300 - (fit?.y ?? 0)) * MIN_AUTO_ZOOM;
    expect(screenY).toBeGreaterThan(40);
    expect(screenY).toBeLessThan(536);
  });

  it("falls back to the middle when cropped and no page is current", () => {
    const fit = fitCamera(
      base({ nodes: [n("a", -4000, 0), n("b", 4000, 0)], focusId: "zzz" }),
    );
    expect(fit?.cropped).toBe(true);
    expect(fit?.x).toBe(0);
  });
});
