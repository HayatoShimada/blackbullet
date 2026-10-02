import { useRef } from "preact/hooks";
import type { DbEvent } from "../mediator/db_mediator.ts";

/** The new-row title input. Enter submits (Shift+Enter: without opening the
 * page), Esc or leaving it cancels. It only ever emits. */
export function NewTitleInput({
  emit,
  class: className = "db-new-title",
}: {
  emit: (event: DbEvent) => void;
  class?: string;
}) {
  // After Enter or Esc the input still loses focus; that must not cancel
  // what Enter just started.
  const settled = useRef(false);
  settled.current = false;
  return (
    <input
      class={`db-input ${className}`}
      type="text"
      autoFocus
      placeholder="Title"
      maxLength={100}
      onKeyDown={(e) => {
        // The Enter that confirms an IME conversion is not a submit.
        if (e.key === "Enter" && !e.isComposing && e.keyCode !== 229) {
          e.preventDefault();
          const title = (e.currentTarget as HTMLInputElement).value;
          // An empty title starts nothing: the input stays, so a blur later
          // still cancels it.
          settled.current = title.trim() !== "";
          emit({ type: "row.create", title, stay: e.shiftKey });
        } else if (e.key === "Escape") {
          settled.current = true;
          emit({ type: "create.cancel" });
        }
      }}
      onBlur={() => !settled.current && emit({ type: "create.cancel" })}
    />
  );
}

/** A small "+" that opens a new-row input in place (a board column, a day), or
 * the input itself when it is open there. */
export function PlusNew({
  at,
  mode,
  emit,
}: {
  at: string;
  mode: { kind: string; at?: string };
  emit: (event: DbEvent) => void;
}) {
  if (mode.kind === "creating" && mode.at === at) {
    return <NewTitleInput emit={emit} class="db-new-inline" />;
  }
  return (
    <button
      type="button"
      class="db-btn db-plus"
      disabled={mode.kind !== "idle" && mode.kind !== "creating"}
      title="ここに新しい行を作る"
      onClick={() => emit({ type: "create.open", at })}
    >
      +
    </button>
  );
}
