/**
 * The db view's Mediator: what a click, an edit, a drag or a drop means. The
 * table, the board and the calendar are passive views drawn from this state;
 * they only ever `emit` what the user did. Nothing here touches the space:
 * `transition` returns the next state and the effects the runner performs, and
 * what came back (a write that landed, a conflict) arrives as an event.
 */
import {
  columnKind,
  columnsFor,
  filterRows,
  groupRows,
  type Group,
  monthGrid,
  rowsByDate,
  sortRows,
  valueOf,
  type Day,
} from "../../src/derive.ts";
import type {
  CellKind,
  Column,
  DbRow,
  Spec,
  ViewKind,
} from "../../src/model.ts";

export type Mode =
  | { kind: "idle" }
  | { kind: "editing"; rowId: string; column: string }
  /** `over` is the column key (board) or ISO date / "" (calendar) the card is on. */
  | { kind: "dragging"; rowId: string; over: string | null }
  /** A write is in flight: one at a time, so a second edit is not started. */
  | { kind: "writing" };

export type Notice = { level: "info" | "error"; text: string };

export type DbState = {
  spec: Spec;
  rows: DbRow[];
  truncated: boolean;
  today: string;
  view: ViewKind;
  phrase: string;
  sort: Spec["sort"];
  month: { year: number; month: number };
  mode: Mode;
  notice: Notice | null;
  reloading: boolean;
};

export type DbEvent =
  | { type: "view.set"; view: ViewKind }
  | { type: "phrase.set"; phrase: string }
  | { type: "sort.toggle"; key: string }
  | { type: "month.shift"; delta: number }
  | { type: "month.today" }
  | { type: "cell.edit"; rowId: string; column: string }
  | {
      type: "cell.commit";
      rowId: string;
      column: string;
      value: string | boolean;
    }
  | { type: "cell.cancel" }
  | { type: "card.drag"; rowId: string }
  | { type: "card.over"; target: string | null }
  | { type: "card.drop"; target: string }
  | { type: "card.cancel" }
  | { type: "row.open"; rowId: string }
  | { type: "reload" }
  | { type: "notice.dismiss" }
  /** The runner's answers. */
  | {
      type: "write.done";
      rowId: string;
      column: string;
      value: string | number | boolean | null;
      modified: string;
    }
  | { type: "write.failed"; reason: string; message: string }
  | {
      type: "rows.loaded";
      rows: DbRow[];
      truncated: boolean;
      today: string;
    }
  | { type: "rows.failed"; message: string };

export type DbEffect =
  | {
      type: "write";
      row: DbRow;
      column: string;
      kind: CellKind;
      value: string | boolean;
    }
  | { type: "reload" }
  | { type: "navigate"; target: string };

export type Transition = { state: DbState; effects: DbEffect[] };

export function initialState(model: {
  spec: Spec;
  rows: DbRow[];
  truncated: boolean;
  today: string;
}): DbState {
  const [year, month] = model.today.split("-").map(Number);
  return {
    spec: model.spec,
    rows: model.rows,
    truncated: model.truncated,
    today: model.today,
    view: model.spec.view,
    phrase: "",
    sort: model.spec.sort,
    month: { year, month },
    mode: { kind: "idle" },
    notice: null,
    reloading: false,
  };
}

const stay = (state: DbState): Transition => ({ state, effects: [] });

const rowById = (state: DbState, id: string) =>
  state.rows.find((r) => r.id === id);

/** A cell as the table shows it, for telling whether an edit changed anything. */
function same(current: unknown, input: string | boolean): boolean {
  if (typeof input === "boolean") return current === input;
  const text = String(input).trim();
  if (current === undefined || current === null || current === "")
    return text === "";
  return String(current) === text;
}

/** The attribute a drop writes, and the value: a board column sets the group's
 * attribute, a calendar day sets the date's. */
function dropWrite(
  state: DbState,
  target: string,
): { column: string; value: string } | null {
  if (state.view === "board")
    return { column: state.spec.group, value: target };
  if (state.view === "calendar")
    return { column: state.spec.date, value: target };
  return null;
}

