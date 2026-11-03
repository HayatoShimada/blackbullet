// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada
/**
 * Pointer drags on the timeline, turned into the Mediator's `tl.*` events: a
 * bar moved or stretched by days, a link pulled from a bar's handle to
 * another bar, a span drawn on the empty lane, an undated row dropped on a
 * day. Like `pointer_drag.ts`, a mouse drags at once and a touch after a
 * press-and-hold (a quick swipe still scrolls); the DOM is reached only
 * through the injected lookups, so it runs without one.
 */
import type { Edge } from "../../src/timeline.ts";
import type { DbEvent } from "./db_mediator.ts";
import { HOLD_MS, MOVE_THRESHOLD, type PointerLike } from "./pointer_drag.ts";

/** What a press took hold of. */
export type Grip =
  | { kind: "bar"; rowId: string; edge: Edge }
  | { kind: "link"; rowId: string }
  | { kind: "draw"; day: string }
  | { kind: "place"; rowId: string };

export type BarDragOptions = {
  emit(event: DbEvent): void;
  /** The width of a day now (the zoom may change between drags). */
  pxPerDay(): number;
  /** The day under a point on the grid, or null off it. */
  dayAt(x: number, y: number): string | null;
  /** The row whose bar is under a point, or null. */
  rowAt(x: number, y: number): string | null;
  onStart?(pointerId: number): void;
  onEnd?(pointerId: number): void;
  setTimer?(fn: () => void, ms: number): unknown;
  clearTimer?(handle: unknown): void;
};

export type BarDrag = {
  down(grip: Grip, p: PointerLike, ignore?: boolean): void;
  move(p: PointerLike): void;
  up(p: PointerLike): void;
  cancel(): void;
  dragging(): boolean;
  /** True once after a drag ends: the click that follows it is not a click. */
  consumeClick(): boolean;
};

export function createBarDrag(opts: BarDragOptions): BarDrag {
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer =
    opts.clearTimer ??
    ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  let phase: "idle" | "pending" | "dragging" = "idle";
  let grip: Grip | null = null;
  let pointer = -1;
  let startX = 0;
  let startY = 0;
  let lastDay: string | null = null;
  let timer: unknown;
  let clicked = false;

  const begin = () => {
    if (!grip) return;
    phase = "dragging";
    if (grip.kind === "bar")
      opts.emit({ type: "tl.bar.drag", rowId: grip.rowId, edge: grip.edge });
    else if (grip.kind === "link")
      opts.emit({ type: "tl.link.start", rowId: grip.rowId });
    else if (grip.kind === "draw") {
      lastDay = grip.day;
      opts.emit({ type: "tl.draw.start", day: grip.day });
    } else opts.emit({ type: "tl.place.drag", rowId: grip.rowId });
    opts.onStart?.(pointer);
  };
  const reset = () => {
    if (timer !== undefined) clearTimer(timer);
    timer = undefined;
    phase = "idle";
  };
  const end = () => {
    const id = pointer;
    reset();
    grip = null;
    opts.onEnd?.(id);
  };
  /** Where the drag is now, as the Mediator hears it. */
  const over = (p: PointerLike) => {
    if (!grip) return;
    if (grip.kind === "bar") {
      const delta = Math.round((p.clientX - startX) / opts.pxPerDay()) || 0;
      opts.emit({ type: "tl.bar.over", delta });
    } else if (grip.kind === "link") {
      opts.emit({
        type: "tl.link.over",
        target: opts.rowAt(p.clientX, p.clientY),
      });
    } else if (grip.kind === "draw") {
      const day = opts.dayAt(p.clientX, p.clientY) ?? lastDay;
      if (day) {
        lastDay = day;
        opts.emit({ type: "tl.draw.over", day });
      }
    } else {
      opts.emit({
        type: "tl.place.over",
        day: opts.dayAt(p.clientX, p.clientY),
      });
    }
  };

  return {
    down(g, p, ignore = false) {
      clicked = false;
      if (phase !== "idle" || ignore) return;
      if (p.pointerType === "mouse" && (p.button ?? 0) !== 0) return;
      phase = "pending";
      grip = g;
      pointer = p.pointerId;
      startX = p.clientX;
      startY = p.clientY;
      if (p.pointerType !== "mouse") {
        timer = setTimer(() => {
          timer = undefined;
          if (phase === "pending") begin();
        }, HOLD_MS);
      }
    },
    move(p) {
      if (p.pointerId !== pointer || phase === "idle") return;
      if (phase === "pending") {
        const far =
          Math.hypot(p.clientX - startX, p.clientY - startY) > MOVE_THRESHOLD;
        if (!far) return;
        if (p.pointerType === "mouse") begin();
        else {
          reset();
          return;
        }
      }
      over(p);
    },
    up(p) {
      if (p.pointerId !== pointer || phase === "idle") return;
      if (phase === "dragging" && grip) {
        over(p);
        const kind = grip.kind;
        opts.emit(
          kind === "bar"
            ? { type: "tl.bar.drop" }
            : kind === "link"
              ? { type: "tl.link.drop" }
              : kind === "draw"
                ? { type: "tl.draw.drop" }
                : { type: "tl.place.drop" },
        );
        clicked = true;
        end();
      } else reset();
    },
    cancel() {
      if (phase === "dragging") {
        opts.emit({ type: "tl.cancel" });
        clicked = true;
        end();
      } else reset();
    },
    dragging: () => phase === "dragging",
    consumeClick() {
      const was = clicked;
      clicked = false;
      return was;
    },
  };
}
