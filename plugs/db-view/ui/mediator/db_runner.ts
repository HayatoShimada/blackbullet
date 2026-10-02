import type {
  CreateResult,
  RowResult,
  SaveViewResult,
  TaskEdit,
  ViewModel,
  WriteResult,
} from "../../src/functions.ts";
import type { NewValues } from "../../src/create.ts";
import type { CellKind, Spec } from "../../src/model.ts";
import type { SavedView } from "../../src/viewblock.ts";
import {
  type DbEffect,
  type DbEvent,
  type DbState,
  transition,
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
  /** Told after every transition that changed the state. */
  onState(state: DbState): void;
  /** Waits `ms`; injected so a test does not have to. */
  sleep?(ms: number): Promise<void>;
};

export type DbRunner = {
  /** The one door into the machine: views emit, nothing else. */
  emit(event: DbEvent): void;
  getState(): DbState;
};

const ROW_DONE = {
  delete: "ゴミ箱へ移しました",
  archive: "アーカイブを切り替えました",
  duplicate: "複製しました",
  rename: "名前を変えました",
};

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function createDbRunner(initial: DbState, deps: DbRunnerDeps): DbRunner {
  let state = initial;
  // The pages written since the last read, and the modification time each write
  // gave them: a read has to wait for the index to show these.
  const written = new Map<string, string | null>();

  function emit(event: DbEvent): void {
    const next = transition(state, event);
    const changed = next.state !== state;
    state = next.state;
    for (const effect of next.effects) void run(effect);
    if (changed) deps.onState(state);
  }

  async function write(effect: Extract<DbEffect, { type: "write" }>) {
    const { row, column, kind, value } = effect;
    let result: WriteResult;
    try {
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
          message: "このタスクの位置が分かりません",
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
          message: "タスクでは、完了と期限だけを書き換えられます",
        };
      }
    } catch (e) {
      result = { ok: false, reason: "failed", message: errorMessage(e) };
    }
    if (!result.ok) {
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
        message: "保存先のブロックがありません",
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
            message: `読み込みに失敗しました: ${errorMessage(e)}`,
          });
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
