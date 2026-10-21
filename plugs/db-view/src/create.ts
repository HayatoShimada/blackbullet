/** The pure part of "+ New": where a row goes, and what it starts with. */
import type { YamlPatch } from "../../../plug-api/lib/yaml.ts";
import { parseCellInput, parsePropertyInput } from "./edit.ts";
import type { DatabaseSpec, Spec } from "./model.ts";

const MAX_TITLE = 100;

/**
 * The page a new row is written to: the database's folder, then the title
 * with what a page name cannot carry taken out: `/` (it would make a folder),
 * control characters, and `# @ | < > $ [ ]` (ref syntax); leading dots (a
 * hidden file) and a trailing `.<letters or digits>` (it would read as a
 * file extension, so the name would open as a document) are removed too.
 * Null when nothing usable is left.
 */
export function rowPageName(folder: string, title: string): string | null {
  let name = title
    // biome-ignore lint/suspicious/noControlCharactersInRegex: that is the point
    .replace(/[\u0000-\u001f\u007f/#@|<>$[\]]/g, "")
    .trim()
    .slice(0, MAX_TITLE);
  for (;;) {
    const next = name
      .replace(/^\.+/, "")
      .replace(/\.[A-Za-z0-9]*$/, "")
      .trim();
    if (next === name) break;
    name = next;
  }
  if (name === "") return null;
  return `${folder}${name}`;
}

/**
 * The frontmatter a new row starts with: what its template's own frontmatter
 * carries (`inherited`), then its tag and every default (these win). A date
 * property's default may be `today`.
 */
export function rowPatches(
  database: DatabaseSpec,
  today = "",
  inherited: Record<string, unknown> = {},
): YamlPatch[] {
  const patches: YamlPatch[] = Object.entries(inherited).map(([k, v]) => ({
    op: "set-key",
    path: k,
    value: v,
  }));
  patches.push({ op: "set-key", path: "tags", value: [database.tag] });
  for (const p of database.properties) {
    if (p.default === undefined) continue;
    const value =
      p.type === "date" && p.default === "today" && today ? today : p.default;
    patches.push({ op: "set-key", path: p.key, value });
  }
  return patches;
}

export type NewValues = Record<string, string | boolean>;

/**
 * The patches that set the values a row is created with (a board column's
 * value, a calendar day): a declared property is checked by its type and
 * options; any other key is taken as text, or as a date when it is the view's
 * date attribute. An empty value sets nothing.
 */
export function valuePatches(
  database: DatabaseSpec,
  values: NewValues | undefined,
  dateKey: string,
): { ok: true; patches: YamlPatch[] } | { ok: false; error: string } {
  const patches: YamlPatch[] = [];
  for (const [key, input] of Object.entries(values ?? {})) {
    if (key === "" || key === "tags" || key === "__proto__") {
      return { ok: false, error: `${key} cannot be set` };
    }
    const declared = database.properties.find((p) => p.key === key);
    const parsed = declared
      ? parsePropertyInput(declared, input)
      : parseCellInput(key === dateKey ? "date" : "text", input);
    if (!parsed.ok) return parsed;
    if (parsed.value !== null) {
      patches.push({ op: "set-key", path: key, value: parsed.value });
    }
  }
  return { ok: true, patches };
}

/** Keys a `where` can test that are not the row's own frontmatter. */
const DERIVED_KEYS = new Set([
  "tags",
  "title",
  "name",
  "page",
  "created",
  "modified",
  "lastModified",
  "openTasks",
  "doneTasks",
  "archived",
  "__proto__",
]);

/**
 * The patches that keep a new row in the view it was made from: every `where`
 * key that asks for one plain value (`status: inbox`, or a list holding one
 * such value among its operators) is set to it; failing that, one `contains`
 * names the value. Other operators (`not`, `empty`, ranges) name no value, so
 * they set nothing.
 */
export function wherePatches(where: Spec["where"]): YamlPatch[] {
  const patches: YamlPatch[] = [];
  for (const [key, wanted] of Object.entries(where)) {
    if (DERIVED_KEYS.has(key)) continue;
    const conds = Array.isArray(wanted) ? wanted : [wanted];
    const plain = conds.filter((c) => typeof c !== "object");
    const contained = conds.flatMap((c) =>
      typeof c === "object" && c.contains !== undefined ? [c.contains] : [],
    );
    const value =
      plain.length > 0
        ? plain.length === 1
          ? plain[0]
          : undefined
        : contained.length === 1
          ? contained[0]
          : undefined;
    if (value !== undefined) {
      patches.push({ op: "set-key", path: key, value });
    }
  }
  return patches;
}

/** Template frontmatter that describes the template, not the pages it makes. */
const TEMPLATE_META = new Set([
  "tags",
  "command",
  "key",
  "mac",
  "priority",
  "suggestedName",
  "confirmName",
  "openIfExists",
  "description",
  "frontmatter",
  "displayName",
  // Where the frontmatter sits in the template, added by the extraction.
  "range",
]);

/** The attributes of a template's frontmatter a new row inherits. */
export function inheritedFrontmatter(
  frontmatter: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(frontmatter ?? {})) {
    if (!TEMPLATE_META.has(k) && v !== undefined) out[k] = v;
  }
  return out;
}

/** A Lua long string holding `text` verbatim, whatever brackets it has. */
export function luaLongString(text: string): string {
  let eq = "";
  // The closing bracket must not appear earlier, nor be formed by a final `]`.
  while (`${text}]${eq}]`.indexOf(`]${eq}]`) !== text.length) eq += "=";
  return `[${eq}[\n${text}]${eq}]`;
}

/**
 * The Lua expression that expands a template text with a title/page context.
 * `name` is the same as `title`: page templates elsewhere say `${name}`.
 */
export function expandExpression(
  text: string,
  ctx: { title: string; page: string; database: string },
): string {
  return `database.expandTemplate(${luaLongString(text)}, {title = ${luaLongString(ctx.title)}, name = ${luaLongString(ctx.title)}, page = ${luaLongString(ctx.page)}, database = ${luaLongString(ctx.database)}})`;
}

/** The folder a page name sits in, with its trailing `/`, or "". */
export function folderOf(page: string): string {
  const i = page.lastIndexOf("/");
  return i === -1 ? "" : page.slice(0, i + 1);
}

/** The name a renamed row gets: the same folder, the new title. */
export function renamedPage(page: string, title: string): string | null {
  return rowPageName(folderOf(page), title);
}

/**
 * The first free name for a copy of `page`: `<page> copy`, then `<page> copy 2`
 * and on. `taken` says whether a name is in use.
 */
export async function copyName(
  page: string,
  taken: (name: string) => Promise<boolean>,
): Promise<string> {
  for (let n = 1; ; n++) {
    const name = n === 1 ? `${page} copy` : `${page} copy ${n}`;
    if (!(await taken(name))) return name;
  }
}
