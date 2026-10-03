// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada
import type { Client } from "../client.ts";
import { ESCAPE_THEN_TAB_MS } from "../codemirror/escape_then_tab.ts";
import { getVimModule } from "../vim_loader.ts";
import type { EditKey, EditorModeEvent } from "./mode_mediator.ts";
import {
  createEditorModeRunner,
  type EditorModeRunner,
} from "./mode_runner.ts";

let runner: EditorModeRunner | undefined;

// A Preview switch waits for the option to reach the view state (the next
// render) before the editor is rebuilt from it; this is what it then does.
let pendingSwitch: { then?: EditKey } | undefined;

/** Starts the editor-mode Mediator for this client (once). */
export function installEditorMode(client: Client): EditorModeRunner {
  runner = createEditorModeRunner({
    setPreview(on, then) {
      pendingSwitch = { then };
      client.ui.viewDispatch({
        type: "set-ui-option",
        key: "forcedROMode",
        value: on,
      });
    },
    armTabFocus() {
      client.editorView?.setTabFocusMode(ESCAPE_THEN_TAB_MS);
    },
    render(state) {
      client.ui.viewDispatch({ type: "set-editor-mode", state });
    },
  });
  return runner;
}

/** Sends an event to the editor-mode Mediator from anywhere. */
export function emitToEditorMode(event: EditorModeEvent): void {
  runner?.emit(event);
}

/**
 * Called by the root view after a render with the options the mode follows.
 * Finishes a Preview switch the Mediator asked for: rebuild, focus, replay.
 */
export function editorModeRendered(
  client: Client,
  options: { vim: boolean; preview: boolean; locked: boolean },
): void {
  emitToEditorMode({ type: "sync", ...options });
  const pending = pendingSwitch;
  if (!pending) return;
  pendingSwitch = undefined;
  client.rebuildEditorState();
  if (!client.ui.viewState.isMobile) client.focus();
  if (pending.then) void replayVimKey(client, pending.then);
}

/** Runs `key` in vim once the rebuilt editor has its vim back. */
async function replayVimKey(client: Client, key: string): Promise<void> {
  for (let tries = 0; tries < 50; tries++) {
    const mod = getVimModule();
    const cm = mod?.getCM(client.editorView);
    if (mod && cm?.state.vim) {
      mod.Vim.handleKey(cm, key, "user");
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
