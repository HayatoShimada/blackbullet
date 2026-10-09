// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada

/**
 * The editor's mode, decided in one place: Edit or Preview, and (with vim on)
 * which vim mode the editor is in. Esc steps out one level at a time,
 * Insert → Normal → Preview; a key that starts typing steps back in.
 *
 * Preview is the page shown read-only (`forcedROMode`). A page that cannot be
 * written at all (read-only space, read-only page) is `locked`: it stays in
 * Preview and nothing here moves it.
 *
 * Separately, the page is drawn Styled (Markdown marks hidden away from the
 * cursor) or as Code (every `#`, `**`, `[[ ]]` shown: `markdownSyntaxRendering`).
 * That holds in Edit and Preview alike, and a locked page can switch it too.
 */

export type Surface = "edit" | "preview";
export type VimMode = "normal" | "insert" | "visual" | "replace";
export type VimSubMode = "linewise" | "blockwise";
export type Markup = "styled" | "code";

/** Keys that leave Preview for Edit; the letters then run as vim commands. */
export const EDIT_KEYS = ["i", "a", "o", "I", "A", "O", "Enter"] as const;
export type EditKey = (typeof EDIT_KEYS)[number];

export type EditorModeState = {
  surface: Surface;
  vim: boolean;
  vimMode: VimMode;
  vimSub?: VimSubMode;
  locked: boolean;
  markup: Markup;
};

export type EditorModeEvent =
  /** The options the mode follows, as they are now (set from anywhere). */
  | {
      type: "sync";
      vim: boolean;
      preview: boolean;
      locked: boolean;
      code: boolean;
    }
  | { type: "vim.modeChanged"; mode: VimMode; subMode?: VimSubMode }
  /** An Esc that vim has no use for (Normal, nothing pending, nothing open). */
  | { type: "key.escape" }
  /** A key that starts typing, pressed in Preview. */
  | { type: "key.edit"; key: EditKey }
  /** The header chip, or `Editor: Toggle Preview`. */
  | { type: "toggle" }
  /** `:preview` and `:edit`. */
  | { type: "set"; surface: Surface }
  /** The header's Styled | Code segment, `:styled` and `:code`. */
  | { type: "markup.set"; markup: Markup }
  /** `Editor: Toggle Code`. */
  | { type: "markup.toggle" };

export type EditorModeEffect =
  /** Switches the editor to read-only or back; `then` runs once it is back. */
  | { type: "setPreview"; on: boolean; then?: EditKey }
  /** The next Tab leaves the editor. */
  | { type: "armTabFocus" }
  /** Shows the Markdown marks (Code) or hides them (Styled), and keeps it. */
  | { type: "setMarkup"; code: boolean };

export type Transition = {
  state: EditorModeState;
  effects: EditorModeEffect[];
};

export const initialState: EditorModeState = {
  surface: "edit",
  vim: false,
  vimMode: "normal",
  locked: false,
  markup: "styled",
};

const stay = (state: EditorModeState): Transition => ({ state, effects: [] });

function toPreview(state: EditorModeState): Transition {
  return {
    state: { ...state, surface: "preview" },
    effects: [{ type: "setPreview", on: true }],
  };
}

function toEdit(state: EditorModeState, then?: EditKey): Transition {
  return {
    // A rebuilt editor starts vim in Normal; `then` moves it on from there.
    state: { ...state, surface: "edit", vimMode: "normal", vimSub: undefined },
    effects: [{ type: "setPreview", on: false, ...(then ? { then } : {}) }],
  };
}

