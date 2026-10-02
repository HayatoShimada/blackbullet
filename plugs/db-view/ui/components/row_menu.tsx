import { useEffect, useRef } from "preact/hooks";
import type { DbRow } from "../../src/model.ts";
import type { DbEvent, DbState } from "../mediator/db_mediator.ts";
import { MoreIcon } from "./icons.tsx";
import { Popover, rectOf } from "./popover.tsx";

type Emit = (event: DbEvent) => void;

/** Whether a row has a menu: only a page is a row that can be renamed,
 * archived, duplicated or deleted. */
export const hasMenu = (row: DbRow) => row.kind === "page";

/** What the rename box starts with: the page's own name, not its display name. */
export const renameDefault = (row: DbRow) =>
  row.page.slice(row.page.lastIndexOf("/") + 1) || row.title;

/** The "⋯" of a row. It never changes the row's height: the menu is the
 * view's one popover (see `RowPopover`), and while a row is being renamed the
 * box takes the button's place. It draws the Mediator's mode and only emits. */
export function RowMenu({
  row,
  state,
  emit,
}: {
  row: DbRow;
  state: DbState;
  emit: Emit;
}) {
  const settled = useRef(false);
  const rename = useRef<HTMLInputElement>(null);
  const renaming =
    state.mode.kind === "renaming" && state.mode.rowId === row.id;
  useEffect(() => {
    if (renaming) {
      rename.current?.focus();
      rename.current?.select();
    }
  }, [renaming]);
  if (!hasMenu(row)) return null;
  const mode = state.mode;
  if (renaming) {
    settled.current = false;
    return (
      <input
        ref={rename}
        class="sb-input db-input db-rename"
        type="text"
        aria-label={`Rename ${row.title}`}
        maxLength={100}
        defaultValue={renameDefault(row)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.isComposing && e.keyCode !== 229) {
            e.preventDefault();
            const title = (e.currentTarget as HTMLInputElement).value;
            settled.current = title.trim() !== "";
            emit({ type: "row.rename", rowId: row.id, title });
          } else if (e.key === "Escape") {
            settled.current = true;
            emit({ type: "row.menu.close" });
          }
        }}
        onBlur={() => !settled.current && emit({ type: "row.menu.close" })}
      />
    );
  }
  const open = mode.kind === "menu" && mode.rowId === row.id;
  return (
    <button
      type="button"
      class="sb-button-icon db-row-menu-btn"
      data-popover-trigger
      aria-label="Row actions"
      aria-haspopup="menu"
      aria-expanded={open}
      title="Row actions"
      disabled={mode.kind !== "idle" && mode.kind !== "menu"}
      onClick={(e) =>
        emit({
          type: "row.menu",
          rowId: row.id,
          rect: rectOf(e.currentTarget as Element),
        })
      }
    >
      <MoreIcon />
    </button>
  );
}

/** What a row's menu offers, hanging from its button: the one popover. */
export function RowPopover({ state, emit }: { state: DbState; emit: Emit }) {
  const mode = state.mode;
  if (mode.kind !== "menu") return null;
  const row = state.rows.find((r) => r.id === mode.rowId);
  if (!row) return null;
  const archived = row.values.archived === true;
  return (
    <Popover
      anchor={mode.anchor}
      label={`Actions for ${row.title}`}
      onClose={() => emit({ type: "row.menu.close" })}
      items={[
        {
          label: "Rename",
          onSelect: () => emit({ type: "row.rename.start", rowId: row.id }),
        },
        {
          label: "Duplicate",
          onSelect: () => emit({ type: "row.duplicate", rowId: row.id }),
        },
        {
          label: archived ? "Unarchive" : "Archive",
          onSelect: () => emit({ type: "row.archive", rowId: row.id }),
        },
        "separator",
        {
          label: "Move to trash",
          danger: true,
          onSelect: () => emit({ type: "row.delete.ask", rowId: row.id }),
        },
      ]}
    />
  );
}
