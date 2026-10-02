// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada
import { completionStatus } from "@codemirror/autocomplete";
import { searchPanelOpen } from "@codemirror/search";
import { type Extension, Prec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

/** Quick notes (and what the MCP `add_inbox` tool writes) live under here. */
export const QUICK_NOTE_PREFIX = "Inbox/";

export function isQuickNotePage(pageName: string): boolean {
  return pageName.startsWith(QUICK_NOTE_PREFIX);
}

/**
 * What a quick note's placeholder promises: "Esc goes back". On a page under
 * `Inbox/`, a plain Esc that closes nothing returns to the page the note was
 * opened from. The note is already saved as it is typed.
 */
export function goBackOnEscape(
  event: Pick<
    KeyboardEvent,
    | "key"
    | "defaultPrevented"
    | "isComposing"
    | "ctrlKey"
    | "altKey"
    | "metaKey"
    | "shiftKey"
  >,
  view: Pick<EditorView, "state">,
  page: { name: () => string; back: () => boolean },
): boolean {
  if (
    event.key !== "Escape" ||
    event.defaultPrevented ||
    event.isComposing ||
    event.ctrlKey ||
    event.altKey ||
    event.metaKey ||
    event.shiftKey ||
    completionStatus(view.state) !== null ||
    searchPanelOpen(view.state) ||
    !isQuickNotePage(page.name())
  ) {
    return false;
  }
  return page.back();
}

export function quickNoteEscape(page: {
  name: () => string;
  back: () => boolean;
}): Extension {
  return Prec.highest(
    EditorView.domEventHandlers({
      keydown(event, view) {
        if (!goBackOnEscape(event, view, page)) return false;
        event.preventDefault();
        return true;
      },
    }),
  );
}
