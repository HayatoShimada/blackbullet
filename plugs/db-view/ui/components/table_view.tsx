import { useEffect, useRef } from "preact/hooks";
import { valueOf } from "../../src/derive.ts";
import type { Column, DbRow } from "../../src/model.ts";
import {
  type DbEvent,
  type DbState,
  type DbView,
  newRowOf,
} from "../mediator/db_mediator.ts";
import { Cell, CellValue, isDoneRow, PageLink } from "./cell.tsx";
import { NewRowEntry } from "./new_row.tsx";
import { hasMenu, RowMenu } from "./row_menu.tsx";
import { useNarrow } from "./use_narrow.ts";

type Emit = (event: DbEvent) => void;

const rowClass = (row: DbRow) =>
  `${isDoneRow(row) ? "db-row-done" : ""}${row.values.archived === true ? " db-row-archived" : ""}`.trim();

/** Marks the scroller while there is more to see on its right, so the edge
 * can fade (a table wider than its frame is not a surprise). It sets an
 * attribute on the node it owns and nothing else. */
function useScrollCue(active: boolean) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = inner.current;
    const mark = outer.current;
    if (!box || !mark) return;
    const check = () => {
      const more = box.scrollWidth - box.clientWidth - box.scrollLeft > 1;
      if (more) mark.setAttribute("data-scrollable", "");
      else mark.removeAttribute("data-scrollable");
    };
    check();
    box.addEventListener("scroll", check, { passive: true });
    const watcher = new ResizeObserver(check);
    watcher.observe(box);
    if (box.firstElementChild) watcher.observe(box.firstElementChild);
    return () => {
      box.removeEventListener("scroll", check);
      watcher.disconnect();
    };
  }, [active]);
  return { outer, inner };
}

/** The empty table's words (product §5) and the one thing to do next. */
function EmptyView({ state, emit }: { state: DbState; emit: Emit }) {
  const phrase = state.phrase.trim();
  const db = state.spec.database;
  if (phrase !== "") {
    return (
      <div class="db-empty-view">
        <p>Nothing matches “{phrase}”.</p>
        <button
          type="button"
          class="sb-button"
          onClick={() => emit({ type: "phrase.set", phrase: "" })}
        >
          Clear filter
        </button>
      </div>
    );
  }
  if (state.spec.source.kind === "tasks" && state.spec.where.done === false) {
    return (
      <div class="db-empty-view">
        <p>All done.</p>
      </div>
    );
  }
  if (db) {
    return (
      <div class="db-empty-view">
        <p>
          No rows yet.{" "}
          {db.folder
            ? `+ New makes a page in ${db.folder}${db.template ? ` from ${db.template}` : ""}.`
            : "+ New makes a page."}
        </p>
        <button
          type="button"
          class="sb-button-primary db-new-inline-btn"
          onClick={() => emit({ type: "create.open" })}
        >
          + New
        </button>
      </div>
    );
  }
  return (
    <div class="db-empty-view">
      <p>No rows yet.</p>
    </div>
  );
}

/** Under 480px a row is a card: checkbox and Name, then one line of what
 * else it has, the menu top-right. */
