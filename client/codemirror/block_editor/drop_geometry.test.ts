// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada
import { describe, expect, test } from "vitest";
import {
  driftAt,
  dropLineTop,
  type GapSources,
  gapY,
  type LineBox,
} from "./drop_geometry.ts";

// Ten lines of 27.2px. The height map starts at documentTop (60); the page puts
// 93px of its own (a cover slot and its margin) above the first line, so on
// screen every line sits 93px lower than the height map says. The first line
// is the one the height map folds the slot into, as CodeMirror does.
const LINE = 27.2;
const SLOT = 93;
const DOCUMENT_TOP = 60;
const modelled = (line: number): LineBox => ({
  top: DOCUMENT_TOP + (line - 1) * LINE,
  bottom: DOCUMENT_TOP + line * LINE,
});
const screen = (line: number): LineBox => ({
  top: modelled(line).top + SLOT,
  bottom: modelled(line).bottom + SLOT,
});

function sources(drawn: (line: number) => boolean, drift: number): GapSources {
  return {
    lineCount: 10,
    modelled,
    measured: (line) => (drawn(line) ? screen(line) : undefined),
    drift,
  };
}

describe("gapY", () => {
  test("a line that is drawn is read from the DOM, not from the height map", () => {
    const s = sources(() => true, 0);
    expect(gapY(4, s)).toBe(screen(4).top);
    expect(gapY(4, s)).not.toBe(modelled(4).top);
  });

  test("the gap before a line is the line's top, so the bar is not on the line above's text", () => {
    const s = sources(() => true, 0);
    // the gap is at the seam between line 3 and line 4
    expect(gapY(4, s)).toBeCloseTo(screen(3).bottom, 6);
    expect(gapY(4, s)).toBeGreaterThanOrEqual(screen(3).bottom);
  });

  test("past the last line it is the bottom of the last one", () => {
    expect(
      gapY(
        11,
        sources(() => true, 0),
      ),
    ).toBe(screen(10).bottom);
  });

  test("a line that is not drawn is estimated and moved by the drift", () => {
    const s = sources((line) => line < 8, SLOT);
    expect(gapY(9, s)).toBeCloseTo(screen(9).top, 6);
    expect(gapY(11, s)).toBeCloseTo(screen(10).bottom, 6);
  });

  test("with no drift and nothing drawn it falls back to the height map", () => {
    const s = sources(() => false, 0);
    expect(gapY(2, s)).toBe(modelled(2).top);
  });

  test("a line number below 1 is the first line", () => {
    expect(
      gapY(
        0,
        sources(() => true, 0),
      ),
    ).toBe(screen(1).top);
  });
});

describe("driftAt", () => {
  test("is how far lower the DOM has the line than the height map", () => {
    expect(driftAt(5, sources(() => true, 0).measured, modelled)).toBeCloseTo(
      SLOT,
      6,
    );
  });

  test("is 0 for a line that is not drawn", () => {
    expect(driftAt(5, sources(() => false, 0).measured, modelled)).toBe(0);
  });

  test("is 0 on a page with nothing above the first line", () => {
    const flat = (line: number) => modelled(line);
    expect(driftAt(5, flat, modelled)).toBe(0);
  });
});

describe("dropLineTop", () => {
  test("centres the bar on the gap", () => {
    expect(dropLineTop(100)).toBe(99);
    expect(dropLineTop(100, 4)).toBe(98);
  });
});
