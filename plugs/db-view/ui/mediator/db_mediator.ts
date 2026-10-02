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
import type { NewValues } from "../../src/create.ts";
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
  /** A new-row input is open, waiting for a title. `at` is where it sits (a
   * board column key or a calendar ISO date; absent: the header's), `values`
   * what the row starts with there. */
  | { kind: "creating"; at?: string; values?: NewValues }
  /** A row's "…" menu is open. */
  | { kind: "menu"; rowId: string }
  /** A row's title is being edited. */
  | { kind: "renaming"; rowId: string }
  /** Waiting for the reader to confirm deleting a row. */
  | { kind: "confirming"; rowId: string }
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
  /** The ```db block that drew the view: where "Save view" writes. */
  block?: { page: string; body: string };
  /** What "Save view" sent, so view.saved records that and not later edits. */
  saving?: { view: ViewKind; sort: Spec["sort"]; filter: string };
};

/** Whether "Save view" can be pressed now. */
export function canSaveView(state: DbState): boolean {
  return state.mode.kind === "idle" && !!state.block && viewDirty(state);
}

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
  /** A page a cell names (a `page` property). */
  | { type: "link.open"; target: string }
  /** "+ New": the input opens, is cancelled, or is submitted with a title. */
  /** `at`: the board column key / calendar ISO date the "+" sits on. */
  | { type: "create.open"; at?: string }
  | { type: "create.cancel" }
  /** `stay`: do not open the new page (the header's Shift+Enter). A row made
   * in place never opens. */
  | { type: "row.create"; title: string; stay?: boolean }
  /** A row's menu: open, close; and what it offers. */
  | { type: "row.menu"; rowId: string }
  | { type: "row.menu.close" }
  | { type: "row.rename.start"; rowId: string }
  | { type: "row.rename"; rowId: string; title: string }
  | { type: "row.delete.ask"; rowId: string }
  | { type: "row.delete.confirm" }
  | { type: "row.archive"; rowId: string }
  | { type: "row.duplicate"; rowId: string }
  | { type: "reload" }
  /** "Save view": write tab, sort and filter phrase into the block. */
  | { type: "view.save" }
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
      type: "view.saved";
      body: string;
    }
  | { type: "view.save.failed"; message: string }
  | { type: "row.done"; message: string }
  | { type: "row.failed"; reason: string; message: string }
  | { type: "create.done"; page: string; open?: boolean }
  | { type: "create.failed"; message: string }
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
      /** The database whose declared options and types the write is held to. */
      database?: string;
    }
  | { type: "reload" }
  | {
      type: "saveView";
      view: ViewKind;
      sort: Spec["sort"];
      filter: string;
    }
  | { type: "navigate"; target: string }
  /** A new row of the spec's database, named `title`, starting with `values`;
   * `open`: then show its page. */
  | { type: "create"; title: string; values?: NewValues; open: boolean }
  /** Delete, archive (or restore), duplicate or rename a page row. */
  | {
      type: "rowAction";
      action: "delete" | "archive" | "duplicate" | "rename";
      row: DbRow;
      /** rename: the new title; archive: whether to archive (else restore). */
      title?: string;
      archived?: boolean;
    };

export type Transition = { state: DbState; effects: DbEffect[] };

