// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada
/**
 * Where the gap before a line is on screen. Pure: the view hands over what it
 * measured and what its height map says; this decides which to believe.
 *
 * CodeMirror's height map knows only what CodeMirror drew. Anything the page
 * puts inside the content element on its own (the page-top slot with a cover
 * or an icon, a panel above the first line) pushes every line down without the
 * height map hearing of it, so `documentTop + lineBlock.top` lands above the
 * real line by the size of that extra. A line that is on screen is measured
 * from the DOM instead; one that is not (the gap sits outside the viewport) is
 * estimated from the height map and moved by the drift seen on a line that is.
 */

/** A line's box in viewport coordinates. */
export type LineBox = { top: number; bottom: number };

export type GapSources = {
  /** The line's box as the DOM has it; undefined when the line is not drawn. */
  measured(line: number): LineBox | undefined;
  /** The line's box as the height map has it (`documentTop + block`). */
  modelled(line: number): LineBox;
  /** Lines in the document. */
  lineCount: number;
  /** How far the height map is off on screen: measured minus modelled. */
  drift: number;
};

/**
 * How far the height map is off at a line that is drawn: positive when the
 * line sits lower on screen than the height map says. 0 when it is not drawn.
 */
export function driftAt(
  line: number,
  measured: (line: number) => LineBox | undefined,
  modelled: (line: number) => LineBox,
): number {
  const real = measured(line);
  return real ? real.top - modelled(line).top : 0;
}

/**
 * The viewport y of the gap before line `insertAt`: the top of that line, or
 * -- past the last line -- the bottom of the last one.
 */
export function gapY(insertAt: number, sources: GapSources): number {
  const { lineCount, drift } = sources;
  if (insertAt <= lineCount) {
    const line = Math.max(1, insertAt);
    return sources.measured(line)?.top ?? sources.modelled(line).top + drift;
  }
  return (
    sources.measured(lineCount)?.bottom ??
    sources.modelled(lineCount).bottom + drift
  );
}

/** The top of a 2px bar centred on a gap at `y`, so it never covers a line's text. */
export function dropLineTop(y: number, thickness = 2): number {
  return y - thickness / 2;
}
