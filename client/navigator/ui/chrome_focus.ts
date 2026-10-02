// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada
//
// Esc then Tab: a keyboard user who leaves the editor with Esc lands on the
// first control of the top bar, not on whatever happens to follow the editor
// in the page (a view's filter box, a widget button). The editor itself only
// releases Tab (`escape_then_tab.ts`); where focus goes next is the chrome's
// decision, made here.

/** How long after Esc a Tab still goes to the chrome. */
export const ESCAPE_THEN_TAB_WINDOW_MS = 2000;

const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta"]);

type KeyEvent = Pick<
  KeyboardEvent,
  | "key"
  | "shiftKey"
  | "ctrlKey"
  | "altKey"
  | "metaKey"
  | "isComposing"
  | "defaultPrevented"
>;

export type EscapeTabDeps = {
  now: () => number;
  /** Whether the key went to the editor's text. */
  inEditor: () => boolean;
  /** An autocomplete list or the find panel is open: Esc closes that instead. */
  editorBusy: () => boolean;
  /** Moves focus to the first top-bar control; false when there is none. */
  focusChrome: () => boolean;
};

/**
 * The Esc-then-Tab rule as a small state machine: Esc in the editor (closing
 * nothing) arms it, a plain Tab inside the window disarms it and sends focus to
 * the chrome, any other key disarms it. Returns true when it handled the key,
 * so the caller stops the event.
 */
export function createEscapeThenTab(deps: EscapeTabDeps) {
  let armedAt: number | undefined;
  return (event: KeyEvent): boolean => {
    if (event.isComposing || MODIFIER_KEYS.has(event.key)) return false;
    if (!deps.inEditor()) {
      armedAt = undefined;
      return false;
    }
    if (event.key === "Escape") {
      armedAt =
        event.defaultPrevented || deps.editorBusy() ? undefined : deps.now();
      return false;
    }
    const armed =
      armedAt !== undefined &&
      deps.now() - armedAt <= ESCAPE_THEN_TAB_WINDOW_MS;
    armedAt = undefined;
    if (
      !armed ||
      event.key !== "Tab" ||
      event.shiftKey ||
      event.ctrlKey ||
      event.altKey ||
      event.metaKey
    ) {
      return false;
    }
    return deps.focusChrome();
  };
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const TITLE_FIELD = "input.sb-page-name-editor";

/**
 * The first control in the top bar that is on screen (the dock buttons are not,
 * on a desktop). Never the title field: focused, it swaps the title for the raw
 * path and takes the next keystroke as an edit of the page's name.
 */
export function firstChromeControl(root: ParentNode): HTMLElement | undefined {
  const top = root.querySelector("#sb-top");
  if (!top) return undefined;
  for (const element of top.querySelectorAll<HTMLElement>(FOCUSABLE)) {
    if (element.matches(TITLE_FIELD)) continue;
    if (element.getClientRects().length > 0) return element;
  }
  return undefined;
}

/** Wires the rule to the page; returns the function that removes it. */
export function installEscapeThenTab(doc: Document): () => void {
  let target: EventTarget | null = null;
  const handle = createEscapeThenTab({
    now: () => Date.now(),
    inEditor: () =>
      target instanceof Element && target.closest(".cm-content") !== null,
    editorBusy: () =>
      doc.querySelector(".cm-tooltip-autocomplete, .cm-panel.cm-search") !==
      null,
    focusChrome: () => {
      const control = firstChromeControl(doc);
      control?.focus();
      return control !== undefined && doc.activeElement === control;
    },
  });
  const onKeyDown = (event: KeyboardEvent) => {
    target = event.target;
    if (handle(event)) {
      event.preventDefault();
      event.stopPropagation();
    }
  };
  // Capture: the editor's own key handlers run later and would take the Tab.
  doc.addEventListener("keydown", onKeyDown, true);
  return () => doc.removeEventListener("keydown", onKeyDown, true);
}
