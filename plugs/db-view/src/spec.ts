import {
  type DatabaseProperty,
  type DatabaseSpec,
  DEFAULT_LIMIT,
  OPERATOR_KEYS,
  type Operators,
  type Scalar,
  type PropertyType,
  type SourceSpec,
  type WhereValue,
  type Spec,
  type ViewKind,
} from "./model.ts";

export type SpecResult =
  | { ok: true; spec: Spec }
  | { ok: false; error: string };

const VIEWS: ViewKind[] = ["table", "board", "calendar"];
const PROPERTY_TYPES: PropertyType[] = [
  "text",
  "select",
  "date",
  "number",
  "boolean",
  "page",
];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const stringList = (v: unknown): string[] | undefined =>
  Array.isArray(v) && v.every((x) => typeof x === "string")
    ? (v as string[])
    : undefined;

/**
 * A database as the config holds it (what `database.define` stored), or
 * undefined when it is not one. Space Lua already validated it; this only
 * keeps the plug safe from a hand-edited config.
 */
export function databaseFrom(raw: unknown): DatabaseSpec | undefined {
  if (!isRecord(raw) || typeof raw.name !== "string" || !raw.name) {
    return undefined;
  }
  const properties: DatabaseProperty[] = [];
  // Lua gives an empty list as an empty object: that is no properties.
  const list = Array.isArray(raw.properties) ? raw.properties : [];
  for (const p of list) {
    if (
      !isRecord(p) ||
      typeof p.key !== "string" ||
      !p.key ||
      !PROPERTY_TYPES.includes(p.type as PropertyType)
    ) {
      continue;
    }
    const property: DatabaseProperty = {
      key: p.key,
      type: p.type as PropertyType,
    };
    if (typeof p.label === "string") property.label = p.label;
    const options = stringList(p.options);
    if (options) property.options = options;
    if (
      typeof p.default === "string" ||
      typeof p.default === "number" ||
      typeof p.default === "boolean"
    ) {
      property.default = p.default;
    }
    properties.push(property);
  }
  const folder = typeof raw.folder === "string" ? raw.folder : `${raw.name}/`;
  return {
    name: raw.name,
    tag: typeof raw.tag === "string" && raw.tag ? raw.tag : raw.name,
    folder: folder && !folder.endsWith("/") ? `${folder}/` : folder,
    ...(typeof raw.template === "string" && raw.template
      ? { template: raw.template }
      : {}),
    ...(typeof raw.title === "string" ? { title: raw.title } : {}),
    properties,
    ...(stringList(raw.order) ? { order: stringList(raw.order) } : {}),
  };
}

function parseSource(
  raw: Record<string, unknown>,
  database?: DatabaseSpec,
): SourceSpec | string {
  const tag = raw.tag;
  const source = raw.source;
  if (database && source === undefined && tag === undefined) {
    return { kind: "tag", tag: database.tag };
  }
  if (source === undefined && tag === undefined) {
    return "A db block needs a source: projects, tasks, tag:<name>, or database: <name>";
  }
  if (source === undefined || source === "tag") {
    if (typeof tag !== "string" || tag.trim() === "") {
      return "A tag name is needed, for example tag: meeting";
    }
    return { kind: "tag", tag: tag.trim() };
  }
  if (source === "projects") return { kind: "projects" };
  if (source === "tasks") return { kind: "tasks" };
  if (typeof source === "string" && source.startsWith("tag:")) {
    const name = source.slice(4).trim();
    return name
      ? { kind: "tag", tag: name }
      : "A tag name is needed, for example source: tag:meeting";
  }
  return `source "${String(source)}" is not supported. Use projects, tasks or tag:<name>`;
}

function strings(raw: unknown, what: string): string[] | string | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw) || raw.some((x) => typeof x !== "string")) {
    return `${what} must be a list of strings`;
  }
  return raw as string[];
}

const isScalar = (v: unknown): v is Scalar =>
  typeof v === "string" || typeof v === "number" || typeof v === "boolean";

const WHERE_HELP =
  "Use a string, number or boolean, or a condition with {not, lt, lte, gt, gte, before, after, contains, empty} (or a list of them)";

function operators(input: Record<string, unknown>): Operators | string {
  // YAML turns an unquoted `2026-10-05` into a Date: take it as its ISO day.
  const v: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(input)) {
    v[k] =
      x instanceof Date && !Number.isNaN(x.getTime())
        ? x.toISOString().slice(0, 10)
        : x;
  }
  const keys = Object.keys(v);
  if ("lt" in v && "before" in v)
    return "lt and before cannot be used together";
  if ("gt" in v && "after" in v) return "gt and after cannot be used together";
  if (keys.length === 0) return WHERE_HELP;
  for (const k of keys) {
    if (!(OPERATOR_KEYS as readonly string[]).includes(k)) {
      return `Condition "${k}" is not supported. Use ${OPERATOR_KEYS.join(", ")}`;
    }
    if (k === "empty" ? typeof v[k] !== "boolean" : !isScalar(v[k])) {
      return k === "empty"
        ? "empty must be true or false"
        : `${k} must be a string, number or boolean`;
    }
  }
  return v as Operators;
}

/** One `where` value: a scalar, an operator object, or a non-empty list of
 * them. A string is the error. */
