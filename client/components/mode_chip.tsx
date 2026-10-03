// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada
import { Eye, Lock } from "preact-feather";
import type { ModeChipView } from "../editor_mode/mode_mediator.ts";

/**
 * The editor's mode in the header: Edit / Preview, or vim's NORMAL / INSERT /
 * VISUAL. Draws its props; a press is reported, never acted on here.
 */
export function ModeChip({
  view,
  onActivate,
}: {
  view: ModeChipView;
  onActivate: () => void;
}) {
  const icon =
    view.label === "Read-only" ? (
      <Lock size={14} aria-hidden="true" />
    ) : view.label === "Preview" ? (
      <Eye size={14} aria-hidden="true" />
    ) : null;
  return (
    <button
      type="button"
      className={`sb-mode-chip sb-mode-${view.tone}`}
      title={view.title}
      aria-label={`Editor mode: ${view.label}`}
      aria-live="polite"
      disabled={view.disabled}
      // Keep the editor's focus (and vim's mode) when the chip is clicked.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onActivate}
    >
      {icon}
      <span>{view.label}</span>
    </button>
  );
}
