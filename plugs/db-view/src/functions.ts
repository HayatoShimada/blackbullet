/**
 * The plug side of the db view: everything that touches the space. The pure
 * parts (`parseSpec`, `rows`, `edit`, `derive`) are beside it and tested alone;
 * this file only reads, writes and assembles.
 */
import {
  asset,
  index,
  lua,
  space,
  system,
} from "@silverbulletmd/silverbullet/syscalls";
import { syscall } from "@silverbulletmd/silverbullet/syscall";
import { panelStyles } from "@silverbulletmd/silverbullet/lib/panel_styles";
import { isoDate, matchesWhere } from "./derive.ts";
import { isStale, parseCellInput, setTaskDone, setTaskDue } from "./edit.ts";
import type { CellKind, DbRow, Spec } from "./model.ts";
import { countTasks, pageRow, taskRow } from "./rows.ts";
import { parseSpec } from "./spec.ts";

const PLUG_NAME = "db-view";

/** What the view is built from: the spec, and the rows it asked for. */
export type ViewModel = {
  spec: Spec;
  rows: DbRow[];
  /** More rows matched than were loaded. */
  truncated: boolean;
  /** Today, in the reader's time zone. */
  today: string;
};

async function tasksOf(): Promise<Record<string, any>[]> {
  return await index.queryLuaObjects<Record<string, any>>("task", {
    objectVariable: "_",
  });
}

async function pagesTagged(tag: string): Promise<Record<string, any>[]> {
  return await index.queryLuaObjects<Record<string, any>>(
    "page",
    {
      objectVariable: "_",
      where: await lua.parseExpression(
        "table.find(_.tags, function(t) return t == wanted end) ~= nil",
      ),
    },
    { wanted: tag },
  );
}

/** The rows a spec asks for, filtered by its `where` and cut to its limit. */
export async function loadRows(
  spec: Spec,
): Promise<{ rows: DbRow[]; truncated: boolean }> {
  let rows: DbRow[];
  if (spec.source.kind === "tasks") {
    rows = (await tasksOf()).map(taskRow);
  } else {
    const tag = spec.source.kind === "projects" ? "project" : spec.source.tag;
    const pages = await pagesTagged(tag);
    const counts =
      spec.source.kind === "projects" ? countTasks(await tasksOf()) : undefined;
    rows = pages.map((p) =>
      pageRow(
        p,
        counts
          ? (counts.get(String(p.name)) ?? { open: 0, done: 0 })
          : undefined,
      ),
    );
  }
  rows = rows.filter((r) => matchesWhere(r, spec.where));
  return {
    rows: rows.slice(0, spec.limit),
    truncated: rows.length > spec.limit,
  };
}

async function buildModel(spec: Spec): Promise<ViewModel> {
  const { rows, truncated } = await loadRows(spec);
  return { spec, rows, truncated, today: isoDate(new Date()) };
}

async function widgetOf(
  model: unknown,
): Promise<{ html: string; script: string }> {
  const [preamble, css, js] = await Promise.all([
    panelStyles(),
    asset.readAsset(PLUG_NAME, "assets/db-view.css"),
    asset.readAsset(PLUG_NAME, "assets/db-view.js"),
  ]);
  return {
    html: `${preamble}<style>${css}</style><div id="db-root"></div>`,
    // `var`, so the declaration hoists into the scope the bundle runs in.
    script: `var __DB = ${JSON.stringify(model)};\n${js}`,
  };
}

function errorWidget(message: string): { html: string; script: string } {
  const text = message.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return {
    html: `<div style="padding:12px;border:1px solid #c33;border-radius:6px;color:#c33;font-family:sans-serif;font-size:14px">db: ${text}</div>`,
    script: "",
  };
}

