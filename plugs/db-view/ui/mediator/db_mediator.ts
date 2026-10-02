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
  matchesWhere,
  pageName,
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

/** Where a control sits in the iframe, for anchoring its popover. */
export type Rect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export type Mode =
  | { kind: "idle" }
  | { kind: "editing"; rowId: string; column: string }
  /** `over` is the column key (board) or ISO date / "" (calendar) the card is on. */
  | { kind: "dragging"; rowId: string; over: string | null }
  /** A new-row input is open, waiting for a title. `at` is where it sits (a
   * board column key or a calendar ISO date; absent: the header's), `values`
   * what the row starts with there; `title` what was typed and `error` why it
   * was refused, when the input comes back after a failed create. */
  | {
      kind: "creating";
      at?: string;
      values?: NewValues;
      title?: string;
      error?: string;
    }
  /** A row's "…" menu is open; `anchor` is the button it hangs from. */
  | { kind: "menu"; rowId: string; anchor?: Rect }
  /** The view header's "…" menu is open. */
  | { kind: "viewmenu"; anchor?: Rect }
  /** A row's title is being edited. */
  | { kind: "renaming"; rowId: string }
  /** Waiting for the reader to answer the host's "move to trash?" dialog. */
  | { kind: "confirming"; rowId: string }
  /** A write is in flight: one at a time, so a second edit is not started. */
  | { kind: "writing" };

export type Notice = { level: "info" | "error"; text: string };

/** How long a reversible action offers Undo. */
export const UNDO_MS = 8000;

/** What Undo does: a ticked task goes back to open, an archived row comes
 * back, a moved card goes back where it was. `row` is the row as it now stands (fresh modification time). */
export type UndoAction =
  /** `fresh: false`: the row comes from a rebuilt frame, where it may have been
   * remembered before its write landed: its modification time is read again
   * before Undo writes. */
  | { kind: "untick"; row: DbRow; index: number; fresh?: boolean }
  | { kind: "unarchive"; row: DbRow }
  /** A card dropped on another column or day goes back: `previous` is what
   * the attribute held ("" for none); `row` is the row as the drop left it. */
  | {
      kind: "revert";
      row: DbRow;
      column: string;
      cellKind: CellKind;
      previous: string;
    };

export type Undo = { id: number; label: string; action: UndoAction };

/** An Undo on offer, as it is kept when the editor rebuilds the page (and with
 * it this frame): what to show again, and when it runs out. */
export type PendingUndo = { undo: Undo; ghost: boolean; until: number };

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
  /** "Done · Undo" / "Archived · Undo": shown for `UNDO_MS`, then gone. */
  undo: Undo | null;
  undoSeq: number;
  /** The ticked task the source no longer lists, still drawn (struck
   * through) while its Undo is on offer. */
  ghost?: string;
  /** The drop that is being written: when it lands, "Moved to <place> · Undo"
   * is offered, and Undo writes `previous` back. */
  move?: { rowId: string; column: string; previous: string; label: string };
  /** What the new-row input held when it was submitted, so it can come back
   * if the create fails. */
  draft?: Extract<Mode, { kind: "creating" }>;
  reloading: boolean;
  /** The ```db block that drew the view: where "Save view" writes. */
  block?: { page: string; body: string };
  /** What "Save view" sent, so view.saved records that and not later edits. */
  saving?: { view: ViewKind; sort: Spec["sort"]; filter: string };
};

/** Whether "Save view" can be pressed now. */
export function canSaveView(state: DbState): boolean {
  return (
    (state.mode.kind === "idle" || state.mode.kind === "viewmenu") &&
    !!state.block &&
    viewDirty(state)
  );
}

/** The rows the header counts: a ticked task still on screen for its Undo
 * is already done. */
export function visibleCount(state: DbState): number {
  return state.rows.length - (state.ghost ? 1 : 0);
}

