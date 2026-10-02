// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada

import { EditorState } from "@codemirror/state";
import { expect, test, vi } from "vitest";
import { armTabFocusOnEscape, ESCAPE_THEN_TAB_MS } from "./escape_then_tab.ts";

function fakeView() {
  return {
    state: EditorState.create({ doc: "text" }),
    setTabFocusMode: vi.fn(),
  };
}

test("Escape arms tab-focus mode and never consumes the event", () => {
  const view = fakeView();
  expect(
    armTabFocusOnEscape({ key: "Escape", defaultPrevented: false }, view),
  ).toBe(false);
  expect(view.setTabFocusMode).toHaveBeenCalledWith(ESCAPE_THEN_TAB_MS);
});

test("other keys and already-handled Escapes do not arm it", () => {
  const view = fakeView();
  armTabFocusOnEscape({ key: "Tab", defaultPrevented: false }, view);
  armTabFocusOnEscape({ key: "Escape", defaultPrevented: true }, view);
  expect(view.setTabFocusMode).not.toHaveBeenCalled();
});
