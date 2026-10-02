import type {
  CreateResult,
  RowResult,
  SaveViewResult,
  TaskEdit,
  ViewModel,
  WriteResult,
} from "../../src/functions.ts";
import type { NewValues } from "../../src/create.ts";
import { matchesWhere } from "../../src/derive.ts";
import type { CellKind, DbRow, Spec } from "../../src/model.ts";
import type { SavedView } from "../../src/viewblock.ts";
import {
  type DbEffect,
  type DbEvent,
  type DbState,
  type PendingUndo,
  transition,
  UNDO_MS,
} from "./db_mediator.ts";

/** Everything the runner touches outside the pure machine: the plug's
 * functions, reached from the iframe by syscall. */
/** How long a read after a write waits for the index to catch up with it. */
export const INDEX_WAIT_MS = 400;
export const INDEX_WAIT_TRIES = 12;

export type DbRunnerDeps = {
  updatePageValue(
    page: string,
    key: string,
    kind: CellKind,
    input: string | boolean,
    modified: string,
    database?: string,
  ): Promise<WriteResult>;
  updateTask(
    page: string,
    pos: number,
    state: string,
    edit: TaskEdit,
    modified: string,
  ): Promise<WriteResult>;
  query(spec: Spec): Promise<ViewModel>;
  /** A new row of the spec's database, named `title`, starting with `values`. */
  createRow(
    spec: Spec,
    title: string,
    values?: NewValues,
  ): Promise<CreateResult>;
  deleteRow(spec: Spec, page: string, modified: string): Promise<RowResult>;
  archiveRow(
    spec: Spec,
    page: string,
    archived: boolean,
    modified: string,
  ): Promise<RowResult>;
  duplicateRow(spec: Spec, page: string, modified: string): Promise<RowResult>;
  renameRow(
    spec: Spec,
    page: string,
    title: string,
    modified: string,
  ): Promise<RowResult>;
  /** Writes tab, sort and filter phrase into the block that drew the view. */
  saveView(
    page: string,
    body: string,
    saved: SavedView,
  ): Promise<SaveViewResult>;
  /** The modification time the index holds for a page (null: none). */
  indexedModified(page: string): Promise<string | null>;
  navigate(target: string): Promise<void>;
  /** Moves the editor's cursor into the block of `body` on `page`; false when
   * the block is not there (it changed since it was drawn). */
  editSource(page: string, body: string): Promise<boolean>;
  /** The host's confirmation dialog (`editor.confirm`). */
  confirm(
    message: string,
    options?: { destructive?: boolean; okLabel?: string },
  ): Promise<boolean>;
  /** Told after every transition that changed the state. */
  onState(state: DbState): void;
  /** Keeps the Undo on offer (null: none) where a rebuilt frame can find it. */
  remember?(pending: PendingUndo | null): void;
  /** The time, injected so a test does not have to wait. */
  now?(): number;
  /** Waits `ms`; injected so a test does not have to. */
  sleep?(ms: number): Promise<void>;
};

export type DbRunner = {
  /** The one door into the machine: views emit, nothing else. */
  emit(event: DbEvent): void;
  getState(): DbState;
};

const ROW_DONE = {
  delete: "Moved to trash. You can restore it from Trash.",
  duplicate: "Duplicated",
  rename: "Renamed",
};

/** The host dialog's question: the object's name, then the consequence. */
export const trashQuestion = (title: string) =>
  `Move ${title} to trash? You can restore it from Trash.`;

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** What brings an Undo back after the frame was rebuilt: the notice for the
 * time it had left, or nothing when that has run out. */
export function restoreEvent(
  pending: PendingUndo | null,
  now: number,
): DbEvent | null {
  if (!pending) return null;
  const ms = pending.until - now;
  // A `until` far in the future is not ours: it is never longer than UNDO_MS.
  if (!(ms > 0) || ms > UNDO_MS) return null;
  return { type: "undo.restore", undo: pending.undo, ghost: pending.ghost, ms };
}

