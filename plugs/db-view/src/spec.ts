import {
  DEFAULT_LIMIT,
  type SourceSpec,
  type Spec,
  type ViewKind,
} from "./model.ts";

export type SpecResult =
  | { ok: true; spec: Spec }
  | { ok: false; error: string };

const VIEWS: ViewKind[] = ["table", "board", "calendar"];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseSource(raw: Record<string, unknown>): SourceSpec | string {
  const tag = raw.tag;
  const source = raw.source;
  if (source === undefined && tag === undefined) {
    return "source が必要です(projects / tasks / tag:<名前>)";
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

/** Validates what the YAML of a ```db block said, and fills in the defaults. */
export function parseSpec(raw: unknown): SpecResult {
  if (!isRecord(raw)) {
    return { ok: false, error: "```db の中身は YAML の設定にしてください" };
  }
  const source = parseSource(raw);
  if (typeof source === "string") return { ok: false, error: source };

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
      view: view as ViewKind,
      title: typeof raw.title === "string" ? raw.title : undefined,
      group,
      date,
      columns,
      sort,
      order,
      where,
      limit,
      weekStart,
    },
  };
}
