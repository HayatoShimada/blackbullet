// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada
//
// The empty page a quick note opens on says what it is: a faint line where the
// text will go. It exists only while the page is empty and under `Inbox/`; the
// first keystroke removes it, and no other page ever shows it.
import type { EditorState, Extension } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import { isQuickNotePage } from "../quick_note_escape.ts";

/**
 * Every sentence is true on the page it appears on: a quick note is saved as it
 * is typed (the editor autosaves) and a plain Esc goes back to the page it was
 * opened from (`quick_note_escape.ts`).
 */
export const QUICK_NOTE_PLACEHOLDER =
  "Write it down. It is saved as you type. Esc goes back.";

/** Under a touch screen there is no Esc key: the same line without it. */
export const QUICK_NOTE_PLACEHOLDER_TOUCH =
  "Write it down. It is saved as you type.";

function placeholderText(): string {
  try {
    return globalThis.matchMedia?.("(pointer: coarse)").matches
      ? QUICK_NOTE_PLACEHOLDER_TOUCH
      : QUICK_NOTE_PLACEHOLDER;
  } catch {
    return QUICK_NOTE_PLACEHOLDER;
  }
}

/** The page the editor is on: asked each time, the editor state outlives navigation. */
export type PageName = () => string | undefined;

type Rect = { left: number; right: number; top: number; bottom: number };

/** The caret rectangle for the placeholder element: its left edge (right in rtl), at most one line tall. */
export function placeholderCoords(dom: HTMLElement): Rect | null {
  const text = dom.firstChild;
  if (!text) return null;
  const range = document.createRange();
  range.selectNodeContents(text);
  const first = range.getClientRects()[0];
  if (!first) return null;
  const style = getComputedStyle(dom.parentElement ?? dom);
  const rtl = style.direction === "rtl";
  const x = rtl ? first.right : first.left;
  const lineHeight = Number.parseInt(style.lineHeight, 10);
  const height = first.bottom - first.top;
  return {
    left: x,
    right: x,
    top: first.top,
    bottom:
      Number.isFinite(lineHeight) && height > lineHeight * 1.5
        ? first.top + lineHeight
        : first.bottom,
  };
}

class PlaceholderWidget extends WidgetType {
  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-placeholder sb-quick-note-placeholder";
    span.setAttribute("aria-hidden", "true");
    span.textContent = placeholderText();
    return span;
  }

  eq(other: WidgetType): boolean {
    return other instanceof PlaceholderWidget;
  }

  /**
   * Where the caret is drawn on the empty line. Without this CodeMirror asks its
   * height map, which does not count the page-top slot (the folder line on a
   * phone), and the caret lands above the placeholder. Same as its own
   * placeholder(): the start of the text, one line tall.
   */
  coordsAt(dom: HTMLElement): Rect | null {
    return placeholderCoords(dom);
  }

  ignoreEvent(): boolean {
    return false;
  }
}

const widget = Decoration.set([
  Decoration.widget({ widget: new PlaceholderWidget(), side: 1 }).range(0),
]);

/** The decoration set for a state: the placeholder, or nothing. Pure, so it can be tested without a view. */
export function quickNotePlaceholderDecorations(
  state: EditorState,
  pageName: PageName,
): DecorationSet {
  if (state.doc.length > 0) return Decoration.none;
  const name = pageName();
  return name !== undefined && isQuickNotePage(name) ? widget : Decoration.none;
}

/** The name of the page being edited, from the client the app puts on `globalThis`. */
function currentPageName(): string | undefined {
  try {
    return (
      globalThis as { client?: { currentName?: () => string } }
    ).client?.currentName?.();
  } catch {
    return undefined;
  }
}

export function quickNotePlaceholder(
  pageName: PageName = currentPageName,
): Extension {
  return [
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;

        constructor(view: EditorView) {
          this.decorations = quickNotePlaceholderDecorations(
            view.state,
            pageName,
          );
        }

        update(update: ViewUpdate) {
          if (update.docChanged || update.selectionSet) {
            this.decorations = quickNotePlaceholderDecorations(
              update.state,
              pageName,
            );
          }
        }
      },
      { decorations: (plugin) => plugin.decorations },
    ),
    // The widget is aria-hidden; the editor itself carries the hint, as CodeMirror's own
    // placeholder() does, so a screen reader announces what an empty quick note is for.
    EditorView.contentAttributes.compute(
      ["doc", "selection"],
      (state): Record<string, string> =>
        quickNotePlaceholderDecorations(state, pageName) === Decoration.none
          ? {}
          : { "aria-placeholder": placeholderText() },
    ),
    EditorView.baseTheme({
      ".cm-placeholder.sb-quick-note-placeholder": {
        color: "var(--sb-ink-3)",
        fontStyle: "normal",
        pointerEvents: "none",
        // one line, so the caret is one line tall and the text does not wrap
        display: "inline-block",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        maxWidth: "100%",
        verticalAlign: "top",
      },
    }),
  ];
}
