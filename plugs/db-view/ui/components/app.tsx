import type { ViewKind } from "../../src/model.ts";
import {
  type DbEvent,
  type DbState,
  selectView,
} from "../mediator/db_mediator.ts";
import { BoardView } from "./board_view.tsx";
import { CalendarView } from "./calendar_view.tsx";
import { TableView } from "./table_view.tsx";

const TABS: { view: ViewKind; label: string }[] = [
  { view: "table", label: "表" },
  { view: "board", label: "ボード" },
  { view: "calendar", label: "カレンダー" },
];

const SOURCE_TITLES: Record<string, string> = {
  projects: "プロジェクト",
  tasks: "タスク",
};

/**
 * The widget's root view. It owns no state: everything it draws comes from the
 * Mediator's `state`, and everything a user does goes back as an event.
 */
export function App({
  state,
  emit,
}: {
  state: DbState;
  emit: (event: DbEvent) => void;
}) {
  const view = selectView(state);
  const title =
    state.spec.title ??
    (state.spec.source.kind === "tag"
      ? `#${state.spec.source.tag}`
      : SOURCE_TITLES[state.spec.source.kind]);
  return (
    <div class="db-app">
      <header class="db-header">
        <strong class="db-title">{title}</strong>
        <span class="db-count">{state.rows.length}</span>
        <nav class="db-tabs">
          {TABS.map((t) => (
            <button
              type="button"
              key={t.view}
              class={`db-tab${state.view === t.view ? " db-active" : ""}`}
              onClick={() => emit({ type: "view.set", view: t.view })}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <input
          class="db-input db-filter"
          type="search"
          placeholder="絞り込み"
          value={state.phrase}
          onInput={(e) =>
            emit({
              type: "phrase.set",
              phrase: (e.currentTarget as HTMLInputElement).value,
            })
          }
        />
        <button
          type="button"
          class="db-btn"
          disabled={state.reloading}
          title="読み込み直す"
          onClick={() => emit({ type: "reload" })}
        >
          {state.reloading ? "…" : "↻"}
        </button>
      </header>
      {state.notice && (
        <div class={`db-notice db-notice-${state.notice.level}`} role="alert">
          <span>{state.notice.text}</span>
          <button
            type="button"
            class="db-btn"
            onClick={() => emit({ type: "notice.dismiss" })}
          >
            ×
          </button>
        </div>
      )}
      {state.truncated && (
        <div class="db-notice db-notice-info">
          件数が多いため、先頭の {state.spec.limit} 件だけ表示しています(limit
          で変えられます)
        </div>
      )}
      {state.view === "table" && (
        <TableView state={state} view={view} emit={emit} />
      )}
      {state.view === "board" && (
        <BoardView state={state} view={view} emit={emit} />
      )}
      {state.view === "calendar" && (
        <CalendarView state={state} view={view} emit={emit} />
      )}
    </div>
  );
}
