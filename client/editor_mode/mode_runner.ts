// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada
import {
  type EditKey,
  type EditorModeEvent,
  type EditorModeState,
  initialState,
  transition,
} from "./mode_mediator.ts";

export type EditorModeRunnerDeps = {
  /** Switches read-only on or off; `then` is replayed in vim once it is back. */
  setPreview(on: boolean, then?: EditKey): void;
  armTabFocus(): void;
  /** Shows the Markdown marks or hides them, and remembers it. */
  setMarkup(code: boolean): void;
  /** Draws the new state (the header chip). */
  render(state: EditorModeState): void;
};

export type EditorModeRunner = {
  readonly state: EditorModeState;
  emit(event: EditorModeEvent): void;
};

/** Holds the mode's state and carries out what the Mediator decides. */
export function createEditorModeRunner(
  deps: EditorModeRunnerDeps,
): EditorModeRunner {
  let state = initialState;
  return {
    get state() {
      return state;
    },
    emit(event) {
      const next = transition(state, event);
      const changed = next.state !== state;
      state = next.state;
      if (changed) deps.render(state);
      for (const effect of next.effects) {
        switch (effect.type) {
          case "setPreview":
            deps.setPreview(effect.on, effect.then);
            break;
          case "armTabFocus":
            deps.armTabFocus();
            break;
          case "setMarkup":
            deps.setMarkup(effect.code);
            break;
        }
      }
    },
  };
}