export function initialState(model: {
  spec: Spec;
  rows: DbRow[];
  truncated: boolean;
  today: string;
  block?: { page: string; body: string };
}): DbState {
  const [year, month] = model.today.split("-").map(Number);
  return {
    spec: model.spec,
    rows: model.rows,
    truncated: model.truncated,
    today: model.today,
    view: model.spec.view,
    phrase: model.spec.filter ?? "",
    ...(model.block ? { block: model.block } : {}),
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

/** What a row made at a board column or calendar day starts with. */
function valuesAt(state: DbState, at: string): NewValues | undefined {
  const write = dropWrite(state, at);
  // The "no value" column and the undated list start with nothing.
  if (!write || write.value === "") return undefined;
  return { [write.column]: write.value };
}

const databaseOf = (state: DbState) =>
  state.spec.database ? { database: state.spec.database.name } : {};

/** Whether the tab, sort or phrase differ from what the block says. */
export function viewDirty(state: DbState): boolean {
  const a = state.sort;
  const b = state.spec.sort;
  const sameSort = a === b || (a && b && a.key === b.key && a.desc === b.desc);
  return (
    state.view !== state.spec.view ||
    state.phrase.trim() !== (state.spec.filter ?? "").trim() ||
    !sameSort
  );
}

export function transition(state: DbState, event: DbEvent): Transition {
  const busy = state.mode.kind === "writing";
  switch (event.type) {
    case "view.set":
      return stay({
        ...state,
        view: event.view,
        mode: busy ? state.mode : { kind: "idle" },
      });
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
            kind: columnKind(event.column, state.rows, state.spec.database),
            value: event.value,
            ...databaseOf(state),
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
            kind: columnKind(write.column, state.rows, state.spec.database),
            value: write.value,
            ...databaseOf(state),
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
    case "link.open": {
      const target = event.target.trim();
      if (!target) return stay(state);
      return { state, effects: [{ type: "navigate", target }] };
    }

    case "create.open":
      if (
        (state.mode.kind !== "idle" && state.mode.kind !== "creating") ||
        !state.spec.database
      ) {
        return stay(state);
      }
      {
        const values =
          event.at === undefined ? undefined : valuesAt(state, event.at);
        return stay({
          ...state,
          mode: {
            kind: "creating",
            ...(event.at !== undefined ? { at: event.at } : {}),
            ...(values ? { values } : {}),
          },
        });
      }
    case "create.cancel":
      return stay(
        state.mode.kind === "creating"
          ? { ...state, mode: { kind: "idle" } }
          : state,
      );
    case "row.create": {
      if (busy || !state.spec.database) return stay(state);
      const creating = state.mode.kind === "creating" ? state.mode : null;
      const title = event.title.trim();
      // Nothing typed: the input stays open, waiting.
      if (title === "") return stay(state);
      return {
        state: { ...state, mode: { kind: "writing" }, notice: null },
        effects: [
          {
            type: "create",
            title,
            ...(creating?.values ? { values: creating.values } : {}),
            open: !event.stay && creating?.at === undefined,
          },
        ],
      };
    }
    case "create.done":
      return {
        state: { ...state, mode: { kind: "idle" }, reloading: true },
        // Open the new page (unless asked not to); and the rows here have one
        // more, so read again.
        effects: [
          ...(event.open === false
            ? []
            : [{ type: "navigate" as const, target: event.page }]),
          { type: "reload" },
        ],
      };
    case "create.failed":
      return stay({
        ...state,
        mode: { kind: "idle" },
        notice: { level: "error", text: event.message },
      });
    case "row.menu": {
      if (state.mode.kind !== "idle" && state.mode.kind !== "menu") {
        return stay(state);
      }
      const row = rowById(state, event.rowId);
      if (row?.kind !== "page") return stay(state);
      // The same button again closes it.
      if (state.mode.kind === "menu" && state.mode.rowId === row.id) {
        return stay({ ...state, mode: { kind: "idle" } });
      }
      return stay({ ...state, mode: { kind: "menu", rowId: row.id } });
    }
    case "row.menu.close":
      return stay(
        state.mode.kind === "menu" ||
          state.mode.kind === "renaming" ||
          state.mode.kind === "confirming"
          ? { ...state, mode: { kind: "idle" } }
          : state,
      );
    case "row.rename.start": {
      if (state.mode.kind !== "menu" || state.mode.rowId !== event.rowId) {
        return stay(state);
      }
      return stay({ ...state, mode: { kind: "renaming", rowId: event.rowId } });
    }
    case "row.rename": {
      if (state.mode.kind !== "renaming" || state.mode.rowId !== event.rowId) {
        return stay(state);
      }
      const row = rowById(state, event.rowId);
      const title = event.title.trim();
      // Nothing typed: the input stays open, waiting.
      if (!row || title === "") return stay(state);
      // Unchanged: nothing to write.
      if (title === row.title)
        return stay({ ...state, mode: { kind: "idle" } });
      return {
        state: { ...state, mode: { kind: "writing" }, notice: null },
        effects: [{ type: "rowAction", action: "rename", row, title }],
      };
    }
    case "row.delete.ask": {
      if (state.mode.kind !== "menu" || state.mode.rowId !== event.rowId) {
        return stay(state);
      }
      return stay({
        ...state,
        mode: { kind: "confirming", rowId: event.rowId },
      });
    }
    case "row.delete.confirm": {
      if (state.mode.kind !== "confirming") return stay(state);
      const row = rowById(state, state.mode.rowId);
      if (!row) return stay({ ...state, mode: { kind: "idle" } });
      return {
        state: { ...state, mode: { kind: "writing" }, notice: null },
        effects: [{ type: "rowAction", action: "delete", row }],
      };
    }
    case "row.archive":
    case "row.duplicate": {
      if (state.mode.kind !== "menu" || state.mode.rowId !== event.rowId) {
        return stay(state);
      }
      const row = rowById(state, event.rowId);
      if (!row) return stay({ ...state, mode: { kind: "idle" } });
      return {
        state: { ...state, mode: { kind: "writing" }, notice: null },
        effects: [
          event.type === "row.archive"
            ? {
                type: "rowAction",
                action: "archive",
                row,
                archived: row.values.archived !== true,
              }
            : { type: "rowAction", action: "duplicate", row },
        ],
      };
    }
    case "row.done":
      return {
        state: {
          ...state,
          mode: { kind: "idle" },
          reloading: true,
          notice: { level: "info", text: event.message },
        },
        effects: [{ type: "reload" }],
      };
    case "row.failed":
      return {
        state: {
          ...state,
          mode: { kind: "idle" },
          notice: { level: "error", text: event.message },
          reloading: event.reason === "stale" ? true : state.reloading,
        },
        effects: event.reason === "stale" ? [{ type: "reload" }] : [],
      };
    case "reload":
      if (busy || state.reloading) return stay(state);
      return {
        state: { ...state, reloading: true },
        effects: [{ type: "reload" }],
      };
    case "view.save": {
      if (!canSaveView(state)) return stay(state);
      return {
        state: {
          ...state,
          mode: { kind: "writing" },
          notice: null,
          saving: {
            view: state.view,
            sort: state.sort,
            filter: state.phrase.trim(),
          },
        },
        effects: [
          {
            type: "saveView",
            view: state.view,
            sort: state.sort,
            filter: state.phrase.trim(),
          },
        ],
      };
    }
    case "view.saved": {
      const saved = state.saving;
      if (!saved) return stay({ ...state, mode: { kind: "idle" } });
      return stay({
        ...state,
        mode: { kind: "idle" },
        saving: undefined,
        spec: {
          ...state.spec,
          view: saved.view,
          sort: saved.sort,
          ...(saved.filter ? { filter: saved.filter } : { filter: undefined }),
        },
        block: state.block && { ...state.block, body: event.body },
        notice: { level: "info", text: "ビューを保存しました" },
      });
    }
    case "view.save.failed":
      return stay({
        ...state,
        saving: undefined,
        mode: { kind: "idle" },
        notice: { level: "error", text: event.message },
      });
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