export function transition(
  state: EditorModeState,
  event: EditorModeEvent,
): Transition {
  switch (event.type) {
    case "sync": {
      const surface: Surface =
        event.locked || event.preview ? "preview" : "edit";
      const markup: Markup = event.code ? "code" : "styled";
      if (
        surface === state.surface &&
        event.vim === state.vim &&
        event.locked === state.locked &&
        markup === state.markup
      ) {
        return stay(state);
      }
      return stay({
        ...state,
        surface,
        vim: event.vim,
        locked: event.locked,
        markup,
        ...(event.vim ? {} : { vimMode: "normal", vimSub: undefined }),
      });
    }
    case "vim.modeChanged": {
      const vimSub = event.mode === "visual" ? event.subMode : undefined;
      if (event.mode === state.vimMode && vimSub === state.vimSub) {
        return stay(state);
      }
      return stay({ ...state, vimMode: event.mode, vimSub });
    }
    case "key.escape":
      if (state.surface === "preview" || state.locked) {
        return { state, effects: [{ type: "armTabFocus" }] };
      }
      if (state.vim && state.vimMode === "normal") {
        return toPreview(state);
      }
      return stay(state);
    case "key.edit":
      if (state.surface !== "preview" || state.locked) {
        return stay(state);
      }
      return toEdit(state, event.key === "Enter" ? undefined : event.key);
    case "toggle":
      if (state.locked) {
        return stay(state);
      }
      return state.surface === "edit" ? toPreview(state) : toEdit(state);
    case "set":
      if (state.locked || event.surface === state.surface) {
        return stay(state);
      }
      return event.surface === "preview" ? toPreview(state) : toEdit(state);
    case "markup.set":
      return event.markup === state.markup
        ? stay(state)
        : toMarkup(state, event.markup);
    case "markup.toggle":
      return toMarkup(state, state.markup === "code" ? "styled" : "code");
  }
}

function toMarkup(state: EditorModeState, markup: Markup): Transition {
  return {
    state: { ...state, markup },
    effects: [{ type: "setMarkup", code: markup === "code" }],
  };
}

export type ChipTone = "quiet" | "outline" | "accent" | "accent-outline";

/** What the header chip draws for a state. */
export type ModeChipView = {
  label: string;
  tone: ChipTone;
  /** Tooltip: the state and the key that moves it on. */
  title: string;
  disabled: boolean;
};

const VIM_LABEL: Record<VimMode, string> = {
  normal: "NORMAL",
  insert: "INSERT",
  visual: "VISUAL",
  replace: "REPLACE",
};

export function chipView(
  state: EditorModeState,
  toggleKey?: string,
): ModeChipView {
  const toggle = toggleKey ? ` · ${toggleKey}` : "";
  if (state.locked) {
    return {
      label: "Read-only",
      tone: "quiet",
      title: "Read-only: this page cannot be edited here",
      disabled: true,
    };
  }
  if (state.surface === "preview") {
    return {
      label: "Preview",
      tone: "quiet",
      title: state.vim
        ? `Preview · i or Enter to edit${toggle}`
        : `Preview · click to edit${toggle}`,
      disabled: false,
    };
  }
  if (!state.vim) {
    return {
      label: "Edit",
      tone: "outline",
      title: `Edit · click for Preview${toggle}`,
      disabled: false,
    };
  }
  const label =
    state.vimMode === "visual" && state.vimSub
      ? state.vimSub === "linewise"
        ? "V-LINE"
        : "V-BLOCK"
      : VIM_LABEL[state.vimMode];
  const tone: ChipTone =
    state.vimMode === "insert"
      ? "accent"
      : state.vimMode === "normal"
        ? "outline"
        : "accent-outline";
  const next =
    state.vimMode === "normal" ? "Esc for Preview" : "Esc for NORMAL";
  return { label, tone, title: `${label} · ${next}${toggle}`, disabled: false };
}

/** One side of the header's Styled | Code segment. */
export type MarkupSegmentItem = {
  markup: Markup;
  label: string;
  active: boolean;
  /** Tooltip: what the side shows, and the key that switches. */
  title: string;
};

/** What the header's Styled | Code segment draws for a state. */
export function markupSegmentView(
  state: EditorModeState,
  toggleKey?: string,
): MarkupSegmentItem[] {
  const toggle = toggleKey ? ` · ${toggleKey}` : "";
  return [
    {
      markup: "styled",
      label: "Styled",
      active: state.markup === "styled",
      title: `Styled: Markdown marks hidden away from the cursor${toggle}`,
    },
    {
      markup: "code",
      label: "Code",
      active: state.markup === "code",
      title: `Code: every Markdown mark shown${toggle}`,
    },
  ];
}
