// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada

import { Fragment } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { Icon } from "../../../../plug-api/ui/icon.tsx";
import type { Anchor } from "../mediator/tree_mediator.ts";

export type MenuItem = {
  id: string;
  label: string;
  icon?: Element;
  /** A dim second part after the label. */
  description?: string;
  /** Leaves or cannot be undone: drawn last, in red. */
  danger?: boolean;
};

const GAP = 4;
const EDGE = 8;

/**
 * An anchored popover menu: a passive view of `items`. It owns nothing but
 * where it sits and which item has focus; every decision (what the items are,
 * what picking one does) bubbles up as `onPick` / `onClose`.
 *
 * The first item is focused on open, the arrow keys move, Esc and a press
 * outside close it. Without an `anchor` it opens centred, as a small picker.
 */
export function PopoverMenu({
  items,
  anchor,
  label,
  onPick,
  onClose,
}: {
  items: MenuItem[];
  anchor?: Anchor;
  label: string;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | undefined>(
    undefined,
  );

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const { offsetHeight: h, offsetWidth: w } = menu;
    if (!anchor) {
      setPos({
        top: Math.max(EDGE, Math.round(globalThis.innerHeight * 0.2)),
        left: Math.max(EDGE, (globalThis.innerWidth - w) / 2),
      });
      return;
    }
    const below = anchor.bottom + GAP;
    const top =
      below + h > globalThis.innerHeight - EDGE
        ? Math.max(EDGE, anchor.top - GAP - h)
        : below;
    const left = Math.max(
      EDGE,
      Math.min(anchor.right - w, globalThis.innerWidth - w - EDGE),
    );
    setPos({ top, left });
  }, [anchor, items.length]);

  // Hidden until placed, and a hidden element cannot take focus: so the
  // first item is focused once the menu is where it will stay.
  const placed = pos !== undefined;
  useEffect(() => {
    if (!placed) return;
    menuRef.current
      ?.querySelector<HTMLButtonElement>('[role="menuitem"]')
      ?.focus();
  }, [placed]);

  useEffect(() => {
    const onDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as HTMLElement;
      // The button that opened the menu closes it itself (a second press).
      // (The tree's `⋯` comes from the shared RowActions: `.sb-row-action`.)
      if (
        target.closest?.(
          ".sb-row-action, .sb-row-more, .sb-nav-new, .sb-nav-entry-points",
        )
      ) {
        return;
      }
      if (!menuRef.current?.contains(target)) onClose();
    };
    // A fixed menu would otherwise sit still while what it hangs off moved.
    const close = () => onClose();
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("touchstart", onDown, true);
    globalThis.addEventListener("scroll", close, true);
    globalThis.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("touchstart", onDown, true);
      globalThis.removeEventListener("scroll", close, true);
      globalThis.removeEventListener("resize", close);
    };
  }, [onClose]);

  const move = (delta: number, absolute = false) => {
    const buttons = [
      ...(menuRef.current?.querySelectorAll<HTMLButtonElement>(
        '[role="menuitem"]',
      ) ?? []),
    ];
    if (buttons.length === 0) return;
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = absolute
      ? delta < 0
        ? buttons.length - 1
        : 0
      : (at + delta + buttons.length) % buttons.length;
    buttons[next].focus();
  };

  const firstDanger = items.findIndex((item) => item.danger);
  const hasIcons = items.some((item) => item.icon);
  return (
    <div
      className="sb-dock-menu sb-popover sb-row-menu"
      role="menu"
      aria-label={label}
      ref={menuRef}
      // Hidden for the frame between mounting (which is what makes it
      // measurable) and being placed, so it never flashes at 0,0.
      style={
        pos
          ? { top: `${pos.top}px`, left: `${pos.left}px` }
          : { visibility: "hidden" }
      }
      onKeyDown={(e) => {
        if (e.key === "Escape" || e.key === "Tab") {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        } else if (e.key === "ArrowDown") {
          e.preventDefault();
          e.stopPropagation();
          move(1);
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          e.stopPropagation();
          move(-1);
        } else if (e.key === "Home" || e.key === "End") {
          e.preventDefault();
          e.stopPropagation();
          move(e.key === "Home" ? 1 : -1, true);
        }
      }}
    >
      {items.map((item, index) => (
        <Fragment key={item.id}>
          {index === firstDanger && index > 0 && (
            <div
              className="sb-dock-menu-separator sb-popover-separator"
              role="separator"
            />
          )}
          <button
            type="button"
            role="menuitem"
            className={
              "sb-dock-menu-item sb-popover-item" +
              (item.danger ? " sb-dock-menu-danger sb-popover-danger" : "")
            }
            onClick={(e) => {
              e.stopPropagation();
              onPick(item.id);
            }}
          >
            {item.icon ? (
              <Icon node={item.icon} class="sb-dock-menu-icon" />
            ) : (
              hasIcons && <span className="sb-dock-menu-icon" />
            )}
            <span className="sb-dock-menu-label">{item.label}</span>
            {item.description && (
              <span className="sb-dock-menu-description">
                {item.description}
              </span>
            )}
          </button>
        </Fragment>
      ))}
    </div>
  );
}
