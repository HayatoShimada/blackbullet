import {
  type DatabaseProperty,
  type DatabaseSpec,
  DEFAULT_LIMIT,
  type PropertyType,
  type SourceSpec,
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
    return "source が必要です(projects / tasks / tag:<名前>、または database: <名前>)";
  }
  if (source === undefined || source === "tag") {
    if (typeof tag !== "string" || tag.trim() === "") {
      return "tag の名前が必要です(例: tag: meeting)";
    }
    return { kind: "tag", tag: tag.trim() };
  }
  if (source === "projects") return { kind: "projects" };
  if (source === "tasks") return { kind: "tasks" };
  if (typeof source === "string" && source.startsWith("tag:")) {
    const name = source.slice(4).trim();
    return name
      ? { kind: "tag", tag: name }
      : "tag の名前が必要です(例: source: tag:meeting)";
  }
  return `source "${String(source)}" は使えません(projects / tasks / tag:<名前>)`;
}

function strings(raw: unknown, what: string): string[] | string | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw) || raw.some((x) => typeof x !== "string")) {
    return `${what} は文字列の一覧にしてください`;
  }
  return raw as string[];
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
    return { ok: false, error: "```db の中身は YAML の設定にしてください" };
  }
  if (raw.database !== undefined) {
    const name = databaseName(raw);
    if (!name) {
      return { ok: false, error: "database は名前にしてください" };
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
      error: `view "${String(view)}" は使えません(table / board / calendar)`,
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
      return { ok: false, error: "limit は 1 以上の整数にしてください" };
    }
    limit = raw.limit;
  }

  let weekStart: 0 | 1 = 0;
  if (raw.weekStart !== undefined) {
    if (raw.weekStart !== 0 && raw.weekStart !== 1) {
      return {
        ok: false,
        error: "weekStart は 0(日曜)か 1(月曜)にしてください",
      };
    }
    weekStart = raw.weekStart;
  }

  const where: Spec["where"] = {};
  if (raw.where !== undefined) {
    if (!isRecord(raw.where)) {
      return { ok: false, error: "where は「属性: 値」の形にしてください" };
    }
    for (const [key, value] of Object.entries(raw.where)) {
      if (
        typeof value !== "string" &&
        typeof value !== "number" &&
        typeof value !== "boolean"
      ) {
        return {
          ok: false,
          error: `where の ${key} は文字列・数・真偽値にしてください`,
        };
      }
      where[key] = value;
    }
  }

  let sort: Spec["sort"];
  if (raw.sort !== undefined) {
    if (typeof raw.sort !== "string" || raw.sort.trim() === "") {
      return {
        ok: false,
        error: "sort は属性名にしてください(降順は -due のように)",
      };
    }
    const text = raw.sort.trim();
    sort = text.startsWith("-")
      ? { key: text.slice(1), desc: true }
      : { key: text, desc: false };
  }

  const group = raw.group ?? "status";
  const date = raw.date ?? "due";
  if (typeof group !== "string" || typeof date !== "string") {
    return { ok: false, error: "group と date は属性名にしてください" };
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
      sort,
      order: order ?? database?.order,
      where,
      limit,
      weekStart,
    },
  };
}
