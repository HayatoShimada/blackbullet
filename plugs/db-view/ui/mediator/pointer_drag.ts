/**
 * Moving a card with a pointer: a mouse drag, or a press-and-hold then drag on
 * touch (a quick swipe is still a scroll). It turns pointer events into the
 * Mediator's `card.*` events, so the board and the calendar work on a phone,
 * where HTML5 drag-and-drop does not. The DOM is reached only through the
 * injected `targetAt` and the lifecycle callbacks, so it runs without one.
 */
import type { DbEvent } from "./db_mediator.ts";

export type PointerLike = {
  pointerId: number;
  pointerType: string;
  clientX: number;
  clientY: number;
  button?: number;
};

export type PointerDrag = {
  /** A press on a card; `ignore` when it landed on a button or input. */
  down(rowId: string, p: PointerLike, ignore?: boolean): void;
  move(p: PointerLike): void;
  up(p: PointerLike): void;
  cancel(): void;
  /** Whether a drag started: the pointer is captured and must not scroll. */
  dragging(): boolean;
  /** True once after a drag ends: the click that follows it is not a click. */
  consumeClick(): boolean;
};

export type PointerDragOptions = {
  emit(event: DbEvent): void;
  /** The drop target (column key, ISO day, "") under a point, or null. */
  targetAt(x: number, y: number): string | null;
  /** The drag began / ended: capture the pointer, block touch scrolling. */
  onStart?(pointerId: number): void;
  onEnd?(pointerId: number): void;
  setTimer?(fn: () => void, ms: number): unknown;
  clearTimer?(handle: unknown): void;
};

export const MOVE_THRESHOLD = 6;
export const HOLD_MS = 250;

export function createPointerDrag(opts: PointerDragOptions): PointerDrag {
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer =
    opts.clearTimer ??
    ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  let phase: "idle" | "pending" | "dragging" = "idle";
  let rowId = "";
  let pointer = -1;
  let startX = 0;
  let startY = 0;
  let timer: unknown;
  let clicked = false;

  const begin = () => {
    phase = "dragging";
    opts.emit({ type: "card.drag", rowId });
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
    opts.onEnd?.(id);
  };

  return {
    down(id, p, ignore = false) {
      clicked = false;
      if (phase !== "idle" || ignore) return;
      if (p.pointerType === "mouse" && (p.button ?? 0) !== 0) return;
      phase = "pending";
      rowId = id;
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
        // Moving before the hold is up is a scroll on touch; a drag with a mouse.
        if (p.pointerType === "mouse") begin();
        else {
          reset();
          return;
        }
      }
      opts.emit({
        type: "card.over",
        target: opts.targetAt(p.clientX, p.clientY),
      });
    },
    up(p) {
      if (p.pointerId !== pointer || phase === "idle") return;
      if (phase === "dragging") {
        const target = opts.targetAt(p.clientX, p.clientY);
        opts.emit(
          target === null
            ? { type: "card.cancel" }
            : { type: "card.drop", target },
        );
        clicked = true;
        end();
      } else reset();
    },
    cancel() {
      if (phase === "dragging") {
        opts.emit({ type: "card.cancel" });
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

/** The drop target an element sits in: its nearest `data-drop`, or null. */
export function dropTargetOf(
  el: {
    closest(
      selector: string,
    ): { getAttribute(name: string): string | null } | null;
  } | null,
): string | null {
  return el?.closest("[data-drop]")?.getAttribute("data-drop") ?? null;
}
