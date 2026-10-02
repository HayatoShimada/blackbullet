import { useEffect, useRef } from "preact/hooks";
import { dueState, pageName, valueOf } from "../../src/derive.ts";
import type { DbRow } from "../../src/model.ts";
import {
  type DbEvent,
  type DbState,
  type DbView,
  groupKey,
  newRowGroup,
  newRowOf,
} from "../mediator/db_mediator.ts";
import {
  createPointerDrag,
  dropTargetOf,
  type PointerDrag,
} from "../mediator/pointer_drag.ts";
import { dueWord, isDoneRow, PageLink } from "./cell.tsx";
import { NewRowEntry, PlusNew } from "./new_row.tsx";
import { RowMenu } from "./row_menu.tsx";

const noScroll = (e: Event) => e.preventDefault();

/** A card: moved by pointer (mouse drag, or press-and-hold on touch) to
 * another column or day; a link to its page. */
export function Card({
  row,
  state,
  emit,
}: {
  row: DbRow;
  state: DbState;
  emit: (event: DbEvent) => void;
}) {
  const due = valueOf(row, state.spec.date);
  // A task's page, by name (the folder is the tooltip), unless the column is
  // already that page.
  const taskPage =
    row.kind === "task" &&
    !(state.view === "board" && groupKey(state) === "page");
  const area = row.values.area;
  const dragging =
    state.mode.kind === "dragging" && state.mode.rowId === row.id;
  const el = useRef<HTMLDivElement>(null);
  const emitRef = useRef(emit);
  emitRef.current = emit;
  const drag = useRef<PointerDrag | null>(null);
  if (!drag.current) {
    drag.current = createPointerDrag({
      emit: (e) => emitRef.current(e),
      targetAt: (x, y) => dropTargetOf(document.elementFromPoint(x, y)),
      onStart: (id) => {
        el.current?.setPointerCapture(id);
        // A touch that is dragging a card must not scroll the page.
        document.addEventListener("touchmove", noScroll, { passive: false });
      },
      onEnd: () => document.removeEventListener("touchmove", noScroll),
    });
  }
  const d = drag.current;
  // Unmounting mid-drag must not leave the touch blocker on the document.
  useEffect(
    () => () => {
      d.cancel();
      document.removeEventListener("touchmove", noScroll);
    },
    [],
  );
  return (
    <div
      ref={el}
      class={`db-card${dragging ? " db-dragging" : ""}${isDoneRow(row) ? " db-row-done" : ""}${row.values.archived === true ? " db-row-archived" : ""}`}
      onPointerDown={(e) =>
        d.down(
          row.id,
          e,
          state.mode.kind === "writing" ||
            (e.target as Element).closest("button, input, select, textarea") !==
              null,
        )
      }
      onPointerMove={(e) => d.move(e)}
      onPointerUp={(e) => d.up(e)}
      onPointerCancel={() => d.cancel()}
      onClickCapture={(e) => {
        // The click that ends a drag is not a click on the title.
        if (d.consumeClick()) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
    >
      <div class="db-card-head">
        <PageLink
          class="db-link db-card-title"
          title={row.page}
          onOpen={() => emit({ type: "row.open", rowId: row.id })}
        >
          {row.title}
        </PageLink>
        <RowMenu row={row} state={state} emit={emit} />
      </div>
      <div class="db-card-meta">
        {typeof due === "string" && due !== "" && (
          <span class={`db-date db-due-${dueState(due, state.today)}`}>
            {due}
            {dueWord(due, state.today) && (
              <span class="db-due-word">{dueWord(due, state.today)}</span>
            )}
          </span>
        )}
        {taskPage && (
          <span class="db-chip db-chip-page" title={row.page}>
            {pageName(row.page)}
          </span>
        )}
        {typeof area === "string" && area !== "" && (
          <span class="db-chip">{area}</span>
        )}
        {row.openTasks !== undefined && (
          <span class="db-chip" title="Open / done tasks">
            {row.openTasks} / {row.doneTasks ?? 0}
          </span>
        )}
      </div>
    </div>
  );
}

export function BoardView({
  state,
  view,
  emit,
}: {
  state: DbState;
  view: DbView;
  emit: (event: DbEvent) => void;
}) {
  const over = state.mode.kind === "dragging" ? state.mode.over : null;
  const newRow = newRowOf(state);
  // The header's "+ New" lands in the column a new row would start in.
  const newAt =
    newRow && newRow.at === undefined
      ? newRowGroup(state, view.groups)
      : undefined;
  return (
    <>
      {/* No column to put it in (nothing declared, no rows): above the board. */}
      {newRow && newRow.at === undefined && newAt === undefined && (
        <div class="db-board-new">
          <NewRowEntry row={newRow} emit={emit} />
        </div>
      )}
      <div class="db-board">
        {view.groups.map((g) => (
          <section
            key={g.key}
            class={`db-column${over === g.key ? " db-drop" : ""}`}
            data-drop={g.key}
          >
            <header class="db-column-head">
              <span
                class="db-column-title"
                title={g.key === "" ? undefined : g.key}
              >
                {g.label}
              </span>
              <span class="db-count">{g.rows.length}</span>
              {state.spec.database && (
                <PlusNew
                  at={g.key}
                  mode={state.mode}
                  emit={emit}
                  label={`New row in ${g.label}`}
                />
              )}
            </header>
            <div class="db-column-body">
              {newRow &&
                (newRow.at === g.key ||
                  (newRow.at === undefined && newAt === g.key)) && (
                  <NewRowEntry row={newRow} emit={emit} />
                )}
              {g.rows.map((row) => (
                <Card key={row.id} row={row} state={state} emit={emit} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
