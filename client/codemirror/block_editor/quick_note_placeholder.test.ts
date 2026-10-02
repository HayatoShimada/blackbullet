// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  QUICK_NOTE_PLACEHOLDER,
  QUICK_NOTE_PLACEHOLDER_TOUCH,
  placeholderCoords,
  quickNotePlaceholder,
  quickNotePlaceholderDecorations,
} from "./quick_note_placeholder.ts";

function count(doc: string, page: string | undefined): number {
  const set = quickNotePlaceholderDecorations(
    EditorState.create({ doc }),
    () => page,
  );
  let n = 0;
  const iter = set.iter();
  while (iter.value) {
    n++;
    iter.next();
  }
  return n;
}

describe("quick note placeholder", () => {
  test("shows on an empty page under Inbox/", () => {
    expect(count("", "Inbox/2026-10-02/11-17-18")).toBe(1);
    expect(count("", "Inbox/note")).toBe(1);
  });

  test("goes at the first keystroke", () => {
    expect(count("a", "Inbox/2026-10-02/11-17-18")).toBe(0);
    expect(count(" ", "Inbox/note")).toBe(0);
  });

  test("never shows on any other page", () => {
    for (const page of [
      "index",
      "Projects/Spring Launch",
      "Journal/2026-10-02",
      "Inboxes/x",
      "Notes/Inbox/x",
      "Inbox",
      undefined,
      "",
    ]) {
      expect(count("", page), String(page)).toBe(0);
    }
  });

  test("says only what is true: autosave and Esc going back", () => {
    expect(QUICK_NOTE_PLACEHOLDER).toBe(
      "Write it down. It is saved as you type. Esc goes back.",
    );
  });

  test("a touch screen gets the line without Esc", () => {
    expect(QUICK_NOTE_PLACEHOLDER_TOUCH).toBe(
      "Write it down. It is saved as you type.",
    );
    expect(QUICK_NOTE_PLACEHOLDER_TOUCH).not.toMatch(/Esc/);
  });
});

describe("quick note placeholder, for screen readers", () => {
  function hint(doc: string, page: string): string | undefined {
    const state = EditorState.create({
      doc,
      extensions: quickNotePlaceholder(() => page),
    });
    const attrs = state.facet(EditorView.contentAttributes);
    for (const a of attrs) {
      const value = typeof a === "function" ? undefined : a["aria-placeholder"];
      if (value) return value;
    }
    return undefined;
  }

  test("an empty quick note announces what it is for; nothing else does", () => {
    expect(hint("", "Inbox/note")).toMatch(/^Write it down/);
    expect(hint("a", "Inbox/note")).toBeUndefined();
    expect(hint("", "index")).toBeUndefined();
  });
});

describe("quick note placeholder, caret position", () => {
  afterEach(() => vi.unstubAllGlobals());

  // The caret on the empty line is drawn from these coordinates, not from the
  // height map (which does not count the page-top folder line on a phone).
  function stub(
    rects: { left: number; right: number; top: number; bottom: number }[],
    style: { direction: string; lineHeight: string },
  ): HTMLElement {
    vi.stubGlobal("document", {
      createRange: () => ({
        selectNodeContents: () => {},
        getClientRects: () => rects,
      }),
    });
    vi.stubGlobal("getComputedStyle", () => style);
    return { firstChild: {}, parentElement: {} } as unknown as HTMLElement;
  }

  const ltr = { direction: "ltr", lineHeight: "27px" };

  test("is the left edge of the text, on the line the text is on", () => {
    const dom = stub([{ left: 16, right: 300, top: 103, bottom: 130 }], ltr);
    expect(placeholderCoords(dom)).toEqual({
      left: 16,
      right: 16,
      top: 103,
      bottom: 130,
    });
  });

  test("is the right edge in a right-to-left page", () => {
    const dom = stub([{ left: 16, right: 300, top: 103, bottom: 130 }], {
      direction: "rtl",
      lineHeight: "27px",
    });
    expect(placeholderCoords(dom)?.left).toBe(300);
  });

  test("is one line tall when the text wraps", () => {
    const dom = stub([{ left: 16, right: 300, top: 103, bottom: 184 }], ltr);
    expect(placeholderCoords(dom)).toMatchObject({ top: 103, bottom: 130 });
  });

  test("is null when nothing is drawn", () => {
    expect(placeholderCoords(stub([], ltr))).toBeNull();
    expect(
      placeholderCoords({ firstChild: null } as unknown as HTMLElement),
    ).toBeNull();
  });
});
