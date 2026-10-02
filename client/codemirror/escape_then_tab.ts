// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada
import { completionStatus } from "@codemirror/autocomplete";
import { searchPanelOpen } from "@codemirror/search";
import { type Extension, Prec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

/** How long after Esc a Tab still leaves the editor. */
export const ESCAPE_THEN_TAB_MS = 2000;

/**
 * Arms tab-focus mode when `event` is an Esc that closed nothing. Returns
 * false so the event always goes on to the other handlers.
 */
export function armTabFocusOnEscape(
  event: Pick<KeyboardEvent, "key" | "defaultPrevented">,
  view: Pick<EditorView, "state" | "setTabFocusMode">,
): false {
  if (
    event.key === "Escape" &&
    !event.defaultPrevented &&
    completionStatus(view.state) === null &&
    !searchPanelOpen(view.state)
  ) {
    view.setTabFocusMode(ESCAPE_THEN_TAB_MS);
  }
  return false;
}

/**
 * Esc followed by Tab (or Shift-Tab) moves focus out of the editor, so a
 * keyboard user is never trapped in it. CodeMirror has this built in
 * (`setTabFocusMode`), but command key bindings consume Escape before its own
 * handler runs; this arms it from a handler that runs first and consumes
 * nothing. Esc that closes a completion list or the find panel does not arm it.
 */
export function escapeThenTab(): Extension {
  return Prec.highest(
    EditorView.domEventHandlers({ keydown: armTabFocusOnEscape }),
  );
}