export type DbEvent =
  | { type: "view.set"; view: ViewKind }
  | { type: "phrase.set"; phrase: string }
  | { type: "sort.toggle"; key: string }
  | { type: "month.shift"; delta: number }
  | { type: "month.today" }
  | { type: "cell.edit"; rowId: string; column: string }
  /** A press on a cell: one click or tap is the edit (the pencil, Enter and
   * F2 are the same edit), except on a link the cell holds, which opens its
   * page. */
  | {
      type: "cell.tap";
      rowId: string;
      column: string;
      onLink: boolean;
    }
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
  | { type: "row.menu"; rowId: string; rect?: Rect }
  | { type: "row.menu.close" }
  /** The view header's "…": open (hanging from `rect`) or close. */
  | { type: "view.menu"; rect?: Rect }
  | { type: "view.menu.close" }
  /** The view menu's "Edit source": put the cursor in the block. */
  | { type: "source.edit" }
  /** "Undo" on the notice row, and its 8 seconds running out. */
  | { type: "undo.run" }
  | { type: "undo.expire"; id: number }
  /** The frame was rebuilt (the editor re-rendered the page) while Undo was on
   * offer: put the notice, and the struck-through task, back for the `ms`
   * that were left. `ghost`: the task was not in the list any more. */
  | { type: "undo.restore"; undo: Undo; ghost: boolean; ms: number }
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
  | { type: "row.done"; message: string; undo?: { label: string; row: DbRow } }
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
      /** Read the page's modification time again before writing. */
      refresh?: boolean;
    }
  | { type: "reload" }
  /** Ask the host's dialog whether to move `row` to trash. */
  | { type: "confirmTrash"; row: DbRow }
  /** Tell the machine `ms` from now that undo `id` has run out. */
  | { type: "timer"; id: number; ms: number }
  | {
      type: "saveView";
      view: ViewKind;
      sort: Spec["sort"];
      filter: string;
    }
  | { type: "navigate"; target: string }
  /** Put the editor's cursor inside the ```db block that drew the view. */
  | { type: "editSource" }
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
    undo: null,
    undoSeq: 0,
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

/** The attribute the board's columns are made of. Tasks have no status, so a
 * tasks board groups by the page (the project) that holds them. */
export function groupKey(state: Pick<DbState, "spec">): string {
  return state.spec.source.kind === "tasks" && state.spec.group === "status"
    ? "page"
    : state.spec.group;
}

/** The attribute a drop writes, and the value: a board column sets the group's
 * attribute, a calendar day sets the date's. A task cannot change page, so a
 * board of tasks by page takes no drops. */
function dropWrite(
  state: DbState,
  target: string,
): { column: string; value: string } | null {
  if (state.view === "board") {
    const column = groupKey(state);
    return column === "page" && state.spec.source.kind === "tasks"
      ? null
      : { column, value: target };
  }
  if (state.view === "calendar")
    return { column: state.spec.date, value: target };
  return null;
}

/** Where a drop put the card, in words: the column's name, the day, or the
 * place for "none". */
