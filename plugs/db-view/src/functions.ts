/**
 * The plug side of the db view: everything that touches the space. The pure
 * parts (`parseSpec`, `rows`, `edit`, `derive`) are beside it and tested alone;
 * this file only reads, writes and assembles.
 */
import {
  asset,
  config,
  index,
  lua,
  space,
  system,
} from "@silverbulletmd/silverbullet/syscalls";
import { syscall } from "@silverbulletmd/silverbullet/syscall";
import { panelStyles } from "@silverbulletmd/silverbullet/lib/panel_styles";
import {
  copyName,
  expandExpression,
  inheritedFrontmatter,
  type NewValues,
  renamedPage,
  rowPageName,
  rowPatches,
  valuePatches,
} from "./create.ts";
import { isoDate, matchesWhere, pageName } from "./derive.ts";
import {
  isStale,
  parseCellInput,
  parsePropertyInput,
  setTaskDone,
  setTaskDue,
} from "./edit.ts";
import type { CellKind, DatabaseSpec, DbRow, Spec } from "./model.ts";
import { countTasks, isListedTaskPage, pageRow, taskRow } from "./rows.ts";
import { replaceBlock, patchBlockBody, type SavedView } from "./viewblock.ts";
import { databaseFrom, databaseName, parseSpec } from "./spec.ts";

const PLUG_NAME = "db-view";

/** The refusal for a name that is taken: names the page, not its folder path. */
export const exists = (page: string) =>
  `A page named ${pageName(page)} already exists.`;

/** What the view is built from: the spec, and the rows it asked for. */
export type ViewModel = {
  spec: Spec;
  rows: DbRow[];
  /** More rows matched than were loaded. */
  truncated: boolean;
  /** Today, in the reader's time zone. */
  today: string;
  /** The ```db block that drew this view, for "Save view" (absent on a
   * re-read: the panel already holds it). */
  block?: { page: string; body: string };
};

async function tasksOf(): Promise<Record<string, any>[]> {
  const tasks = await index.queryLuaObjects<Record<string, any>>("task", {
    objectVariable: "_",
  });
  // Tasks of a template, a library page or a trashed page are out of every view.
  return tasks.filter((t) => isListedTaskPage(t.page));
}

/** Where deleted rows go: a page there is out of every view. */
export const TRASH = "Trash/";

async function pagesTagged(tag: string): Promise<Record<string, any>[]> {
  const found = await pagesWithTag(tag);
  return found.filter((p) => !String(p.name).startsWith(TRASH));
}

