import { useRef } from "preact/hooks";
import { dueState, normalizeDate, shortStamp } from "../../src/derive.ts";
import type { Column, DbRow } from "../../src/model.ts";
import type { DbEvent } from "../mediator/db_mediator.ts";

type Emit = (event: DbEvent) => void;

/** What a cell shows when it is not being edited. */
export function CellValue({
  row,
  column,
  value,
  today,
  busy,
  emit,
}: {
  row: DbRow;
  column: Column;
  value: unknown;
  today: string;
  busy: boolean;
  emit: Emit;
}) {
  if (column.kind === "boolean") {
    return (
      <input
        type="checkbox"
        class="db-check"
        checked={value === true}
        disabled={!column.editable || busy}
        onChange={(e) =>
          emit({
            type: "cell.commit",
            rowId: row.id,
            column: column.key,
            value: (e.currentTarget as HTMLInputElement).checked,
          })
        }
      />
    );
  }
  if (column.key === "title") {
    return (
      <a
        class="db-link"
        onClick={() => emit({ type: "row.open", rowId: row.id })}
        title={row.page}
      >
        {row.title}
      </a>
    );
  }
  if (column.key === "page") {
    return (
      <a
        class="db-link"
        onClick={() => emit({ type: "row.open", rowId: row.id })}
      >
        {row.page}
      </a>
    );
  }
  if (Array.isArray(value)) {
    return (
      <span class="db-tags">
        {value.map((t) => (
          <span class="db-tag" key={String(t)}>
            {String(t)}
          </span>
        ))}
      </span>
    );
  }
  if (value === undefined || value === null || value === "") {
    return <span class="db-empty">·</span>;
  }
  if (
    column.key === "created" ||
    column.key === "modified" ||
    column.key === "lastModified"
  ) {
    return <span class="db-stamp">{shortStamp(value)}</span>;
  }
  if (column.kind === "date") {
    const state = dueState(value, today);
    return (
      <span class={`db-date db-due-${state}`}>
        {normalizeDate(value) ?? String(value)}
      </span>
    );
  }
  if (column.kind === "select") {
    return (
      <span class={`db-status db-status-${String(value)}`}>
        {String(value)}
      </span>
    );
  }
  if (column.link) {
    const target = linkTarget(String(value));
    return (
      <a
        class="db-link"
        title={target}
        onClick={() => emit({ type: "link.open", target })}
      >
        {String(value)}
      </a>
    );
  }
  return <span>{String(value)}</span>;
}

/** The page a `page` property names: `[[Areas/X|alias]]`, `[[Areas/X]]` or
 * plain `Areas/X` all open `Areas/X`. */
export function linkTarget(value: string): string {
  const m = /^\s*\[\[([^\]|]*)(?:\|[^\]]*)?\]\]\s*$/.exec(value);
  return (m ? m[1] : value).trim();
}

/** An in-place editor: Enter or leaving the cell commits, Esc cancels. */
export function CellEditor({
  row,
  column,
  value,
  emit,
}: {
  row: DbRow;
  column: Column;
  value: unknown;
  emit: Emit;
}) {
  // After Esc the input still loses focus; that must not commit.
  const cancelled = useRef(false);
  const commit = (v: string) =>
    emit({ type: "cell.commit", rowId: row.id, column: column.key, value: v });
  const text = value === undefined || value === null ? "" : String(value);

  if (column.kind === "select") {
    return (
      <select
        class="db-input"
        autoFocus
        value={text}
        onChange={(e) => commit((e.currentTarget as HTMLSelectElement).value)}
        onBlur={() => !cancelled.current && emit({ type: "cell.cancel" })}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            cancelled.current = true;
            emit({ type: "cell.cancel" });
          }
        }}
      >
        <option value="">(なし)</option>
        {[...new Set([...(column.options ?? []), ...(text ? [text] : [])])].map(
          (o) => (
            <option value={o} key={o}>
              {o}
            </option>
          ),
        )}
      </select>
    );
  }
  const type =
    column.kind === "date"
      ? "date"
      : column.kind === "number"
        ? "number"
        : "text";
  return (
    <input
      class="db-input"
      type={type}
      autoFocus
      defaultValue={text}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          cancelled.current = true;
          commit((e.currentTarget as HTMLInputElement).value);
        } else if (e.key === "Escape") {
          cancelled.current = true;
          emit({ type: "cell.cancel" });
        }
      }}
      onBlur={(e) => {
        if (cancelled.current) return;
        const input = e.currentTarget as HTMLInputElement;
        // A date typed only in part reads as "": leaving it would clear the
        // attribute. It is not a value, so it is not committed.
        if (input.validity.badInput) {
          emit({ type: "cell.cancel" });
          return;
        }
        commit(input.value);
      }}
    />
  );
}