/** The code widget for a ```db block: the YAML in, an html + script out. */
export async function render(
  body: string,
  _pageName: string,
): Promise<{ html: string; script: string }> {
  let raw: unknown;
  try {
    raw = await syscall("yaml.parse", body);
  } catch (e) {
    return errorWidget(
      `YAML を読めません: ${e instanceof Error ? e.message : e}`,
    );
  }
  const parsed = parseSpec(raw);
  if (!parsed.ok) return errorWidget(parsed.error);
  try {
    return await widgetOf(await buildModel(parsed.spec));
  } catch (e) {
    return errorWidget(
      `読み込みに失敗しました: ${e instanceof Error ? e.message : e}`,
    );
  }
}

/**
 * The modification time the index holds for a page, or null if it has none.
 * After a write the index follows a moment later; this is how the panel knows
 * it has, whatever the page's rows then do (a write can move a row out of the
 * view's `where` or its `limit`, so its row is no proof either way).
 */
export async function indexedModified(page: string): Promise<string | null> {
  const found = await index.queryLuaObjects<Record<string, any>>(
    "page",
    {
      objectVariable: "_",
      where: await lua.parseExpression("_.name == wanted"),
    },
    { wanted: page },
  );
  return found.length > 0 ? String(found[0].lastModified ?? "") : null;
}

/** The rows again, for the panel to refresh itself after a write. */
export async function query(spec: Spec): Promise<ViewModel> {
  return await buildModel(spec);
}

export type WriteResult =
  | { ok: true; modified: string }
  | {
      ok: false;
      reason: "stale" | "not-a-task" | "invalid" | "failed";
      message: string;
    };

const STALE =
  "ページが変わっています。表示を更新して、もう一度操作してください";

/** The page's last change right now, as the index would record it. */
async function currentModified(page: string): Promise<string> {
  return String((await space.getPageMeta(page)).lastModified ?? "");
}

/** Sets or clears one frontmatter attribute. Refuses if the page has changed
 * since the row was read. */
export async function updatePageValue(
  page: string,
  key: string,
  kind: CellKind,
  input: string | boolean,
  modified: string,
): Promise<WriteResult> {
  const parsed = parseCellInput(kind, input);
  if (!parsed.ok)
    return { ok: false, reason: "invalid", message: parsed.error };
  try {
    if (isStale(modified, await currentModified(page))) {
      return { ok: false, reason: "stale", message: STALE };
    }
    const text = await space.readPage(page);
    const patch =
      parsed.value === null
        ? { op: "delete-key", path: key }
        : { op: "set-key", path: key, value: parsed.value };
    const next: string = await system.invokeFunction(
      "index.patchFrontmatter",
      text,
      [patch],
    );
    if (next === text) return { ok: true, modified };
    const meta = await space.writePage(page, next);
    return { ok: true, modified: String(meta.lastModified ?? "") };
  } catch (e) {
    return {
      ok: false,
      reason: "failed",
      message: e instanceof Error ? e.message : String(e),
    };
  }
}

export type TaskEdit =
  | { type: "done"; done: boolean }
  | { type: "due"; due: string | null };

/** Edits a task's line. Refuses if the page has changed since the row was
 * read, or the line no longer shows the task the index saw. */
export async function updateTask(
  page: string,
  pos: number,
  state: string,
  edit: TaskEdit,
  modified: string,
): Promise<WriteResult> {
  if (edit.type === "due" && edit.due !== null) {
    const parsed = parseCellInput("date", edit.due);
    if (!parsed.ok)
      return { ok: false, reason: "invalid", message: parsed.error };
  }
  try {
    if (isStale(modified, await currentModified(page))) {
      return { ok: false, reason: "stale", message: STALE };
    }
    const text = await space.readPage(page);
    const result =
      edit.type === "done"
        ? setTaskDone(text, pos, state, edit.done)
        : setTaskDue(text, pos, state, edit.due);
    if (!result.ok) {
      return {
        ok: false,
        reason: result.reason,
        message:
          result.reason === "stale"
            ? STALE
            : "その行はタスクではなくなっています",
      };
    }
    if (result.text === text) return { ok: true, modified };
    const meta = await space.writePage(page, result.text);
    return { ok: true, modified: String(meta.lastModified ?? "") };
  } catch (e) {
    return {
      ok: false,
      reason: "failed",
      message: e instanceof Error ? e.message : String(e),
    };
  }
}
