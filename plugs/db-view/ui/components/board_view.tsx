import { dueState, valueOf } from "../../src/derive.ts";
import type { DbRow } from "../../src/model.ts";
import type { DbEvent, DbState, DbView } from "../mediator/db_mediator.ts";

/** A card: draggable to another column, a link to its page. */
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
  const area = row.values.area;
  const dragging =
    state.mode.kind === "dragging" && state.mode.rowId === row.id;
  return (
    <div
      class={`db-card${dragging ? " db-dragging" : ""}${row.values.done === true ? " db-row-done" : ""}`}
      draggable={state.mode.kind !== "writing"}
      onDragStart={(e) => {
        e.dataTransfer?.setData("text/plain", row.id);
        if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
        emit({ type: "card.drag", rowId: row.id });
      }}
      onDragEnd={() => emit({ type: "card.cancel" })}
    >
      <a
        class="db-link db-card-title"
        onClick={() => emit({ type: "row.open", rowId: row.id })}
      >
        {row.title}
      </a>
      <div class="db-card-meta">
        {typeof due === "string" && due !== "" && (
          <span class={`db-date db-due-${dueState(due, state.today)}`}>
            {due}
          </span>
        )}
        {typeof area === "string" && area !== "" && (
          <span class="db-chip">{area}</span>
        )}
        {row.openTasks !== undefined && (
          <span class="db-chip" title="未完了 / 完了のタスク">
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
  return (
    <div class="db-board">
      {view.groups.map((g) => (
        <section
          key={g.key}
          class={`db-column${over === g.key ? " db-drop" : ""}`}
          onDragOver={(e) => {
            if (state.mode.kind !== "dragging") return;
            e.preventDefault();
            emit({ type: "card.over", target: g.key });
          }}
          onDrop={(e) => {
            e.preventDefault();
            emit({ type: "card.drop", target: g.key });
          }}
        >
          <header class="db-column-head">
            <span class="db-column-title">{g.label}</span>
            <span class="db-count">{g.rows.length}</span>
          </header>
          <div class="db-column-body">
            {g.rows.map((row) => (
              <Card key={row.id} row={row} state={state} emit={emit} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