export function transition(state: DbState, event: DbEvent): Transition {
  const busy = state.mode.kind === "writing";
  switch (event.type) {
    case "view.set":
      return stay({ ...state, view: event.view, mode: { kind: "idle" } });
    case "phrase.set":
      return stay({ ...state, phrase: event.phrase });
    case "sort.toggle": {
      const sort =
        state.sort?.key === event.key
          ? state.sort.desc
            ? undefined
            : { key: event.key, desc: true }
          : { key: event.key, desc: false };
      return stay({ ...state, sort });
    }
    case "month.shift": {
      const index =
        state.month.year * 12 + (state.month.month - 1) + event.delta;
      return stay({
        ...state,
        month: { year: Math.floor(index / 12), month: (index % 12) + 1 },
      });
    }
    case "month.today": {
      const [year, month] = state.today.split("-").map(Number);
      return stay({ ...state, month: { year, month } });
    }

    case "cell.edit": {
      if (state.mode.kind !== "idle") return stay(state);
      const row = rowById(state, event.rowId);
      const column = columnsFor(state.rows, state.spec).find(
        (c) => c.key === event.column,
      );
      if (!row || !column?.editable) return stay(state);
      return stay({
        ...state,
        mode: { kind: "editing", rowId: row.id, column: column.key },
      });
    }
    case "cell.cancel":
      return stay(
        state.mode.kind === "editing"
          ? { ...state, mode: { kind: "idle" } }
          : state,
      );
    case "cell.commit": {
      if (busy) return stay(state);
      const row = rowById(state, event.rowId);
      const idle: DbState = { ...state, mode: { kind: "idle" } };
      if (!row) return stay(idle);
      if (same(valueOf(row, event.column), event.value)) return stay(idle);
      return {
        state: { ...state, mode: { kind: "writing" }, notice: null },
        effects: [
          {
            type: "write",
            row,
            column: event.column,
            kind: columnKind(event.column, state.rows),
            value: event.value,
          },
        ],
      };
    }

    case "card.drag":
      if (state.mode.kind !== "idle") return stay(state);
      return stay({
        ...state,
        mode: { kind: "dragging", rowId: event.rowId, over: null },
      });
    case "card.over":
      if (state.mode.kind !== "dragging") return stay(state);
      return stay(
        state.mode.over === event.target
          ? state
          : { ...state, mode: { ...state.mode, over: event.target } },
      );
    case "card.cancel":
      return stay(
        state.mode.kind === "dragging"
          ? { ...state, mode: { kind: "idle" } }
          : state,
      );
    case "card.drop": {
      if (state.mode.kind !== "dragging") return stay(state);
      const row = rowById(state, state.mode.rowId);
      const write = dropWrite(state, event.target);
      const idle: DbState = { ...state, mode: { kind: "idle" } };
      if (!row || !write) return stay(idle);
      if (same(valueOf(row, write.column), write.value)) return stay(idle);
      return {
        state: { ...state, mode: { kind: "writing" }, notice: null },
        effects: [
          {
            type: "write",
            row,
            column: write.column,
            kind: columnKind(write.column, state.rows),
            value: write.value,
          },
        ],
      };
    }

    case "row.open": {
      const row = rowById(state, event.rowId);
      if (!row) return stay(state);
      return {
        state,
        effects: [
          {
            type: "navigate",
            target:
              row.kind === "task" && row.range
                ? `${row.page}@${row.range[0]}`
                : row.page,
          },
        ],
      };
    }
    case "reload":
      if (busy || state.reloading) return stay(state);
      return {
        state: { ...state, reloading: true },
        effects: [{ type: "reload" }],
      };
    case "notice.dismiss":
      return stay({ ...state, notice: null });

    case "write.done": {
      const rows = state.rows.map((r) => {
        if (r.id !== event.rowId) return r;
        const values = { ...r.values };
        if (event.value === null) delete values[event.column];
        else values[event.column] = event.value;
        return { ...r, values, modified: event.modified };
      });
      return {
        state: { ...state, rows, mode: { kind: "idle" }, reloading: true },
        // A write can move other rows' positions on the same page: read again.
        effects: [{ type: "reload" }],
      };
    }
    case "write.failed":
      return {
        state: {
          ...state,
          mode: { kind: "idle" },
          notice: { level: "error", text: event.message },
          // A reload may already be in flight (after a write): leave it be.
          reloading: event.reason === "stale" ? true : state.reloading,
        },
        // A stale write means what is on screen is old: bring it up to date.
        effects: event.reason === "stale" ? [{ type: "reload" }] : [],
      };
    case "rows.loaded":
      return stay({
        ...state,
        rows: event.rows,
        truncated: event.truncated,
        today: event.today,
        reloading: false,
      });
    case "rows.failed":
      return stay({
        ...state,
        reloading: false,
        // An empty message is "nothing new to show": stop waiting, say nothing.
        notice: event.message
          ? { level: "error", text: event.message }
          : state.notice,
      });
  }
}

export type DbView = {
  columns: Column[];
  /** Filtered, and sorted for the table. */
  rows: DbRow[];
  groups: Group[];
  weeks: Day[][];
  byDay: Map<string, DbRow[]>;
  undated: DbRow[];
};

/** What each view paints, derived from the state. */
export function selectView(state: DbState): DbView {
  const filtered = filterRows(state.rows, state.phrase);
  const columns = columnsFor(state.rows, state.spec);
  const sorted = sortRows(filtered, state.sort);
  const { byDay, undated } = rowsByDate(filtered, state.spec.date);
  return {
    columns,
    rows: sorted,
    groups: groupRows(
      sortRows(filtered, { key: "due", desc: false }),
      state.spec.group,
      state.spec.order,
    ),
    weeks: monthGrid(state.month.year, state.month.month, state.spec.weekStart),
    byDay,
    undated,
  };
}