async function pagesWithTag(tag: string): Promise<Record<string, any>[]> {
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
  today: string = isoDate(new Date()),
): Promise<{ rows: DbRow[]; truncated: boolean }> {
  let rows: DbRow[];
  if (spec.source.kind === "tasks") {
    rows = (await tasksOf()).map(taskRow);
  } else {
    const tag = spec.source.kind === "projects" ? "project" : spec.source.tag;
    const folder = spec.database?.folder;
    const pages = (await pagesTagged(tag)).filter(
      (p) => !folder || String(p.name).startsWith(folder),
    );
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
  // A `where` on `archived` is an explicit ask, so it is not filtered twice.
  if (!spec.showArchived && !("archived" in spec.where))
    rows = rows.filter((r) => r.values.archived !== true);
  rows = rows.filter((r) => matchesWhere(r, spec.where, today));
  return {
    rows: rows.slice(0, spec.limit),
    truncated: rows.length > spec.limit,
  };
}

async function buildModel(spec: Spec): Promise<ViewModel> {
  const today = isoDate(new Date());
  const { rows, truncated } = await loadRows(spec, today);
  return { spec, rows, truncated, today };
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
  pageName: string,
): Promise<{ html: string; script: string }> {
  let raw: unknown;
  try {
    raw = await syscall("yaml.parse", body);
  } catch (e) {
    return errorWidget(
      `Cannot read the YAML: ${e instanceof Error ? e.message : e}`,
    );
  }
  const parsed = parseSpec(raw, await databaseOf(databaseName(raw)));
  if (!parsed.ok) return errorWidget(parsed.error);
  try {
    return await widgetOf({
      ...(await buildModel(parsed.spec)),
      block: { page: pageName, body },
    });
  } catch (e) {
    return errorWidget(
      `Could not load the view: ${e instanceof Error ? e.message : e}`,
    );
  }
}

/** The database `database.define` stored under `name`, if there is one. */
async function databaseOf(
  name: string | undefined,
): Promise<DatabaseSpec | undefined> {
  if (!name) return undefined;
  return databaseFrom(await config.get(["databases", name], null));
}

export type CreateResult =
  | { ok: true; page: string; modified: string }
  | {
      ok: false;
      reason: "exists" | "invalid" | "failed";
      message: string;
    };

/**
 * What a template gives a new row: its body with `${...}` expanded (title,
 * page and database are in scope), and the frontmatter attributes it carries
 * (a `frontmatter:` key is the page's own, as for page templates).
 */
async function expandedTemplate(
  template: string,
  ctx: { title: string; page: string; database: string },
): Promise<{ body: string; inherited: Record<string, unknown> }> {
  const expand = async (text: string): Promise<string> => {
    if (!text.includes("${")) return text;
    try {
      return String(await lua.evalExpression(expandExpression(text, ctx)));
    } catch (e) {
      // A mistake in the template, not in the row: say which template and
      // what it may use, rather than writing a page that says "nil".
      throw new Error(
        `The template ${template} could not be filled in (${e instanceof Error ? e.message : e}). It can use \${title}, \${page} and \${database}.`,
      );
    }
  };
  const extracted: {
    frontmatter?: Record<string, unknown>;
    text: string;
  } = await system.invokeFunction(
    "index.extractFrontmatter",
    await space.readPage(template),
    { removeFrontMatterSection: true },
  );
  const fm = { ...(extracted.frontmatter ?? {}) };
  let own: Record<string, unknown> = {};
  const declared = fm.frontmatter;
  if (typeof declared === "string") {
    const parsed = await syscall("yaml.parse", await expand(declared));
    if (parsed && typeof parsed === "object") own = parsed;
  } else if (declared && typeof declared === "object") {
    own = declared as Record<string, unknown>;
  }
  const inherited = inheritedFrontmatter({ ...fm, ...own });
  for (const [k, v] of Object.entries(inherited)) {
    if (typeof v === "string") inherited[k] = await expand(v);
  }
  return { body: await expand(extracted.text), inherited };
}

/**
 * Makes a new row of the spec's database: a page in its folder, tagged, with
 * every property's default, and the template's body when it has one. `values`
 * are set last (a board column's value, a calendar day).
 */
export async function createRow(
  spec: Spec,
  title: string,
  values?: NewValues,
): Promise<CreateResult> {
  // The iframe sends the spec back; what is written is decided by the config.
  const database = spec.database
    ? await databaseOf(spec.database.name)
    : undefined;
  if (!database) {
    return {
      ok: false,
      reason: "invalid",
      message: "This view has no database to add rows to.",
    };
  }
  const page = rowPageName(database.folder, title);
  if (!page) {
    return { ok: false, reason: "invalid", message: "Enter a name." };
  }
  const given = valuePatches(database, values, spec.date);
  if (!given.ok) {
    return { ok: false, reason: "invalid", message: given.error };
  }
  try {
    if (await pageExists(page)) {
      return {
        ok: false,
        reason: "exists",
        message: exists(page),
      };
    }
    const seed = database.template
      ? await expandedTemplate(database.template, {
          title: title.trim(),
          page,
          database: database.name,
        })
      : { body: "\n", inherited: {} };
    const text: string = await system.invokeFunction(
      "index.patchFrontmatter",
      seed.body,
      [
        ...rowPatches(database, isoDate(new Date()), seed.inherited),
        ...given.patches,
      ],
    );
    const meta = await space.writePage(page, text);
    return { ok: true, page, modified: String(meta.lastModified ?? "") };
  } catch (e) {
    return {
      ok: false,
      reason: "failed",
      message: e instanceof Error ? e.message : String(e),
    };
  }
}

/** Whether the page is there: its meta can be read. */
async function pageExists(page: string): Promise<boolean> {
  try {
    await space.getPageMeta(page);
    return true;
  } catch (e) {
    // Only "not found" means absent: anything else could be a page that is
    // there, and the write after it would overwrite.
    if (/not found/i.test(e instanceof Error ? e.message : String(e))) {
      return false;
    }
    throw e;
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
  "The page changed since it was shown. Reload the view and try again.";

/** The page's last change right now, as the index would record it. */
async function currentModified(page: string): Promise<string> {
  return String((await space.getPageMeta(page)).lastModified ?? "");
}

/** Sets or clears one frontmatter attribute. Refuses if the page has changed
 * since the row was read, or the value breaks what `database` declares. */
export async function updatePageValue(
  page: string,
  key: string,
  kind: CellKind,
  input: string | boolean,
  modified: string,
  database?: string,
): Promise<WriteResult> {
  // A declared property is held to its type and options, whatever `kind` the
  // caller sent.
  const declared = (await databaseOf(database))?.properties.find(
    (p) => p.key === key,
  );
  const parsed = declared
    ? parsePropertyInput(declared, input)
    : parseCellInput(kind, input);
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
          result.reason === "stale" ? STALE : "That line is no longer a task.",
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

export type RowResult =
  | {
      ok: true;
      /** The page that now holds the row (the same, or the new name). */
      page: string;
      /** Its modification time; null when the page is gone. */
      modified: string | null;
    }
  | {
      ok: false;
      reason: "stale" | "exists" | "invalid" | "failed";
      message: string;
    };

/** Whether `page` is a row of the spec's database or tag: the iframe names the
 * page, so what is written to is checked here, not trusted. */
async function isRowOf(spec: Spec, page: string): Promise<boolean> {
  if (spec.source.kind === "tasks") return false;
  const tag = spec.source.kind === "projects" ? "project" : spec.source.tag;
  const folder = spec.database?.folder;
  if (folder && !page.startsWith(folder)) return false;
  return (await pagesTagged(tag)).some((p) => p.name === page);
}

const NOT_A_ROW = "That row is no longer in this view.";

/** Runs `action` on a page row once it is checked to belong to the view and
 * not to have changed since it was read. */
async function onRow(
  spec: Spec,
  page: string,
  modified: string,
  action: () => Promise<RowResult>,
): Promise<RowResult> {
  try {
    if (!(await isRowOf(spec, page))) {
      return { ok: false, reason: "invalid", message: NOT_A_ROW };
    }
    if (isStale(modified, await currentModified(page))) {
      return { ok: false, reason: "stale", message: STALE };
    }
    return await action();
  } catch (e) {
    return {
      ok: false,
      reason: "failed",
      message: e instanceof Error ? e.message : String(e),
    };
  }
}

/** Renames `page` to `target` the way the row menu's rename does (links to
 * it are updated); false when that did not happen. */
async function renamePage(page: string, target: string): Promise<boolean> {
  return await system.invokeFunction("index.renamePageCommand", {
    oldPage: page,
    page: target,
  });
}

/** The first free name for `page` in the trash: `Trash/<page>`, then ` 2`... */
export async function trashName(
  page: string,
  taken: (name: string) => Promise<boolean>,
): Promise<string> {
  for (let n = 1; ; n++) {
    const name = n === 1 ? `${TRASH}${page}` : `${TRASH}${page} ${n}`;
    if (!(await taken(name))) return name;
  }
}

/** "Deletes" a row: moves its page to `Trash/<name>`, recording where it came
 * from (`trashedFrom`) and when (`trashedAt`) in its frontmatter. Nothing is
 * lost: **Trash: Restore** brings it back. The panel has asked
 * the reader to confirm. */
export function deleteRow(
  spec: Spec,
  page: string,
  modified: string,
): Promise<RowResult> {
  return onRow(spec, page, modified, async () => {
    const target = await trashName(page, pageExists);
    const original = await space.readPage(page);
    const marked: string = await system.invokeFunction(
      "index.patchFrontmatter",
      original,
      [
        { op: "set-key", path: "trashedFrom", value: page },
        { op: "set-key", path: "trashedAt", value: isoDate(new Date()) },
      ],
    );
    const markedMeta = await space.writePage(page, marked);
    let done = false;
    try {
      done = await renamePage(page, target);
    } catch {
      done = false;
    }
    if (!done) {
      // Not moved: put the page back as it was, so no mark is left behind.
      // Only when the move left nothing at the target and the page is still
      // the one just marked (no newer edit, no half-finished rename).
      try {
        if (
          !(await pageExists(target)) &&
          (await pageExists(page)) &&
          (await currentModified(page)) ===
            String(markedMeta.lastModified ?? "")
        ) {
          await space.writePage(page, original);
        }
      } catch {
        // Leave it: the page is intact, only marked.
      }
      return {
        ok: false,
        reason: "failed",
        message: "Could not move it to trash.",
      };
    }
    return { ok: true, page, modified: null };
  });
}

/** Moves a trashed page back to the name in its `trashedFrom`, and drops the
 * two marks. Refused when that name is taken or the page was not trashed. */
export async function restoreTrashed(page: string): Promise<RowResult> {
  try {
    if (!page.startsWith(TRASH)) {
      return {
        ok: false,
        reason: "invalid",
        message: "That page is not in Trash.",
      };
    }
    const text = await space.readPage(page);
    const extracted: { frontmatter?: Record<string, unknown> } =
      await system.invokeFunction("index.extractFrontmatter", text, {});
    const from = extracted.frontmatter?.trashedFrom;
    if (typeof from !== "string" || from === "") {
      return {
        ok: false,
        reason: "invalid",
        message: "The original name is not known.",
      };
    }
    if (from.startsWith(TRASH)) {
      return {
        ok: false,
        reason: "invalid",
        message: "The original name is not known.",
      };
    }
    if (await pageExists(from)) {
      return {
        ok: false,
        reason: "exists",
        message: exists(from),
      };
    }
    if (!(await renamePage(page, from))) {
      return { ok: false, reason: "failed", message: "Could not restore it." };
    }
    // The page is back: failing to drop the marks must not report failure.
    try {
      const moved = await space.readPage(from);
      const clean: string = await system.invokeFunction(
        "index.patchFrontmatter",
        moved,
        [
          { op: "delete-key", path: "trashedFrom" },
          { op: "delete-key", path: "trashedAt" },
        ],
      );
      const modified =
        clean === moved
          ? await currentModified(from)
          : String((await space.writePage(from, clean)).lastModified ?? "");
      return { ok: true, page: from, modified };
    } catch {
      return { ok: true, page: from, modified: null };
    }
  } catch (e) {
    return {
      ok: false,
      reason: "failed",
      message: e instanceof Error ? e.message : String(e),
    };
  }
}

/** Archives a row (`archived: true` in its frontmatter, which hides it from
 * views) or brings it back (the key is removed). */
export function archiveRow(
  spec: Spec,
  page: string,
  archived: boolean,
  modified: string,
): Promise<RowResult> {
  return onRow(spec, page, modified, async () => {
    const text = await space.readPage(page);
    const next: string = await system.invokeFunction(
      "index.patchFrontmatter",
      text,
      [
        archived
          ? { op: "set-key", path: "archived", value: true }
          : { op: "delete-key", path: "archived" },
      ],
    );
    if (next === text) return { ok: true, page, modified };
    const meta = await space.writePage(page, next);
    return { ok: true, page, modified: String(meta.lastModified ?? "") };
  });
}

/** Copies a row to `<page> copy` (or the first free number after it). */
export function duplicateRow(
  spec: Spec,
  page: string,
  modified: string,
): Promise<RowResult> {
  return onRow(spec, page, modified, async () => {
    const source = await space.readPage(page);
    // A copy of an archived row would vanish from the view: it starts live.
    const text: string = await system.invokeFunction(
      "index.patchFrontmatter",
      source,
      [{ op: "delete-key", path: "archived" }],
    );
    const target = await copyName(page, pageExists);
    const meta = await space.writePage(target, text);
    return {
      ok: true,
      page: target,
      modified: String(meta.lastModified ?? ""),
    };
  });
}

/** Renames a row's page within its folder, updating the links to it. */
export function renameRow(
  spec: Spec,
  page: string,
  title: string,
  modified: string,
): Promise<RowResult> {
  const target = renamedPage(page, title);
  if (!target) {
    return Promise.resolve({
      ok: false,
      reason: "invalid",
      message: "Enter a name.",
    });
  }
  if (target === page) {
    return Promise.resolve({ ok: true, page, modified });
  }
  return onRow(spec, page, modified, async () => {
    if (await pageExists(target)) {
      return {
        ok: false,
        reason: "exists",
        message: exists(target),
      };
    }
    const done = await renamePage(page, target);
    if (!done) {
      return {
        ok: false,
        reason: "failed",
        message: "Could not rename it.",
      };
    }
    return { ok: true, page: target, modified: await currentModified(target) };
  });
}

export type SaveViewResult =
  | { ok: true; body: string }
  | { ok: false; reason: "stale" | "invalid" | "failed"; message: string };

/**
 * Writes the reader's view (tab, sort, filter phrase) into the ```db block
 * that drew it. Explicit: only called by the "Save view" button. If the block
 * was edited since it was drawn, or cannot be told from another, nothing is
 * written.
 */
export async function saveView(
  page: string,
  body: string,
  saved: SavedView,
): Promise<SaveViewResult> {
  if (!["table", "board", "calendar"].includes(saved.view)) {
    return { ok: false, reason: "invalid", message: "That view is not valid." };
  }
  if (
    typeof saved.filter !== "string" ||
    saved.filter.length > 500 ||
    (saved.sort !== undefined &&
      (typeof saved.sort.key !== "string" ||
        saved.sort.key === "" ||
        typeof saved.sort.desc !== "boolean"))
  ) {
    return {
      ok: false,
      reason: "invalid",
      message: "That view cannot be saved.",
    };
  }
  try {
    const text = await space.readPage(page);
    const next = patchBlockBody(body, saved);
    const result = replaceBlock(text, body, next);
    if (!result.ok) {
      return {
        ok: false,
        reason: result.reason === "missing" ? "stale" : "invalid",
        message:
          result.reason === "missing"
            ? "The block changed since it was shown. Reopen the page and save again."
            : "Several db blocks are identical, so the one to save to is unclear.",
      };
    }
    if (result.text !== text) await space.writePage(page, result.text);
    return { ok: true, body: next };
  } catch (e) {
    return {
      ok: false,
      reason: "failed",
      message: e instanceof Error ? e.message : String(e),
    };
  }
}
