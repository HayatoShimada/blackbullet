// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada
import type {
  Markup,
  MarkupSegmentItem,
} from "../editor_mode/mode_mediator.ts";

/**
 * The header's Styled | Code segment: Markdown marks hidden or shown. Draws
 * its props; a press is reported, never acted on here.
 */
export function MarkupSegment({
  items,
  onSelect,
}: {
  items: MarkupSegmentItem[];
  onSelect: (markup: Markup) => void;
}) {
  return (
    <div className="sb-segments sb-markup-segment" aria-label="Markdown marks">
      {items.map((item) => (
        <button
          type="button"
          key={item.markup}
          className={`sb-segment${item.active ? " sb-segment-active" : ""}`}
          aria-pressed={item.active}
          title={item.title}
          // Keep the editor's focus (and vim's mode) when it is clicked.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onSelect(item.markup)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
