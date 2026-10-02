// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import type { Rect } from "../mediator/db_mediator.ts";
import {
  FRAME_BOTTOM_PULL,
  type Placement,
  placePopover,
} from "../mediator/popover_place.ts";

export type PopoverItem =
  | "separator"
  | {
      label: string;
      onSelect: () => void;
      danger?: boolean;
      disabled?: boolean;
    };

/**
 * The one menu of the view (`.sb-popover`, the shell the tree and the graph
 * share): fixed, hanging from the button that opened it, right-aligned to it
 * and flipped above it near the bottom (`placePopover` decides; this only
 * measures and draws). The first item is focused; Esc, Tab and a press
 * outside close it by telling the Mediator, and whichever way it closes,
 * focus goes back to the button that opened it unless something else took it.
 *
 * Rule note (Passive View): the keyboard roving (Arrow/Home/End), the focus
 * return and the frame growth act on focus and geometry only, which the
 * Mediator cannot see from the sandbox; they never decide what a menu item
 * does. The close and every item's action still go through `emit`.
 */
export function Popover({
  anchor,
  label,
  items,
  onClose,
}: {
  anchor?: Rect;
  label: string;
  items: PopoverItem[];
  onClose: () => void;
}) {
  const el = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  const [placed, setPlaced] = useState<Placement | null>(null);

  // Measure before paint; `placePopover` answers.
  useLayoutEffect(() => {
    const menu = el.current;
    if (!menu) return;
    const { width, height } = menu.getBoundingClientRect();
    const next = placePopover(
      anchor,
      { width, height },
      {
        width: document.documentElement.clientWidth,
        height: window.innerHeight - FRAME_BOTTOM_PULL,
      },
    );
    setPlaced(next);
    // The frame grows so a menu with no room either side is not clipped.
    if (next.needed > 0) document.body.style.minHeight = `${next.needed}px`;
    return () => {
      document.body.style.minHeight = "";
    };
  }, [anchor?.left, anchor?.top, anchor?.right, anchor?.bottom]);

  useEffect(() => {
    const menu = el.current;
    const opener = document.activeElement as HTMLElement | null;
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close.current();
      }
    };
    const down = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (menu?.contains(t)) return;
      // The button that opened it toggles it itself.
      if (t?.closest("[data-popover-trigger]")) return;
      close.current();
    };
    const away = () => close.current();
    document.addEventListener("keydown", key);
    document.addEventListener("pointerdown", down, true);
    window.addEventListener("blur", away);
    return () => {
      // Back to the opener, unless the pointer or an action put focus
      // somewhere else on purpose (an input, the host's dialog).
      const now = document.activeElement;
      if (
        opener?.isConnected &&
        (!now || now === document.body || menu?.contains(now))
      ) {
        opener.focus?.();
      }
      document.removeEventListener("keydown", key);
      document.removeEventListener("pointerdown", down, true);
      window.removeEventListener("blur", away);
    };
  }, []);

  // The first item takes focus once the menu is placed: a hidden element
  // cannot be focused, and it is hidden until `placePopover` has answered.
  const shown = placed !== null;
  useEffect(() => {
    if (shown) {
      el.current
        ?.querySelector<HTMLElement>("[role=menuitem]:not(:disabled)")
        ?.focus();
    }
  }, [shown]);

  const move = (e: KeyboardEvent) => {
    const all = [
      ...(el.current?.querySelectorAll<HTMLElement>(
        "[role=menuitem]:not(:disabled)",
      ) ?? []),
    ];
    const at = all.indexOf(document.activeElement as HTMLElement);
    let next = -1;
    if (e.key === "ArrowDown") next = (at + 1) % all.length;
    else if (e.key === "ArrowUp") next = (at - 1 + all.length) % all.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = all.length - 1;
    else if (e.key === "Tab") {
      close.current();
      return;
    }
    if (next >= 0) {
      e.preventDefault();
      all[next]?.focus();
    }
  };

  return (
    <div
      ref={el}
      class="sb-popover db-popover"
      role="menu"
      aria-label={label}
      style={{
        visibility: placed ? "visible" : "hidden",
        left: placed?.left ?? 0,
        top: placed?.top ?? 0,
      }}
      onKeyDown={move}
    >
      {items.map((item, i) =>
        item === "separator" ? (
          <hr key={`s${i}`} class="sb-popover-separator" />
        ) : (
          <button
            key={item.label}
            type="button"
            role="menuitem"
            class={`sb-popover-item${item.danger ? " sb-popover-danger" : ""}`}
            disabled={item.disabled}
            onClick={item.onSelect}
          >
            {item.label}
          </button>
        ),
      )}
    </div>
  );
}

/** Where a button sits, for a popover to hang from. */
export const rectOf = (el: Element): Rect => {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
};
