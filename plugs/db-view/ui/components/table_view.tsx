import { valueOf } from "../../src/derive.ts";
import type { DbRow } from "../../src/model.ts";
import type { DbEvent, DbState, DbView } from "../mediator/db_mediator.ts";
import { CellEditor, CellValue } from "./cell.tsx";

export function TableView({
  state,
  view,
  emit,
}: {
  state: DbState;
  view: DbView;
  emit: (event: DbEvent) => void;
}) {
  const busy = state.mode.kind === "writing";
  const editing = state.mode.kind === "editing" ? state.mode : null;
  return (
    <div class="db-table-scroll">
      <table class="db-table">
        <thead>
          <tr>
            {view.columns.map((c) => {
              const sorted =
                state.sort?.key === c.key
                  ? state.sort.desc
                    ? "desc"
                    : "asc"
                  : "";
              return (
                <th key={c.key} class={sorted ? `db-sorted-${sorted}` : ""}>
                  <button
                    type="button"
                    class="db-th"
                    onClick={() => emit({ type: "sort.toggle", key: c.key })}
                    title="クリックで並べ替え"
                  >
                    {c.label}
                    {sorted === "asc" ? " ▲" : sorted === "desc" ? " ▼" : ""}
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {view.rows.map((row: DbRow) => (
            <tr
              key={row.id}
              class={row.values.done === true ? "db-row-done" : ""}
            >
              {view.columns.map((c) => {
                const isEditing =
                  editing?.rowId === row.id && editing.column === c.key;
                const value = valueOf(row, c.key);
                return (
                  <td
                    key={c.key}
                    class={`db-cell db-cell-${c.kind}${c.editable ? " db-editable" : ""}`}
                    tabIndex={
                      c.editable && c.kind !== "boolean" ? 0 : undefined
                    }
                    onDblClick={() =>
                      c.editable && c.kind !== "boolean"
                        ? emit({
                            type: "cell.edit",
                            rowId: row.id,
                            column: c.key,
                          })
                        : undefined
                    }
                    onKeyDown={(e) => {
                      if (
                        e.key === "Enter" &&
                        c.editable &&
                        c.kind !== "boolean" &&
                        !isEditing
                      ) {
                        emit({
                          type: "cell.edit",
                          rowId: row.id,
                          column: c.key,
                        });
                      }
                    }}
                  >
                    {isEditing ? (
                      <CellEditor
                        row={row}
                        column={c}
                        value={value}
                        emit={emit}
                      />
                    ) : (
                      <CellValue
                        row={row}
                        column={c}
                        value={value}
                        today={state.today}
                        busy={busy}
                        emit={emit}
                      />
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {view.rows.length === 0 && (
        <div class="db-empty-view">該当するものがありません</div>
      )}
    </div>
  );
}
