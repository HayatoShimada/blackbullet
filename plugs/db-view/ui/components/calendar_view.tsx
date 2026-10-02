import type { DbEvent, DbState, DbView } from "../mediator/db_mediator.ts";
import { Card } from "./board_view.tsx";
import { PlusNew } from "./new_row.tsx";

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

export function CalendarView({
  state,
  view,
  emit,
}: {
  state: DbState;
  view: DbView;
  emit: (event: DbEvent) => void;
}) {
  const over = state.mode.kind === "dragging" ? state.mode.over : null;
  const labels =
    state.spec.weekStart === 1 ? [...WEEKDAYS.slice(1), WEEKDAYS[0]] : WEEKDAYS;
  return (
    <div class="db-calendar">
      <div class="db-cal-nav">
        <button
          type="button"
          class="db-btn"
          onClick={() => emit({ type: "month.shift", delta: -1 })}
        >
          ‹
        </button>
        <strong class="db-cal-title">
          {state.month.year}年{state.month.month}月
        </strong>
        <button
          type="button"
          class="db-btn"
          onClick={() => emit({ type: "month.shift", delta: 1 })}
        >
          ›
        </button>
        <button
          type="button"
          class="db-btn"
          onClick={() => emit({ type: "month.today" })}
        >
          今日
        </button>
      </div>
      <div class="db-cal-grid">
        {labels.map((l) => (
          <div class="db-cal-dow" key={l}>
            {l}
          </div>
        ))}
        {view.weeks.flat().map((day) => (
          <div
            key={day.iso}
            class={`db-cal-day${day.inMonth ? "" : " db-out"}${day.iso === state.today ? " db-today" : ""}${over === day.iso ? " db-drop" : ""}`}
            data-drop={day.iso}
          >
            <span class="db-cal-top">
              <span class="db-cal-num">{day.day}</span>
              {state.spec.database && (
                <PlusNew at={day.iso} mode={state.mode} emit={emit} />
              )}
            </span>
            {(view.byDay.get(day.iso) ?? []).map((row) => (
              <Card key={row.id} row={row} state={state} emit={emit} />
            ))}
          </div>
        ))}
      </div>
      <section
        class={`db-undated${over === "" ? " db-drop" : ""}`}
        data-drop=""
      >
        <header class="db-column-head">
          <span class="db-column-title">日付なし</span>
          <span class="db-count">{view.undated.length}</span>
        </header>
        <div class="db-undated-body">
          {view.undated.map((row) => (
            <Card key={row.id} row={row} state={state} emit={emit} />
          ))}
        </div>
      </section>
    </div>
  );
}