function dropLabel(state: DbState, target: string): string {
  if (state.view === "calendar") return target === "" ? "No date" : target;
  return target === "" ? "None" : target;
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

    case "cell.tap":
      return event.onLink
        ? stay(state)
        : transition(state, {
            type: "cell.edit",
            rowId: event.rowId,
            column: event.column,
          });
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
      const before = valueOf(row, write.column);
      return {
        state: {
          ...state,
          mode: { kind: "writing" },
          notice: null,
          // A move is a mutation: when it lands, Undo is on offer.
          move: {
            rowId: row.id,
            column: write.column,
            previous:
              before === undefined || before === null ? "" : String(before),
            label: `Moved to ${dropLabel(state, event.target)}`,
          },
        },
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
        state: {
          ...state,
          mode: { kind: "writing" },
          notice: null,
          draft: {
            kind: "creating",
            ...(creating?.at !== undefined ? { at: creating.at } : {}),
            ...(creating?.values ? { values: creating.values } : {}),
            title,
          },
        },
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
        state: {
          ...state,
          mode: { kind: "idle" },
          draft: undefined,
          reloading: true,
        },
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
      // The input comes back with what was typed and the reason beneath it.
      return stay({
        ...state,
        draft: undefined,
        mode: state.draft
          ? { ...state.draft, error: event.message }
          : { kind: "idle" },
        notice: state.draft ? null : { level: "error", text: event.message },
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
      return stay({
        ...state,
        mode: {
          kind: "menu",
          rowId: row.id,
          ...(event.rect ? { anchor: event.rect } : {}),
        },
      });
    }
    case "view.menu": {
      if (state.mode.kind === "viewmenu") {
        return stay({ ...state, mode: { kind: "idle" } });
      }
      if (state.mode.kind !== "idle") return stay(state);
      return stay({
        ...state,
        mode: {
          kind: "viewmenu",
          ...(event.rect ? { anchor: event.rect } : {}),
        },
      });
    }
    case "source.edit": {
      if (!state.block) return stay(state);
      return {
        state:
          state.mode.kind === "viewmenu"
            ? { ...state, mode: { kind: "idle" } }
            : state,
        effects: [{ type: "editSource" }],
      };
    }
    case "view.menu.close":
      return stay(
        state.mode.kind === "viewmenu"
          ? { ...state, mode: { kind: "idle" } }
          : state,
      );
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
      const row = rowById(state, event.rowId);
      if (!row) return stay({ ...state, mode: { kind: "idle" } });
      // The menu closes and the host's dialog asks; the answer comes back as
      // row.delete.confirm or row.menu.close.
      return {
        state: { ...state, mode: { kind: "confirming", rowId: event.rowId } },
        effects: [{ type: "confirmTrash", row }],
      };
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
    case "row.done": {
      if (event.undo) {
        const id = state.undoSeq + 1;
        return {
          state: {
            ...state,
            mode: { kind: "idle" },
            reloading: true,
            notice: null,
            undoSeq: id,
            undo: {
              id,
              label: event.message,
              action: { kind: "unarchive", row: event.undo.row },
            },
          },
          effects: [{ type: "reload" }, { type: "timer", id, ms: UNDO_MS }],
        };
      }
      return {
        state: {
          ...state,
          mode: { kind: "idle" },
          reloading: true,
          notice: { level: "info", text: event.message },
        },
        effects: [{ type: "reload" }],
      };
    }
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
      if (busy || state.reloading) {
        return stay(
          state.mode.kind === "viewmenu"
            ? { ...state, mode: { kind: "idle" } }
            : state,
        );
      }
      return {
        state: {
          ...state,
          mode: state.mode.kind === "viewmenu" ? { kind: "idle" } : state.mode,
          reloading: true,
        },
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
        notice: { level: "info", text: "View saved" },
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
      // An earlier tick's struck-through row makes way for this one.
      const base =
        state.ghost && state.ghost !== event.rowId
          ? state.rows.filter((r) => r.id !== state.ghost)
          : state.rows;
      const index = base.findIndex((r) => r.id === event.rowId);
      const rows = base.map((r) => {
        if (r.id !== event.rowId) return r;
        const values = { ...r.values };
        if (event.value === null) delete values[event.column];
        else values[event.column] = event.value;
        return {
          ...r,
          values,
          modified: event.modified,
          ...(r.kind === "task" && event.column === "done"
            ? { state: event.value === true ? "x" : " " }
            : {}),
        };
      });
      const updated = rows[index];
      const next: DbState = {
        ...state,
        rows,
        mode: { kind: "idle" },
        reloading: true,
        ghost: undefined,
        move: undefined,
      };
      const effects: DbEffect[] = [
        // A write can move other rows' positions on the same page: read again.
        { type: "reload" },
      ];
      if (updated?.kind === "task" && event.column === "done") {
        if (event.value === true) {
          // Ticking never makes the row vanish silently: it stays, struck
          // through, for the time Undo is on offer.
          const id = state.undoSeq + 1;
          effects.push({ type: "timer", id, ms: UNDO_MS });
          return {
            state: {
              ...next,
              undoSeq: id,
              undo: {
                id,
                label: "Done",
                action: { kind: "untick", row: updated, index },
              },
              ghost: matchesWhere(updated, state.spec.where, state.today)
                ? undefined
                : updated.id,
            },
            effects,
          };
        }
        // Un-ticked (by Undo, or by hand): nothing left to undo.
        return { state: { ...next, undo: null }, effects };
      }
      const move = state.move;
      if (
        updated &&
        move &&
        move.rowId === event.rowId &&
        move.column === event.column
      ) {
        // A card moved is a mutation like a tick: "Moved to <place> · Undo".
        const id = state.undoSeq + 1;
        effects.push({ type: "timer", id, ms: UNDO_MS });
        return {
          state: {
            ...next,
            undoSeq: id,
            undo: {
              id,
              label: move.label,
              action: {
                kind: "revert",
                row: updated,
                column: move.column,
                cellKind: columnKind(
                  move.column,
                  state.rows,
                  state.spec.database,
                ),
                previous: move.previous,
              },
            },
          },
          effects,
        };
      }
      return { state: next, effects };
    }
    case "undo.run": {
      const undo = state.undo;
      if (!undo || busy || state.mode.kind === "confirming") return stay(state);
      const cleared: DbState = {
        ...state,
        undo: null,
        mode: { kind: "writing" },
        notice: null,
      };
      if (undo.action.kind === "untick") {
        const row = undo.action.row;
        // The row is still drawn (struck through); it is open again once
        // the write lands.
        return {
          state: cleared,
          effects: [
            {
              type: "write",
              row,
              column: "done",
              kind: "boolean",
              value: false,
              ...(undo.action.fresh === false ? { refresh: true } : {}),
            },
          ],
        };
      }
      if (undo.action.kind === "revert") {
        const a = undo.action;
        return {
          state: cleared,
          effects: [
            {
              type: "write",
              row: a.row,
              column: a.column,
              kind: a.cellKind,
              value: a.previous,
              ...databaseOf(state),
            },
          ],
        };
      }
      return {
        state: cleared,
        effects: [
          {
            type: "rowAction",
            action: "archive",
            row: undo.action.row,
            archived: false,
          },
        ],
      };
    }
    case "undo.restore": {
      if (state.undo || state.mode.kind !== "idle" || event.ms <= 0) {
        return stay(state);
      }
      const id = state.undoSeq + 1;
      let undo: Undo = { ...event.undo, id };
      let rows = state.rows;
      let ghost: string | undefined;
      if (undo.action.kind === "untick") {
        // The ticked task, as the tick left it: struck through where it was.
        // Its modification time is the page's now (the tick may have been
        // remembered before its write landed), so Undo does not find it stale.
        const was = undo.action;
        const listed = rows.find((r) => r.id === was.row.id);
        const row = listed
          ? { ...was.row, modified: listed.modified }
          : was.row;
        undo = { ...undo, action: { ...was, row, fresh: false } };
        if (listed) {
          rows = rows.map((r) => (r.id === row.id ? row : r));
        } else if (event.ghost) {
          const at = Math.min(was.index, rows.length);
          rows = [...rows.slice(0, at), row, ...rows.slice(at)];
        }
        ghost = event.ghost ? row.id : undefined;
      }
      return {
        state: {
          ...state,
          rows,
          ghost,
          undoSeq: id,
          undo,
        },
        effects: [{ type: "timer", id, ms: event.ms }],
      };
    }
    case "undo.expire": {
      if (state.undo?.id !== event.id) return stay(state);
      return stay({
        ...state,
        undo: null,
        ghost: undefined,
        rows: state.ghost
          ? state.rows.filter((r) => r.id !== state.ghost)
          : state.rows,
      });
    }
    case "write.failed":
      return {
        state: {
          ...state,
          mode: { kind: "idle" },
          move: undefined,
          notice: { level: "error", text: event.message },
          // A reload may already be in flight (after a write): leave it be.
          reloading: event.reason === "stale" ? true : state.reloading,
        },
        // A stale write means what is on screen is old: bring it up to date.
        effects: event.reason === "stale" ? [{ type: "reload" }] : [],
      };
    case "rows.loaded": {
      // The ticked task the source no longer lists stays where it was.
      const undo = state.undo;
      const keep =
        state.ghost && undo?.action.kind === "untick" ? undo.action : null;
      const rows =
        keep && !event.rows.some((r) => r.id === keep.row.id)
          ? [
              ...event.rows.slice(0, keep.index),
              keep.row,
              ...event.rows.slice(keep.index),
            ]
          : event.rows;
      return stay({
        ...state,
        ghost: keep && rows !== event.rows ? state.ghost : undefined,
        rows,
        truncated: event.truncated,
        today: event.today,
        reloading: false,
      });
    }
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

/** The last segment of a page name: a project's column or card title. */
const lastSegment = pageName;

/** The board's columns: by the group attribute, tasks by their page (named
 * without the folder), and no empty columns when the "None" column holds
 * every row (nothing to sort them by yet). */
function boardGroups(state: DbState, rows: DbRow[]): Group[] {
  const key = groupKey(state);
  let groups = groupRows(
    sortRows(rows, { key: "due", desc: false }),
    key,
    state.spec.order,
  );
  if (
    rows.length > 0 &&
    groups.some((g) => g.key === "" && g.rows.length === rows.length)
  ) {
    groups = groups.filter((g) => g.rows.length > 0);
  }
  return key === "page"
    ? groups.map((g) =>
        g.key === "" ? g : { ...g, label: lastSegment(g.key) },
      )
    : groups;
}

/** The column a header "+ New" lands in on the board: the one the group
 * property's declared default names, else the first. */
export function newRowGroup(
  state: DbState,
  groups: Group[],
): string | undefined {
  const declared = state.spec.database?.properties.find(
    (p) => p.key === groupKey(state),
  )?.default;
  const named = groups.find((g) => g.key === String(declared));
  return (named ?? groups[0])?.key;
}

/** What each view paints, derived from the state. */
export function selectView(state: DbState): DbView {
  const filtered = filterRows(state.rows, state.phrase);
  const columns = columnsFor(state.rows, state.spec);
  const sorted = sortRows(filtered, state.sort);
  const { byDay, undated } = rowsByDate(filtered, state.spec.date);
  return {
    columns,
    rows: sorted,
    groups: boardGroups(state, filtered),
    weeks: monthGrid(state.month.year, state.month.month, state.spec.weekStart),
    byDay,
    undated,
  };
}

/** The new-row input that is open (or waiting on its create), and where. */
export type NewRow = {
  at?: string;
  title: string;
  error?: string;
  /** The create is in flight: the input is read-only. */
  busy: boolean;
};

export function newRowOf(state: DbState): NewRow | null {
  if (!state.spec.database) return null;
  const m = state.mode;
  if (m.kind === "creating") {
    return {
      ...(m.at !== undefined ? { at: m.at } : {}),
      title: m.title ?? "",
      ...(m.error ? { error: m.error } : {}),
      busy: false,
    };
  }
  if (m.kind === "writing" && state.draft) {
    return {
      ...(state.draft.at !== undefined ? { at: state.draft.at } : {}),
      title: state.draft.title ?? "",
      busy: true,
    };
  }
  return null;
}