export function createDbRunner(initial: DbState, deps: DbRunnerDeps): DbRunner {
  let state = initial;
  let until = 0;
  // The pages written since the last read, and the modification time each write
  // gave them: a read has to wait for the index to show these.
  const written = new Map<string, string | null>();

  function emit(event: DbEvent): void {
    const before = state;
    const next = transition(state, event);
    const changed = next.state !== state;
    state = next.state;
    for (const effect of next.effects) void run(effect);
    if (changed) deps.onState(state);
    if (state.undo !== before.undo || state.ghost !== before.ghost) {
      keepUndo(event, before);
    }
  }

  /** The Undo on offer outlives this frame: the editor rebuilds the page (when
   * its index finishes, say) and a tick's "Done · Undo" must not go with it. */
  function keepUndo(event: DbEvent, before: DbState): void {
    if (!deps.remember) return;
    const now = deps.now?.() ?? Date.now();
    if (state.undo && state.undo !== before.undo) {
      until = now + (event.type === "undo.restore" ? event.ms : UNDO_MS);
    }
    deps.remember(
      state.undo
        ? { undo: state.undo, ghost: state.ghost !== undefined, until }
        : null,
    );
  }

  /** A tick's Undo is kept when the tick is issued, not when the write lands:
   * the editor may rebuild the page while the write is in flight, and the new
   * frame then still has the Undo (and the struck-through row) to show. The
   * landed write replaces this with the real modification time. */
  function rememberTick(
    effect: Extract<DbEffect, { type: "write" }>,
  ): number | null {
    const { row, column, value } = effect;
    if (!deps.remember || row.kind !== "task" || column !== "done") return null;
    if (value !== true && value !== "true") return null;
    const index = state.rows.findIndex((r) => r.id === row.id);
    if (index < 0) return null;
    const ticked: DbRow = {
      ...row,
      values: { ...row.values, done: true },
      state: "x",
    };
    const previous = until;
    until = (deps.now?.() ?? Date.now()) + UNDO_MS;
    deps.remember({
      undo: {
        id: state.undoSeq + 1,
        label: "Done",
        action: { kind: "untick", row: ticked, index },
      },
      ghost: !matchesWhere(ticked, state.spec.where, state.today),
      until,
    });
    return previous;
  }

  /** Puts back what was remembered before a tick that failed. */
  function forgetTick(previous: number): void {
    until = previous;
    deps.remember?.(
      state.undo
        ? { undo: state.undo, ghost: state.ghost !== undefined, until }
        : null,
    );
  }

  async function write(effect: Extract<DbEffect, { type: "write" }>) {
    const { column, kind, value } = effect;
    let row = effect.row;
    let result: WriteResult;
    const before = rememberTick(effect);
    try {
      if (effect.refresh) {
        const modified = await deps.indexedModified(row.page);
        if (modified) row = { ...row, modified };
      }
      if (row.kind === "page") {
        result = await deps.updatePageValue(
          row.page,
          column,
          kind,
          value,
          row.modified,
          ...(effect.database ? [effect.database] : []),
        );
      } else if (!row.range) {
        result = {
          ok: false,
          reason: "failed",
          message: "That task could not be located in its page.",
        };
      } else if (column === "done") {
        result = await deps.updateTask(
          row.page,
          row.range[0],
          row.state ?? " ",
          { type: "done", done: value === true || value === "true" },
          row.modified,
        );
      } else if (column === "due") {
        const text = String(value).trim();
        result = await deps.updateTask(
          row.page,
          row.range[0],
          row.state ?? " ",
          { type: "due", due: text === "" ? null : text },
          row.modified,
        );
      } else {
        result = {
          ok: false,
          reason: "invalid",
          message: "A task can only change its Done and Due.",
        };
      }
    } catch (e) {
      result = { ok: false, reason: "failed", message: errorMessage(e) };
    }
    if (!result.ok) {
      // The tick did not happen: what was on offer before is on offer again.
      if (before !== null) forgetTick(before);
      emit({
        type: "write.failed",
        reason: result.reason,
        message: result.message,
      });
      return;
    }
    // What the cell now holds, as the page will have it: a date or a number
    // the plug parsed, else the text as typed.
    const stored =
      kind === "boolean"
        ? value === true || value === "true"
        : storedValue(kind, value);
    written.set(row.page, result.modified);
    emit({
      type: "write.done",
      rowId: row.id,
      column,
      value: stored,
      modified: result.modified,
    });
  }

  const sleep =
    deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  /** The index follows a write a moment later: until it shows a page's new
   * modification time, a read would bring that page's old values back. Asked of
   * the page itself, not of its row, which a write may have moved out of the
   * view. Gives up quietly after a few seconds; either way nothing is left
   * waiting, so a later read is not made to wait again. */
  async function awaitIndex(): Promise<boolean> {
    const pending = [...written];
    written.clear();
    for (const [page, modified] of pending) {
      let caught = false;
      for (let i = 0; i <= INDEX_WAIT_TRIES && !caught; i++) {
        if (i > 0) await sleep(INDEX_WAIT_MS);
        try {
          caught = (await deps.indexedModified(page)) === modified;
        } catch {
          return false;
        }
      }
      if (!caught) return false;
    }
    return true;
  }

  async function rowAction(
    effect: Extract<DbEffect, { type: "rowAction" }>,
  ): Promise<void> {
    const { row, action } = effect;
    let result: RowResult;
    try {
      if (action === "delete") {
        result = await deps.deleteRow(state.spec, row.page, row.modified);
      } else if (action === "archive") {
        result = await deps.archiveRow(
          state.spec,
          row.page,
          effect.archived === true,
          row.modified,
        );
      } else if (action === "duplicate") {
        result = await deps.duplicateRow(state.spec, row.page, row.modified);
      } else {
        result = await deps.renameRow(
          state.spec,
          row.page,
          effect.title ?? "",
          row.modified,
        );
      }
    } catch (e) {
      result = { ok: false, reason: "failed", message: errorMessage(e) };
    }
    if (!result.ok) {
      emit({
        type: "row.failed",
        reason: result.reason,
        message: result.message,
      });
      return;
    }
    // The read that follows waits for the index to show it: the old name gone
    // (null), the new page there.
    if (result.page !== row.page) written.set(row.page, null);
    if (action === "delete") written.set(row.page, null);
    else written.set(result.page, result.modified);
    if (action === "archive") {
      // Archiving is reversible: the view offers Undo for a while.
      emit(
        effect.archived === true
          ? {
              type: "row.done",
              message: "Archived",
              undo: {
                label: "Archived",
                row: {
                  ...row,
                  values: { ...row.values, archived: true },
                  modified: result.modified ?? row.modified,
                },
              },
            }
          : { type: "row.done", message: "Restored" },
      );
      return;
    }
    emit({ type: "row.done", message: ROW_DONE[action] });
  }

  async function create(
    effect: Extract<DbEffect, { type: "create" }>,
  ): Promise<void> {
    let result: CreateResult;
    try {
      result = effect.values
        ? await deps.createRow(state.spec, effect.title, effect.values)
        : await deps.createRow(state.spec, effect.title);
    } catch (e) {
      result = { ok: false, reason: "failed", message: errorMessage(e) };
    }
    if (!result.ok) {
      emit({ type: "create.failed", message: result.message });
      return;
    }
    // The read that follows waits for the index to show the new page.
    written.set(result.page, result.modified);
    emit({ type: "create.done", page: result.page, open: effect.open });
  }

  async function save(
    effect: Extract<DbEffect, { type: "saveView" }>,
  ): Promise<void> {
    const block = state.block;
    if (!block) {
      emit({
        type: "view.save.failed",
        message: "This view has no block to save to.",
      });
      return;
    }
    let result: SaveViewResult;
    try {
      result = await deps.saveView(block.page, block.body, {
        view: effect.view,
        ...(effect.sort ? { sort: effect.sort } : {}),
        filter: effect.filter,
      });
    } catch (e) {
      result = { ok: false, reason: "failed", message: errorMessage(e) };
    }
    emit(
      result.ok
        ? { type: "view.saved", body: result.body }
        : { type: "view.save.failed", message: result.message },
    );
  }

  async function run(effect: DbEffect): Promise<void> {
    switch (effect.type) {
      case "write":
        return write(effect);
      case "rowAction":
        return rowAction(effect);
      case "create":
        return create(effect);
      case "saveView":
        return save(effect);
      case "reload":
        try {
          // Still behind after all that: keep what the write already showed.
          if (!(await awaitIndex())) {
            emit({ type: "rows.failed", message: "" });
            return;
          }
          const model = await deps.query(state.spec);
          emit({
            type: "rows.loaded",
            rows: model.rows,
            truncated: model.truncated,
            today: model.today,
          });
        } catch (e) {
          emit({
            type: "rows.failed",
            message: `Could not reload. ${errorMessage(e)}`,
          });
        }
        return;
      case "confirmTrash": {
        let ok = false;
        try {
          ok = await deps.confirm(trashQuestion(effect.row.title), {
            destructive: true,
            okLabel: "Move to trash",
          });
        } catch {
          ok = false;
        }
        emit(ok ? { type: "row.delete.confirm" } : { type: "row.menu.close" });
        return;
      }
      case "timer":
        await sleep(effect.ms);
        emit({ type: "undo.expire", id: effect.id });
        return;
      case "editSource":
        try {
          const at = state.block;
          if (!at || !(await deps.editSource(at.page, at.body))) {
            emit({
              type: "rows.failed",
              message:
                "The block changed since it was shown. Reopen the page and try again.",
            });
          }
        } catch (e) {
          emit({ type: "rows.failed", message: errorMessage(e) });
        }
        return;
      case "navigate":
        try {
          await deps.navigate(effect.target);
        } catch (e) {
          emit({ type: "rows.failed", message: errorMessage(e) });
        }
        return;
    }
  }

  return { emit, getState: () => state };
}

function storedValue(
  kind: CellKind,
  value: string | boolean,
): string | number | null {
  const text = String(value).trim();
  if (text === "") return null;
  if (kind === "number") return Number(text);
  return text;
}
