// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada
import { describe, expect, test } from "vitest";
import {
  chipView,
  type EditorModeEvent,
  type EditorModeState,
  initialState,
  markupSegmentView,
  transition,
} from "./mode_mediator.ts";

const vimNormal: EditorModeState = { ...initialState, vim: true };

function run(state: EditorModeState, ...events: EditorModeEvent[]) {
  const effects = [];
  for (const event of events) {
    const next = transition(state, event);
    state = next.state;
    effects.push(...next.effects);
  }
  return { state, effects };
}

describe("Esc steps out one level at a time", () => {
  test("Insert → Normal is vim's own; Normal → Preview is ours", () => {
    const insert = run(vimNormal, { type: "vim.modeChanged", mode: "insert" });
    expect(insert.state.vimMode).toBe("insert");
    // vim reports the Esc that leaves Insert as a mode change
    const normal = run(insert.state, {
      type: "vim.modeChanged",
      mode: "normal",
    });
    expect(normal.state).toEqual(vimNormal);
    expect(normal.effects).toEqual([]);
    const preview = run(normal.state, { type: "key.escape" });
    expect(preview.state.surface).toBe("preview");
    expect(preview.effects).toEqual([{ type: "setPreview", on: true }]);
  });

  test("Esc in Preview lets the next Tab leave the editor", () => {
    const preview = { ...vimNormal, surface: "preview" as const };
    expect(transition(preview, { type: "key.escape" })).toEqual({
      state: preview,
      effects: [{ type: "armTabFocus" }],
    });
  });

  test("Esc outside Normal, or without vim, does not switch", () => {
    const visual = run(vimNormal, { type: "vim.modeChanged", mode: "visual" });
    expect(run(visual.state, { type: "key.escape" }).effects).toEqual([]);
    expect(run(initialState, { type: "key.escape" }).effects).toEqual([]);
  });
});

describe("keys that start typing leave Preview", () => {
  const preview = { ...vimNormal, surface: "preview" as const };

  test("i comes back to Edit and runs in vim", () => {
    const { state, effects } = run(preview, { type: "key.edit", key: "i" });
    expect(state.surface).toBe("edit");
    expect(effects).toEqual([{ type: "setPreview", on: false, then: "i" }]);
  });

  test("Enter comes back in Normal", () => {
    const { state, effects } = run(preview, {
      type: "key.edit",
      key: "Enter",
    });
    expect(state).toEqual(vimNormal);
    expect(effects).toEqual([{ type: "setPreview", on: false }]);
  });

  test("in Edit they are vim's", () => {
    expect(run(vimNormal, { type: "key.edit", key: "i" }).effects).toEqual([]);
  });
});

describe("the chip, the command and :preview / :edit", () => {
  test("toggle goes both ways, with or without vim", () => {
    const there = run(initialState, { type: "toggle" });
    expect(there.state.surface).toBe("preview");
    const back = run(there.state, { type: "toggle" });
    expect(back.state.surface).toBe("edit");
    expect(back.effects).toEqual([{ type: "setPreview", on: false }]);
  });

  test("set to where it already is does nothing", () => {
    expect(run(vimNormal, { type: "set", surface: "edit" }).effects).toEqual(
      [],
    );
    expect(
      run(vimNormal, { type: "set", surface: "preview" }).state.surface,
    ).toBe("preview");
  });
});

describe("a locked page stays read-only", () => {
  const locked = run(vimNormal, {
    type: "sync",
    vim: true,
    preview: false,
    locked: true,
    code: false,
  }).state;

  test("it shows as Preview and nothing moves it", () => {
    expect(locked.surface).toBe("preview");
    for (const event of [
      { type: "toggle" },
      { type: "set", surface: "edit" },
      { type: "key.edit", key: "i" },
    ] as EditorModeEvent[]) {
      expect(transition(locked, event).effects).toEqual([]);
    }
    expect(chipView(locked)).toMatchObject({
      label: "Read-only",
      disabled: true,
    });
  });
});

