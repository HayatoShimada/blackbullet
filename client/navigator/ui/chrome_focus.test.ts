// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada

import { expect, test, vi } from "vitest";
import {
  createEscapeThenTab,
  ESCAPE_THEN_TAB_WINDOW_MS,
  firstChromeControl,
} from "./chrome_focus.ts";

const key = (name: string, extra: Record<string, boolean> = {}) => ({
  key: name,
  shiftKey: false,
  ctrlKey: false,
  altKey: false,
  metaKey: false,
  isComposing: false,
  defaultPrevented: false,
  ...extra,
});

function setup(over: { inEditor?: boolean; busy?: boolean } = {}) {
  let clock = 1000;
  const state = { inEditor: over.inEditor ?? true, busy: over.busy ?? false };
  const focusChrome = vi.fn(() => true);
  const handle = createEscapeThenTab({
    now: () => clock,
    inEditor: () => state.inEditor,
    editorBusy: () => state.busy,
    focusChrome,
  });
  return {
    handle,
    focusChrome,
    state,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

test("Esc then Tab in the editor sends focus to the chrome and consumes the Tab", () => {
  const t = setup();
  expect(t.handle(key("Escape"))).toBe(false);
  expect(t.handle(key("Tab"))).toBe(true);
  expect(t.focusChrome).toHaveBeenCalledTimes(1);
});

test("Tab without a preceding Esc is left to the editor", () => {
  const t = setup();
  expect(t.handle(key("Tab"))).toBe(false);
  expect(t.focusChrome).not.toHaveBeenCalled();
});

test("it works once: the next Tab is ordinary again", () => {
  const t = setup();
  t.handle(key("Escape"));
  t.handle(key("Tab"));
  expect(t.handle(key("Tab"))).toBe(false);
  expect(t.focusChrome).toHaveBeenCalledTimes(1);
});

test("typing between Esc and Tab, or waiting too long, disarms it", () => {
  const typed = setup();
  typed.handle(key("Escape"));
  typed.handle(key("a"));
  expect(typed.handle(key("Tab"))).toBe(false);

  const slow = setup();
  slow.handle(key("Escape"));
  slow.advance(ESCAPE_THEN_TAB_WINDOW_MS + 1);
  expect(slow.handle(key("Tab"))).toBe(false);
  expect(slow.focusChrome).not.toHaveBeenCalled();
});

test("a modifier key alone does not disarm it; Shift-Tab and chords are not it", () => {
  const t = setup();
  t.handle(key("Escape"));
  t.handle(key("Shift"));
  expect(t.handle(key("Tab", { shiftKey: true }))).toBe(false);
  t.handle(key("Escape"));
  expect(t.handle(key("Tab", { ctrlKey: true }))).toBe(false);
  expect(t.focusChrome).not.toHaveBeenCalled();
});

test("an Esc that closes something (completion, find panel, handled) does not arm it", () => {
  const busy = setup({ busy: true });
  busy.handle(key("Escape"));
  expect(busy.handle(key("Tab"))).toBe(false);

  const handled = setup();
  handled.handle(key("Escape", { defaultPrevented: true }));
  expect(handled.handle(key("Tab"))).toBe(false);
});

test("keys outside the editor never arm or fire it", () => {
  const t = setup({ inEditor: false });
  t.handle(key("Escape"));
  expect(t.handle(key("Tab"))).toBe(false);
  expect(t.focusChrome).not.toHaveBeenCalled();
});

test("when the chrome has nothing to focus the Tab is left alone", () => {
  const t = setup();
  t.focusChrome.mockReturnValue(false);
  t.handle(key("Escape"));
  expect(t.handle(key("Tab"))).toBe(false);
});

test("the first chrome control is the first visible focusable in the top bar", () => {
  const rect = (visible: boolean, title = false) => ({
    getClientRects: () => (visible ? [{}] : []),
    matches: () => title,
  });
  const hidden = rect(false);
  const title = rect(true, true);
  const input = rect(true);
  const root = {
    querySelector: (sel: string) =>
      sel === "#sb-top"
        ? { querySelectorAll: () => [hidden, title, input, rect(true)] }
        : null,
  };
  // The title field is skipped: focusing it would show the raw path.
  expect(firstChromeControl(root as never)).toBe(input);
  expect(firstChromeControl({ querySelector: () => null } as never)).toBe(
    undefined,
  );
});