function whereValue(v: unknown): { value: WhereValue } | string {
  if (isScalar(v)) return { value: v };
  if (isRecord(v)) {
    const ops = operators(v);
    return typeof ops === "string" ? ops : { value: ops };
  }
  if (Array.isArray(v) && v.length > 0) {
    const list: (Scalar | Operators)[] = [];
    for (const item of v) {
      if (isScalar(item)) list.push(item);
      else if (isRecord(item)) {
        const ops = operators(item);
        if (typeof ops === "string") return ops;
        list.push(ops);
      } else return WHERE_HELP;
    }
    return { value: list };
  }
  return WHERE_HELP;
}

/** The `database:` a block names, or undefined when it names none. */
export function databaseName(raw: unknown): string | undefined {
  if (!isRecord(raw) || typeof raw.database !== "string") return undefined;
  const name = raw.database.trim();
  return name === "" ? undefined : name;
}

/**
 * Validates what the YAML of a ```db block said, and fills in the defaults.
 * `database` is what the config holds for the block's `database:` (the caller
 * looks it up; `parseSpec` is pure): with it, the source, title and board
 * order come from the database unless the block says otherwise.
 */
export function parseSpec(raw: unknown, database?: DatabaseSpec): SpecResult {
  if (!isRecord(raw)) {
    return {
      ok: false,
      error: "The body of a ```db block must be YAML settings",
    };
  }
  if (raw.database !== undefined) {
    const name = databaseName(raw);
    if (!name) {
      return { ok: false, error: "database must be a name" };
    }
    if (!database) {
      return {
        ok: false,
        error: `database ${name} is not defined; add database.define to CONFIG`,
      };
    }
  } else {
    database = undefined;
  }
  const source = parseSource(raw, database);
  if (typeof source === "string") return { ok: false, error: source };
  // A block that looks at some other source than the database's tag shows
  // pages the database does not own: it is not that database's view, so no
  // + New.
  const owns = database
    ? source.kind === "tag" && source.tag === database.tag
    : false;

  const view = raw.view ?? "table";
  if (typeof view !== "string" || !VIEWS.includes(view as ViewKind)) {
    return {
      ok: false,
      error: `view "${String(view)}" is not supported. Use table, board or calendar`,
    };
  }

  const columns = strings(raw.columns, "columns");
  if (typeof columns === "string") return { ok: false, error: columns };
  const order = strings(raw.order, "order");
  if (typeof order === "string") return { ok: false, error: order };

  let limit = DEFAULT_LIMIT;
  if (raw.limit !== undefined) {
    if (
      typeof raw.limit !== "number" ||
      !Number.isInteger(raw.limit) ||
      raw.limit < 1
    ) {
      return { ok: false, error: "limit must be a whole number, 1 or more" };
    }
    limit = raw.limit;
  }

  let weekStart: 0 | 1 = 0;
  if (raw.weekStart !== undefined) {
    if (raw.weekStart !== 0 && raw.weekStart !== 1) {
      return {
        ok: false,
        error: "weekStart must be 0 (Sunday) or 1 (Monday)",
      };
    }
    weekStart = raw.weekStart;
  }

  const where: Spec["where"] = {};
  if (raw.where !== undefined) {
    if (!isRecord(raw.where)) {
      return { ok: false, error: "where must be a list of property: value" };
    }
    for (const [key, value] of Object.entries(raw.where)) {
      const parsed = whereValue(value);
      if (typeof parsed === "string") {
        return { ok: false, error: `where ${key}: ${parsed}` };
      }
      where[key] = parsed.value;
    }
  }

  let sort: Spec["sort"];
  if (raw.sort !== undefined) {
    if (typeof raw.sort !== "string" || raw.sort.trim() === "") {
      return {
        ok: false,
        error: "sort must be a property name (descending: -due)",
      };
    }
    const text = raw.sort.trim();
    sort = text.startsWith("-")
      ? { key: text.slice(1), desc: true }
      : { key: text, desc: false };
  }

  if (raw.filter !== undefined && typeof raw.filter !== "string") {
    return { ok: false, error: "filter must be text" };
  }

  if (raw.archived !== undefined && typeof raw.archived !== "boolean") {
    return { ok: false, error: "archived must be true or false" };
  }

  const group = raw.group ?? "status";
  const date = raw.date ?? "due";
  if (typeof group !== "string" || typeof date !== "string") {
    return { ok: false, error: "group and date must be property names" };
  }

  return {
    ok: true,
    spec: {
      source,
      ...(database && owns ? { database } : {}),
      view: view as ViewKind,
      title:
        typeof raw.title === "string"
          ? raw.title
          : database
            ? (database.title ?? database.name)
            : undefined,
      group,
      date,
      columns,
      // A database lists by title unless told otherwise: a stable order, so
      // an edited row does not jump to the top.
      sort:
        sort ?? (database && owns ? { key: "title", desc: false } : undefined),
      ...(typeof raw.filter === "string" && raw.filter.trim() !== ""
        ? { filter: raw.filter }
        : {}),
      ...(raw.archived === true ? { showArchived: true } : {}),
      order: order ?? database?.order,
      where,
      limit,
      weekStart,
    },
  };
}
