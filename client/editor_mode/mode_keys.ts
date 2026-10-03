// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada
import { completionStatus } from "@codemirror/autocomplete";
import { searchPanelOpen } from "@codemirror/search";
import { type Extension, Prec } from "@codemirror/state";
import { EditorView, ViewPlugin } from "@codemirror/view";
import { getVimModule } from "../vim_loader.ts";
import {
  EDIT_KEYS,
  type EditKey,
  type EditorModeEvent,
} from "./mode_mediator.ts";

/** What the key handler needs to know about vim at the moment of a key. */
export type VimSnapshot = {
  insertMode: boolean;
  visualMode: boolean;
  /** A count, register, operator or key sequence is half typed. */
  pending: boolean;
  /** Something Esc would close or clear first. */
  busy: boolean;
};

type KeyLike = Pick<
  KeyboardEvent,
  "key" | "ctrlKey" | "altKey" | "metaKey" | "isComposing" | "defaultPrevented"
>;

/**
 * In Preview these would start a change; read-only already blocks the change,
 * but vim would still switch to Insert. Swallowed so Preview stays put.
 */
const PREVIEW_SWALLOWED = new Set(["c", "C", "s", "S", "R"]);

/**
 * Turns a key into a mode event, `"swallow"` (consume, do nothing), or
 * `undefined` (not ours: vim and the editor get it as usual).
 */
export function decideKey(
  event: KeyLike,
  vim: VimSnapshot,
  preview: boolean,
): EditorModeEvent | "swallow" | undefined {
  if (
    event.defaultPrevented ||
    event.isComposing ||
    event.ctrlKey ||
    event.altKey ||
    event.metaKey
  ) {
    return undefined;
  }
  const quiet = !vim.insertMode && !vim.visualMode && !vim.pending;
  if (event.key === "Escape") {
    // Esc clears a pending command, a search highlight or extra cursors
    // first; only a plain Normal Esc moves on (to Preview, or out of it).
    return quiet && !vim.busy ? { type: "key.escape" } : undefined;
  }
  if (!preview || !quiet) return undefined;
  if ((EDIT_KEYS as readonly string[]).includes(event.key)) {
    return { type: "key.edit", key: event.key as EditKey };
  }
  return PREVIEW_SWALLOWED.has(event.key) ? "swallow" : undefined;
}

type VimState = {
  insertMode?: boolean;
  visualMode?: boolean;
  inputState?: {
    keyBuffer?: string[];
    operator?: string | null;
    prefixRepeat?: string[];
    motionRepeat?: string[];
    registerName?: string;
  };
  searchState_?: { getOverlay?: () => unknown };
};

export function vimSnapshot(view: EditorView): VimSnapshot | undefined {
  const cm = getVimModule()?.getCM(view) as
    | { state: { vim?: VimState; dialog?: unknown } }
    | null
    | undefined;
  const vim = cm?.state.vim;
  if (!vim) return undefined;
  const input = vim.inputState;
  return {
    insertMode: !!vim.insertMode,
    visualMode: !!vim.visualMode,
    pending: !!(
      input?.keyBuffer?.length ||
      input?.operator ||
      input?.prefixRepeat?.length ||
      input?.motionRepeat?.length ||
      input?.registerName
    ),
    busy:
      !!cm.state.dialog ||
      !!vim.searchState_?.getOverlay?.() ||
      view.state.selection.ranges.length > 1 ||
      completionStatus(view.state) !== null ||
      searchPanelOpen(view.state),
  };
}

/**
 * The vim side of the mode: Esc in Normal steps out to Preview, and in Preview
 * i/a/o/Enter step back in. Runs ahead of vim and of the command keys.
 */
export function editorModeKeys(
  emit: (event: EditorModeEvent) => void,
  preview: boolean,
): Extension {
  return Prec.highest(
    EditorView.domEventHandlers({
      keydown(event, view) {
        const vim = vimSnapshot(view);
        if (!vim) return false;
        const decision = decideKey(event, vim, preview);
        if (!decision) return false;
        event.preventDefault();
        event.stopPropagation();
        if (decision !== "swallow") emit(decision);
        return true;
      },
    }),
  );
}

type VimCM = {
  on(type: string, f: (e: { mode: string; subMode?: string }) => void): void;
  off(type: string, f: (e: { mode: string; subMode?: string }) => void): void;
};

/**
 * Reports vim's mode changes. Goes in the same compartment as `vim()`.
 */
export function vimModeWatcher(emit: (event: EditorModeEvent) => void) {
  return ViewPlugin.define((view) => {
    let cm: VimCM | null | undefined;
    const onChange = (e: { mode: string; subMode?: string }) => {
      const mode = e.mode;
      if (
        mode === "normal" ||
        mode === "insert" ||
        mode === "visual" ||
        mode === "replace"
      ) {
        const subMode =
          e.subMode === "linewise" || e.subMode === "blockwise"
            ? e.subMode
            : undefined;
        emit({ type: "vim.modeChanged", mode, subMode });
      }
    };
    let destroyed = false;
    // Once every plugin of this view is up, vim's adapter can be found. A
    // fresh vim starts in Normal without saying so.
    queueMicrotask(() => {
      if (destroyed) return;
      cm = getVimModule()?.getCM(view) as VimCM | null | undefined;
      cm?.on("vim-mode-change", onChange);
      emit({ type: "vim.modeChanged", mode: "normal" });
    });
    return {
      destroy() {
        destroyed = true;
        cm?.off("vim-mode-change", onChange);
      },
    };
  });
}
