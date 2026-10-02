import type { ViewKind } from "../../src/model.ts";
import {
  canSaveView,
  type DbEvent,
  type DbState,
  selectView,
  visibleCount,
} from "../mediator/db_mediator.ts";
import { BoardView } from "./board_view.tsx";
import { CalendarView } from "./calendar_view.tsx";
import { MoreIcon, SearchIcon } from "./icons.tsx";
import { Popover, rectOf } from "./popover.tsx";
import { RowPopover } from "./row_menu.tsx";
import { TableView } from "./table_view.tsx";

type Emit = (event: DbEvent) => void;

const TABS: { view: ViewKind; label: string }[] = [
  { view: "table", label: "Table" },
  { view: "board", label: "Board" },
  { view: "calendar", label: "Calendar" },
];

const SOURCE_TITLES: Record<string, string> = {
  projects: "Projects",
  tasks: "Tasks",
};

/** The view's "⋯": what applies to the view as a whole. The host's own
 * Edit/Reload bar is hidden for this widget, so "Edit source" lives here. */
function ViewMenu({ state, emit }: { state: DbState; emit: Emit }) {
  const open = state.mode.kind === "viewmenu";
  return (
    <>
      <button
        type="button"
        class="sb-button-icon db-more"
        data-popover-trigger
        aria-label="View actions"
        aria-haspopup="menu"
        aria-expanded={open}
        title="View actions"
        onClick={(e) =>
          emit({ type: "view.menu", rect: rectOf(e.currentTarget as Element) })
        }
      >
        <MoreIcon />
      </button>
      {state.mode.kind === "viewmenu" && (
        <Popover
          anchor={state.mode.anchor}
          label="View actions"
          onClose={() => emit({ type: "view.menu.close" })}
          items={[
            {
              label: "Save view",
              disabled: !canSaveView(state),
              onSelect: () => emit({ type: "view.save" }),
            },
            {
              label: "Edit source",
              disabled: !state.block,
              onSelect: () => emit({ type: "source.edit" }),
            },
            {
              label: state.reloading ? "Reloading…" : "Reload",
              disabled: state.reloading,
              onSelect: () => emit({ type: "reload" }),
            },
          ]}
        />
      )}
    </>
  );
}

/** The one-row notice: what happened, and the one thing to do about it. */
function Notices({ state, emit }: { state: DbState; emit: Emit }) {
  return (
    <>
      {state.undo && (
        <div class="db-notice db-notice-undo" role="status">
          <span class="db-notice-text">{state.undo.label}</span>
          <span class="db-notice-dot" aria-hidden="true">
            ·
          </span>
          <button
            type="button"
            class="sb-button db-undo"
            onClick={() => emit({ type: "undo.run" })}
          >
            Undo
          </button>
        </div>
      )}
      {state.notice && (
        <div
          class={`db-notice db-notice-${state.notice.level}`}
          role={state.notice.level === "error" ? "alert" : "status"}
        >
          <span class="db-notice-text">{state.notice.text}</span>
          <button
            type="button"
            class="sb-button db-dismiss"
            onClick={() => emit({ type: "notice.dismiss" })}
          >
            Dismiss
          </button>
        </div>
      )}
      {state.truncated && (
        <div class="db-notice db-notice-info" role="status">
          <span class="db-notice-text">
            Showing the first {state.spec.limit} rows. Raise limit in the block
            to see more.
          </span>
        </div>
      )}
    </>
  );
}

/**
 * The widget's root view. It owns no state: everything it draws comes from the
 * Mediator's `state`, and everything a user does goes back as an event.
 */
export function App({ state, emit }: { state: DbState; emit: Emit }) {
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
        <span class="db-count" aria-label={`${visibleCount(state)} rows`}>
          {visibleCount(state)}
        </span>
        <nav class="db-tabs sb-segments" aria-label="View">
          {TABS.map((t) => {
            const active = state.view === t.view;
            return (
              <button
                type="button"
                key={t.view}
                class={`db-tab sb-segment${active ? " db-active sb-segment-active" : ""}`}
                aria-pressed={active}
                onClick={() => emit({ type: "view.set", view: t.view })}
              >
                {t.label}
              </button>
            );
          })}
        </nav>
        <span class="db-filter-wrap">
          <SearchIcon />
          <input
            class="sb-input db-filter"
            type="search"
            aria-label="Filter rows"
            placeholder="Filter…"
            value={state.phrase}
            onInput={(e) =>
              emit({
                type: "phrase.set",
                phrase: (e.currentTarget as HTMLInputElement).value,
              })
            }
          />
        </span>
        {state.spec.database && (
          <button
            type="button"
            class="sb-button-primary db-new"
            disabled={state.mode.kind === "writing"}
            title="New row: makes a page in this database"
            onClick={() => emit({ type: "create.open" })}
          >
            + New
          </button>
        )}
        <ViewMenu state={state} emit={emit} />
      </header>
      <Notices state={state} emit={emit} />
      {state.view === "table" && (
        <TableView state={state} view={view} emit={emit} />
      )}
      {state.view === "board" && (
        <BoardView state={state} view={view} emit={emit} />
      )}
      {state.view === "calendar" && (
        <CalendarView state={state} view={view} emit={emit} />
      )}
      <RowPopover state={state} emit={emit} />
    </div>
  );
}
