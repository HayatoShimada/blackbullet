import type { DbRow } from "./model.ts";

type Obj = Record<string, any>;

/** What the index keeps about a page that is not the page's own attributes. */
const INTERNAL = new Set([
  "ref",
  "tag",
  "tags",
  "itags",
  "name",
  "displayName",
  "linkName",
  "aliases",
  "created",
  "lastModified",
  "perm",
  "size",
  "contentType",
  "lastOpened",
  "pageDecoration",
]);

function lastSegment(name: string): string {
  const i = name.lastIndexOf("/");
  return i === -1 ? name : name.slice(i + 1);
}

/** A page's attributes: the frontmatter, without the index's own fields. */
function attributes(obj: Obj): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (INTERNAL.has(key) || key.startsWith("_")) continue;
    out[key] = value;
  }
  // The tags a page declares are an attribute worth seeing, though not editable.
  if (Array.isArray(obj.tags) && obj.tags.length > 0) out.tags = obj.tags;
  return out;
}

export function pageRow(
  obj: Obj,
  counts?: { open: number; done: number },
): DbRow {
  const name = String(obj.name);
  return {
    id: name,
    kind: "page",
    page: name,
    title: String(obj.displayName ?? lastSegment(name)),
    values: attributes(obj),
    modified: String(obj.lastModified ?? ""),
    ...(obj.created ? { created: String(obj.created) } : {}),
    ...(counts ? { openTasks: counts.open, doneTasks: counts.done } : {}),
  };
}

/** What a task has besides what the index records of every object. */
const TASK_INTERNAL = new Set([
  ...INTERNAL,
  "pos",
  "toPos",
  "range",
  "text",
  "page",
  "pageLastModified",
  "state",
  "parent",
  "links",
  "anchor",
  "$anchor",
]);

export function taskRow(obj: Obj): DbRow {
  const values: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (TASK_INTERNAL.has(key) || key.startsWith("_")) continue;
    values[key] = value;
  }
  const tags = Array.isArray(obj.tags)
    ? obj.tags.filter((t: unknown) => t !== "task")
    : [];
  values.tags = tags;
  values.done = obj.done === true;
  return {
    id: String(obj.ref),
    kind: "task",
    page: String(obj.page),
    title: String(obj.name ?? obj.text ?? ""),
    values,
    modified: String(obj.pageLastModified ?? ""),
    range: Array.isArray(obj.range) ? [obj.range[0], obj.range[1]] : undefined,
    state: typeof obj.state === "string" ? obj.state : " ",
  };
}

/** Open and done tasks per page. */
export function countTasks(
  tasks: readonly Obj[],
): Map<string, { open: number; done: number }> {
  const counts = new Map<string, { open: number; done: number }>();
  for (const t of tasks) {
    const page = String(t.page);
    const c = counts.get(page) ?? { open: 0, done: 0 };
    if (t.done) c.done++;
    else c.open++;
    counts.set(page, c);
  }
  return counts;
}
