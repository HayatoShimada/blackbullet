import type { ComponentChildren } from "preact";
import { useEffect, useRef } from "preact/hooks";
import {
  dueState,
  isoDate,
  normalizeDate,
  pageCrumb,
  pageName,
  shortStamp,
} from "../../src/derive.ts";
import type { Column, DbRow } from "../../src/model.ts";
import type { DbEvent } from "../mediator/db_mediator.ts";
import { PencilIcon } from "./icons.tsx";

type Emit = (event: DbEvent) => void;

/** The word beside a date where it matters: "overdue", "today", "tomorrow".
 * Colour alone never says it. */
export function dueWord(due: unknown, today: string): string | null {
  const state = dueState(due, today);
  if (state === "overdue" || state === "today") return state;
  const iso = normalizeDate(due);
  if (state === "soon" && iso) {
    const [y, m, d] = today.split("-").map(Number);
    if (isoDate(new Date(y, m - 1, d + 1)) === iso) return "tomorrow";
  }
  return null;
}

/** A finished row: a ticked task, or a page whose status is "done". It is
 * drawn grey, with no red date: nothing is overdue once it is done. */
export const isDoneRow = (row: DbRow) =>
  row.values.done === true || row.values.status === "done";

/** A link to a page: reachable by keyboard as well as by pointer. */
export function PageLink({
  title,
  onOpen,
  class: className = "db-link",
  children,
}: {
  title?: string;
  onOpen: () => void;
  class?: string;
  children: ComponentChildren;
}) {
  return (
    <a
      class={className}
      role="link"
      tabIndex={0}
      title={title}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      {children}
    </a>
  );
}

/** A page named for a person: its last segment as the link, the folder as a
 * dim breadcrumb before it; the full path is the tooltip. */
export function PageName({
  page,
  onOpen,
  crumb = true,
}: {
  page: string;
  onOpen: () => void;
  crumb?: boolean;
}) {
  const folder = crumb ? pageCrumb(page) : "";
  return (
    <span class="db-page">
      {folder && (
        <span class="db-crumb" aria-hidden="true">
          {folder}
        </span>
      )}
      <PageLink title={page} onOpen={onOpen}>
        {pageName(page)}
      </PageLink>
    </span>
  );
}

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
    // The 16px box sits in a label that is the hit area (44px on touch).
    const name = column.key === "done" ? "Done" : column.label;
    return (
      <label class="db-check-label">
        <input
          type="checkbox"
          class="db-check"
          aria-label={`${name}: ${row.title}`}
          checked={value === true}
          disabled={!column.editable}
          // Not `disabled` while a write is in flight: a disabled box loses
          // focus, and a keyboard user would restart from the top of the page.
          aria-disabled={busy || undefined}
          onChange={(e) => {
            const box = e.currentTarget as HTMLInputElement;
            if (busy) {
              box.checked = value === true;
              return;
            }
            emit({
              type: "cell.commit",
              rowId: row.id,
              column: column.key,
              value: box.checked,
            });
          }}
        />
      </label>
    );
  }
  if (column.key === "title") {
    return (
      <PageLink
        title={row.page}
        onOpen={() => emit({ type: "row.open", rowId: row.id })}
      >
        {row.title}
      </PageLink>
    );
  }
  if (column.key === "page") {
    return (
      <PageName
        page={row.page}
        onOpen={() => emit({ type: "row.open", rowId: row.id })}
      />
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
    return (
      <span class="db-empty" aria-label="empty">
        ·
      </span>
    );
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
    const word = dueWord(value, today);
    return (
      <span class={`db-date db-due-${state}`}>
        {normalizeDate(value) ?? String(value)}
        {word && <span class="db-due-word">{word}</span>}
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
      <PageLink
        title={target}
        onOpen={() => emit({ type: "link.open", target })}
      >
        {linkLabel(String(value))}
      </PageLink>
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

/** The label of a link cell: the alias, else the page's name without its
 * folder (`[[Areas/Store]]` reads "Store"). */
export function linkLabel(value: string): string {
  const m = /^\s*\[\[[^\]|]*\|([^\]]*)\]\]\s*$/.exec(value);
  if (m?.[1].trim()) return m[1].trim();
  return pageName(linkTarget(value)) || value.trim();
}

/** One cell of a row: its value, and when the column is editable the pencil
 * and the editor itself. One way to edit: a click or tap on the cell, the
 * pencil (shown on hover), or Enter / F2 on the focused cell; no double click.
 * It draws and emits (`cell.tap` carries whether the press was on a link). */
export function Cell({
  row,
  column,
  value,
  today,
  busy,
  editing,
  emit,
}: {
  row: DbRow;
  column: Column;
  value: unknown;
  today: string;
  busy: boolean;
  editing: boolean;
  emit: Emit;
}) {
  if (editing) {
    return <CellEditor row={row} column={column} value={value} emit={emit} />;
  }
  const shown = (
    <CellValue
      row={row}
      column={column}
      value={value}
      today={today}
      busy={busy}
      emit={emit}
    />
  );
  if (!column.editable || column.kind === "boolean") return shown;
  const text =
    value === undefined || value === null || value === ""
      ? "empty"
      : Array.isArray(value)
        ? value.join(", ")
        : String(value);
  const start = () =>
    emit({ type: "cell.edit", rowId: row.id, column: column.key });
  const word = column.kind === "date" ? dueWord(value, today) : null;
  const name = `Edit ${column.label} of ${row.title}: ${text}${word ? `, ${word}` : ""}`;
  const onKeyDown = (e: KeyboardEvent) => {
    if ((e.key === "Enter" && e.target === e.currentTarget) || e.key === "F2") {
      e.preventDefault();
      start();
    }
  };
  const onClick = (e: MouseEvent) => {
    const t = e.target as Element;
    if (t.closest(".db-pencil")) return start();
    emit({
      type: "cell.tap",
      rowId: row.id,
      column: column.key,
      onLink: !!t.closest(".db-link"),
    });
  };
  // A link cell holds a link, which is the focus target for opening it: the
  // pencil is the one for editing, so no focusable group wraps the two.
  if (column.link) {
    return (
      <div
        class="db-editable db-editable-link"
        onClick={onClick}
        onKeyDown={onKeyDown}
      >
        {shown}
        <button type="button" class="db-pencil" aria-label={name}>
          <PencilIcon />
        </button>
      </div>
    );
  }
  return (
    <div
      class="db-editable"
      tabIndex={0}
      role="button"
      aria-label={name}
      onClick={onClick}
      onKeyDown={onKeyDown}
    >
      {shown}
      <span class="db-pencil" aria-hidden="true">
        <PencilIcon />
      </span>
    </div>
  );
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
  // A sandboxed frame ignores `autofocus`: take focus when the editor appears.
  const field = useRef<HTMLInputElement & HTMLSelectElement>(null);
  useEffect(() => field.current?.focus(), []);
  const commit = (v: string) =>
    emit({ type: "cell.commit", rowId: row.id, column: column.key, value: v });
  const text = value === undefined || value === null ? "" : String(value);

  if (column.kind === "select") {
    return (
      <select
        ref={field}
        class="sb-select db-input"
        aria-label={`${column.label}: ${row.title}`}
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
        <option value="">None</option>
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
      ref={field}
      class="sb-input db-input"
      type={type}
      aria-label={`${column.label}: ${row.title}`}
      {...(column.kind === "date" ? { title: "YYYY-MM-DD" } : {})}
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