describe("sync follows options set elsewhere", () => {
  test("Preview turned on by a library is drawn as Preview", () => {
    const { state, effects } = run(initialState, {
      type: "sync",
      vim: false,
      preview: true,
      locked: false,
      code: false,
    });
    expect(state.surface).toBe("preview");
    expect(effects).toEqual([]);
  });

  test("an unchanged sync keeps the same state object", () => {
    const sync = {
      type: "sync",
      vim: true,
      preview: false,
      locked: false,
      code: false,
    } as const;
    expect(transition(vimNormal, sync).state).toBe(vimNormal);
  });

  test("vim turned off forgets its mode", () => {
    const insert = { ...vimNormal, vimMode: "insert" as const };
    const { state } = run(insert, {
      type: "sync",
      vim: false,
      preview: false,
      locked: false,
      code: false,
    });
    expect(state).toEqual(initialState);
  });
});

describe("chip labels", () => {
  test("without vim: Edit and Preview", () => {
    expect(chipView(initialState, "Ctrl-Alt-p")).toEqual({
      label: "Edit",
      tone: "outline",
      title: "Edit · click for Preview · Ctrl-Alt-p",
      disabled: false,
    });
    expect(chipView({ ...initialState, surface: "preview" }).label).toBe(
      "Preview",
    );
  });

  test("with vim: the vim mode, and V-LINE / V-BLOCK for visual", () => {
    const label = (s: Partial<EditorModeState>) =>
      chipView({ ...vimNormal, ...s }).label;
    expect(label({})).toBe("NORMAL");
    expect(label({ vimMode: "insert" })).toBe("INSERT");
    expect(label({ vimMode: "visual" })).toBe("VISUAL");
    expect(label({ vimMode: "visual", vimSub: "linewise" })).toBe("V-LINE");
    expect(label({ vimMode: "visual", vimSub: "blockwise" })).toBe("V-BLOCK");
    expect(label({ vimMode: "replace" })).toBe("REPLACE");
    expect(label({ surface: "preview", vimMode: "insert" })).toBe("Preview");
  });

  test("the tooltip names the next step", () => {
    expect(chipView(vimNormal).title).toBe("NORMAL · Esc for Preview");
    expect(chipView({ ...vimNormal, vimMode: "insert" }).title).toBe(
      "INSERT · Esc for NORMAL",
    );
  });
});

describe("Styled | Code", () => {
  test("the segment and the toggle switch and keep it", () => {
    const code = run(vimNormal, { type: "markup.set", markup: "code" });
    expect(code.state.markup).toBe("code");
    expect(code.effects).toEqual([{ type: "setMarkup", code: true }]);
    const styled = run(code.state, { type: "markup.toggle" });
    expect(styled.state).toEqual(vimNormal);
    expect(styled.effects).toEqual([{ type: "setMarkup", code: false }]);
  });

  test("the side already shown does nothing", () => {
    expect(
      transition(vimNormal, { type: "markup.set", markup: "styled" }),
    ).toEqual({ state: vimNormal, effects: [] });
  });

  test("it leaves Edit / Preview and vim alone, and works when locked", () => {
    const insert = { ...vimNormal, vimMode: "insert" as const };
    expect(run(insert, { type: "markup.toggle" }).state).toEqual({
      ...insert,
      markup: "code",
    });
    const locked = { ...vimNormal, surface: "preview" as const, locked: true };
    expect(run(locked, { type: "markup.toggle" }).effects).toEqual([
      { type: "setMarkup", code: true },
    ]);
  });

  test("the upstream command's option is followed", () => {
    const { state, effects } = run(vimNormal, {
      type: "sync",
      vim: true,
      preview: false,
      locked: false,
      code: true,
    });
    expect(state.markup).toBe("code");
    expect(effects).toEqual([]);
  });

  test("the segment marks the side shown", () => {
    const items = markupSegmentView(
      { ...initialState, markup: "code" },
      "Ctrl-Alt-k",
    );
    expect(items.map((i) => [i.label, i.active])).toEqual([
      ["Styled", false],
      ["Code", true],
    ]);
    expect(items[1].title).toBe("Code: every Markdown mark shown · Ctrl-Alt-k");
  });
});
