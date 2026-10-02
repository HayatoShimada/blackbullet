// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada

import { EditorState } from "@codemirror/state";
import { expect, test, vi } from "vitest";
import { goBackOnEscape, isQuickNotePage } from "./quick_note_escape.ts";

const view = { state: EditorState.create({ doc: "text" }) };
const esc = {
  key: "Escape",
  defaultPrevented: false,
  isComposing: false,
  ctrlKey: false,
  altKey: false,
  metaKey: false,
  shiftKey: false,
};
const page = (name: string, back = true) => ({
  name: () => name,
  back: vi.fn(() => back),
});

test("only pages under Inbox/ are quick notes", () => {
  expect(isQuickNotePage("Inbox/2026-10-02/11-17-18")).toBe(true);
  expect(isQuickNotePage("Inbox")).toBe(false);
  expect(isQuickNotePage("Projects/Inbox/x")).toBe(false);
});

test("Esc on a quick note goes back and reports it handled", () => {
  const p = page("Inbox/2026-10-02/11-17-18");
  expect(goBackOnEscape(esc, view, p)).toBe(true);
  expect(p.back).toHaveBeenCalledOnce();
});

test("Esc is left alone when there is nowhere to go back to", () => {
  const p = page("Inbox/2026-10-02/11-17-18", false);
  expect(goBackOnEscape(esc, view, p)).toBe(false);
});

test("Esc on any other page, other keys, modified or composing Esc do nothing", () => {
  const other = page("Projects/Spring Launch");
  expect(goBackOnEscape(esc, view, other)).toBe(false);
  const note = page("Inbox/a");
  expect(goBackOnEscape({ ...esc, key: "Tab" }, view, note)).toBe(false);
  expect(goBackOnEscape({ ...esc, shiftKey: true }, view, note)).toBe(false);
  expect(goBackOnEscape({ ...esc, isComposing: true }, view, note)).toBe(false);
  expect(goBackOnEscape({ ...esc, defaultPrevented: true }, view, note)).toBe(
    false,
  );
  expect(note.back).not.toHaveBeenCalled();
  expect(other.back).not.toHaveBeenCalled();
});
