import { useRef } from "preact/hooks";
import type { DbRow } from "../../src/model.ts";
import type { DbEvent, DbState } from "../mediator/db_mediator.ts";

type Emit = (event: DbEvent) => void;

/** Whether a row has a menu: only a page is a row that can be renamed,
 * archived, duplicated or deleted. */
export const hasMenu = (row: DbRow) => row.kind === "page";

/** What the rename box starts with: the page's own name, not its display name. */
export const renameDefault = (row: DbRow) =>
  row.page.slice(row.page.lastIndexOf("/") + 1) || row.title;

/** The "…" of a row, and while it is open what it offers: rename, archive
 * (or restore), duplicate, delete (asking first). Draws the Mediator's mode and
 * only emits. */
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
  if (!hasMenu(row)) return null;
  const mode = state.mode;
  const open =
    mode.kind === "menu" ||
    mode.kind === "renaming" ||
    mode.kind === "confirming"
      ? mode
      : null;
  if (!open || open.rowId !== row.id) {
    return (
      <button
        type="button"
        class="db-btn db-row-menu-btn"
        disabled={mode.kind !== "idle" && mode.kind !== "menu"}
        title="行の操作"
        onClick={() => emit({ type: "row.menu", rowId: row.id })}
      >
        …
      </button>
    );
  }
  if (open.kind === "renaming") {
    settled.current = false;
    return (
      <input
        class="db-input db-rename"
        type="text"
        autoFocus
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
  if (open.kind === "confirming") {
    return (
      <span class="db-row-menu">
        <span class="db-confirm">
          「{row.title}」をゴミ箱へ移しますか? 戻すには「Database: Restore From Trash」
        </span>
        <button
          type="button"
          class="db-btn db-danger"
          onClick={() => emit({ type: "row.delete.confirm" })}
        >
          ゴミ箱へ
        </button>
        <button
          type="button"
          class="db-btn"
          onClick={() => emit({ type: "row.menu.close" })}
        >
          やめる
        </button>
      </span>
    );
  }
  const archived = row.values.archived === true;
  return (
    <span class="db-row-menu">
      <button
        type="button"
        class="db-btn"
        onClick={() => emit({ type: "row.rename.start", rowId: row.id })}
      >
        名前を変える
      </button>
      <button
        type="button"
        class="db-btn"
        onClick={() => emit({ type: "row.duplicate", rowId: row.id })}
      >
        複製
      </button>
      <button
        type="button"
        class="db-btn"
        onClick={() => emit({ type: "row.archive", rowId: row.id })}
      >
        {archived ? "アーカイブを戻す" : "アーカイブ"}
      </button>
      <button
        type="button"
        class="db-btn db-danger"
        onClick={() => emit({ type: "row.delete.ask", rowId: row.id })}
      >
        ゴミ箱へ
      </button>
      <button
        type="button"
        class="db-btn"
        title="閉じる"
        onClick={() => emit({ type: "row.menu.close" })}
      >
        ×
      </button>
    </span>
  );
}