function CardList({
  state,
  view,
  emit,
}: {
  state: DbState;
  view: DbView;
  emit: Emit;
}) {
  const busy = state.mode.kind === "writing";
  const editing = state.mode.kind === "editing" ? state.mode : null;
  const done = view.columns.find((c) => c.kind === "boolean");
  const rest = view.columns.filter((c) => c.key !== "title" && c !== done);
  const newRow = newRowOf(state);
  return (
    <ul class="db-card-list">
      {newRow && newRow.at === undefined && (
        <li class="db-row-card db-new-li">
          <NewRowEntry row={newRow} emit={emit} />
        </li>
      )}
      {view.rows.map((row) => (
        <li key={row.id} class={`db-row-card ${rowClass(row)}`}>
          <div class="db-row-card-head">
            {done && (
              <CellValue
                row={row}
                column={done}
                value={valueOf(row, done.key)}
                today={state.today}
                busy={busy}
                emit={emit}
              />
            )}
            <PageLink
              class="db-link db-row-card-title"
              onOpen={() => emit({ type: "row.open", rowId: row.id })}
            >
              {row.title}
            </PageLink>
            {hasMenu(row) && <RowMenu row={row} state={state} emit={emit} />}
          </div>
          <div class={`db-row-card-meta${done ? " db-indent" : ""}`}>
            {rest.map((c) => {
              const value = valueOf(row, c.key);
              const empty =
                value === undefined || value === null || value === "";
              if (
                empty &&
                !(editing?.rowId === row.id && editing.column === c.key)
              )
                return null;
              return (
                <span class="db-meta-item" key={c.key}>
                  <span class="db-meta-label">{c.label}</span>
                  <Cell
                    row={row}
                    column={c}
                    value={value}
                    today={state.today}
                    busy={busy}
                    editing={
                      editing?.rowId === row.id && editing.column === c.key
                    }
                    emit={emit}
                  />
                </span>
              );
            })}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function TableView({
  state,
  view,
  emit,
}: {
  state: DbState;
  view: DbView;
  emit: Emit;
}) {
  const withMenu = view.rows.some(hasMenu);
  const busy = state.mode.kind === "writing";
  const editing = state.mode.kind === "editing" ? state.mode : null;
  const newRow = newRowOf(state);
  // One of the two is mounted, so inputs, editors and menus exist once.
  const narrow = useNarrow();
  const cue = useScrollCue(!narrow);
  const span = view.columns.length + (withMenu ? 1 : 0);
  const empty = view.rows.length === 0 && !(newRow && newRow.at === undefined);
  return (
    <>
      {!narrow && (
        <div class="db-table-scroll" ref={cue.outer}>
          <div class="db-table-x" ref={cue.inner}>
            <table class="db-table">
              <thead>
                <tr>
                  {view.columns.map((c: Column) => {
                    const sorted =
                      state.sort?.key === c.key
                        ? state.sort.desc
                          ? "desc"
                          : "asc"
                        : "";
                    return (
                      <th
                        key={c.key}
                        class={`${sorted ? `db-sorted-${sorted}` : ""}${c.key === "title" ? " db-col-title" : ""}`}
                        aria-sort={
                          sorted === "asc"
                            ? "ascending"
                            : sorted === "desc"
                              ? "descending"
                              : undefined
                        }
                      >
                        <button
                          type="button"
                          class="db-th"
                          aria-label={`Sort by ${c.label}`}
                          onClick={() =>
                            emit({ type: "sort.toggle", key: c.key })
                          }
                        >
                          {c.key === "done" ? (
                            <span class="db-th-short">{c.label}</span>
                          ) : (
                            c.label
                          )}
                          <span class="db-sort-mark" aria-hidden="true">
                            {sorted === "asc"
                              ? "▲"
                              : sorted === "desc"
                                ? "▼"
                                : ""}
                          </span>
                        </button>
                      </th>
                    );
                  })}
                  {withMenu && (
                    <th class="db-menu-col">
                      <span class="db-visually-hidden">Actions</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {newRow && newRow.at === undefined && (
                  <tr class="db-new-tr">
                    <td colSpan={span}>
                      <NewRowEntry row={newRow} emit={emit} />
                    </td>
                  </tr>
                )}
                {view.rows.map((row: DbRow) => (
                  <tr key={row.id} class={rowClass(row)}>
                    {view.columns.map((c) => {
                      const isEditing =
                        editing?.rowId === row.id && editing.column === c.key;
                      return (
                        <td
                          key={c.key}
                          class={`db-cell db-cell-${c.kind}${c.key === "title" ? " db-col-title" : ""}`}
                        >
                          <Cell
                            row={row}
                            column={c}
                            value={valueOf(row, c.key)}
                            today={state.today}
                            busy={busy}
                            editing={isEditing}
                            emit={emit}
                          />
                        </td>
                      );
                    })}
                    {withMenu && (
                      <td class="db-cell db-menu-col">
                        <RowMenu row={row} state={state} emit={emit} />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {narrow && <CardList state={state} view={view} emit={emit} />}
      {empty && <EmptyView state={state} emit={emit} />}
    </>
  );
}
