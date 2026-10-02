import { useEffect, useRef } from "preact/hooks";
import type { DbEvent, NewRow } from "../mediator/db_mediator.ts";

let errorIds = 0;

/** The new-row title input. Enter submits and opens the page (Shift+Enter:
 * stays here), Esc or leaving it cancels. It only ever emits. It takes focus
 * when it appears: a sandboxed frame ignores `autofocus`. */
export function NewTitleInput({
  emit,
  row,
  class: className = "db-new-title",
}: {
  emit: (event: DbEvent) => void;
  row: NewRow;
  class?: string;
}) {
  // After Enter or Esc the input still loses focus; that must not cancel
  // what Enter just started.
  const settled = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const errorId = useRef(`db-new-error-${++errorIds}`);
  settled.current = false;
  useEffect(() => {
    input.current?.focus();
    // A refused title comes back selected, ready to be changed.
    if (row.error) input.current?.select();
  }, []);
  return (
    <>
      <input
        ref={input}
        class={`sb-input db-input ${className}`}
        type="text"
        placeholder="Title"
        aria-label="Title of the new row"
        aria-invalid={row.error ? true : undefined}
        aria-describedby={row.error ? errorId.current : undefined}
        maxLength={100}
        defaultValue={row.title}
        readOnly={row.busy}
        onKeyDown={(e) => {
          // The Enter that confirms an IME conversion is not a submit.
          if (e.key === "Enter" && !e.isComposing && e.keyCode !== 229) {
            e.preventDefault();
            if (row.busy) return;
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
        onBlur={() =>
          !settled.current && !row.busy && emit({ type: "create.cancel" })
        }
      />
      {row.error && (
        <div id={errorId.current} class="db-field-error" role="alert">
          {row.error}
        </div>
      )}
    </>
  );
}

/** The input as the first row of the table, a card at the top of its board
 * column or a row above the calendar: full width, with what its keys do. */
export function NewRowEntry({
  row,
  emit,
  hint = true,
}: {
  row: NewRow;
  emit: (event: DbEvent) => void;
  hint?: boolean;
}) {
  return (
    <div class="db-new-row">
      <NewTitleInput emit={emit} row={row} class="db-new-title" />
      {hint && !row.error && (
        <div class="db-hint">
          {row.at === undefined
            ? "Enter opens · Shift-Enter stays · Esc cancels"
            : "Enter creates · Esc cancels"}
        </div>
      )}
    </div>
  );
}

/** A small "+" that opens a new-row input in place (a board column, a day). */
export function PlusNew({
  at,
  mode,
  emit,
  label,
}: {
  at: string;
  mode: { kind: string; at?: string };
  emit: (event: DbEvent) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      class="sb-button-icon db-plus"
      aria-label={label}
      title={label}
      disabled={
        (mode.kind !== "idle" && mode.kind !== "creating") ||
        (mode.kind === "creating" && mode.at === at)
      }
      onClick={() => emit({ type: "create.open", at })}
    >
      +
    </button>
  );
}
