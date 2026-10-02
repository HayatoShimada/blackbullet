import {
  type DbEvent,
  type DbState,
  type DbView,
  newRowOf,
} from "../mediator/db_mediator.ts";
import { Card } from "./board_view.tsx";
import { ChevronIcon } from "./icons.tsx";
import { NewRowEntry, PlusNew } from "./new_row.tsx";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "October 2026". */
export const monthTitle = (year: number, month: number) =>
  new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(
    new Date(year, month - 1, 1),
  );

/** "Thu" for an ISO date. */
const weekdayOf = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return WEEKDAYS[new Date(y, m - 1, d).getDay()];
};

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
  const newRow = newRowOf(state);
  const labels =
    state.spec.weekStart === 1 ? [...WEEKDAYS.slice(1), WEEKDAYS[0]] : WEEKDAYS;
  return (
    <div class="db-calendar">
      <div class="db-cal-nav">
        <strong class="db-cal-title">
          {monthTitle(state.month.year, state.month.month)}
        </strong>
        <button
          type="button"
          class="sb-button-icon"
          aria-label="Previous month"
          title="Previous month"
          onClick={() => emit({ type: "month.shift", delta: -1 })}
        >
          <ChevronIcon dir="left" />
        </button>
        <button
          type="button"
          class="sb-button-icon"
          aria-label="Next month"
          title="Next month"
          onClick={() => emit({ type: "month.shift", delta: 1 })}
        >
          <ChevronIcon dir="right" />
        </button>
        <button
          type="button"
          class="sb-button"
          onClick={() => emit({ type: "month.today" })}
        >
          Today
        </button>
      </div>
      {newRow && newRow.at === undefined && (
        <NewRowEntry row={newRow} emit={emit} />
      )}
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
              <span class="db-cal-num">
                {/* The week row is gone in list mode: say the day here. */}
                <span class="db-cal-wd">{weekdayOf(day.iso)} </span>
                {day.day}
              </span>
              {state.spec.database && (
                <PlusNew
                  at={day.iso}
                  mode={state.mode}
                  emit={emit}
                  label={`New row on ${day.iso}`}
                />
              )}
            </span>
            {newRow && newRow.at === day.iso && (
              <NewRowEntry row={newRow} emit={emit} hint={false} />
            )}
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
          <span class="db-column-title">No date</span>
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
