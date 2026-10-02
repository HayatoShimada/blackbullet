import {
  type CellKind,
  type Column,
  type DatabaseProperty,
  type DatabaseSpec,
  DEFAULT_STATUS_ORDER,
  type DbRow,
  type Spec,
} from "./model.ts";

const pad = (n: number) => String(n).padStart(2, "0");

/** `2026-10-02`, in the reader's own time zone. */
export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** An ISO date from what a frontmatter value might be, or undefined. */
export function normalizeDate(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(value.trim());
  if (!m) return undefined;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(y, mo - 1, d);
  const real =
    date.getFullYear() === y &&
    date.getMonth() === mo - 1 &&
    date.getDate() === d;
  return real ? `${m[1]}-${m[2]}-${m[3]}` : undefined;
}

export type DueState = "none" | "overdue" | "today" | "soon" | "later";

const dayNumber = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
};

/** How pressing a due date is: three days or fewer counts as soon. */
export function dueState(due: unknown, today: string): DueState {
  const iso = normalizeDate(due);
  if (!iso) return "none";
  const days = dayNumber(iso) - dayNumber(today);
  if (days < 0) return "overdue";
  if (days === 0) return "today";
  return days <= 3 ? "soon" : "later";
}

/** The value of an attribute, from a row (`title` and the counts included). */
export function valueOf(row: DbRow, key: string): unknown {
  if (key === "title" || key === "name") return row.title;
  if (key === "page") return row.page;
  if (key === "openTasks") return row.openTasks;
  if (key === "doneTasks") return row.doneTasks;
  return row.values[key];
}

function compareValues(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean")
    return Number(a) - Number(b);
  return String(a).localeCompare(String(b), undefined, { numeric: true });
}

const isEmpty = (v: unknown) =>
  v === undefined ||
  v === null ||
  v === "" ||
  (Array.isArray(v) && v.length === 0);

/** Sorted by an attribute; rows without it go last whichever way it runs. */
export function sortRows(rows: readonly DbRow[], sort: Spec["sort"]): DbRow[] {
  if (!sort) return [...rows];
  return [...rows]
    .map((row, index) => ({ row, index, value: valueOf(row, sort.key) }))
    .sort((a, b) => {
      const ae = isEmpty(a.value);
      const be = isEmpty(b.value);
      if (ae || be) return ae === be ? a.index - b.index : ae ? 1 : -1;
      const c = compareValues(a.value, b.value);
      return (sort.desc ? -c : c) || a.index - b.index;
    })
    .map((x) => x.row);
}

function text(row: DbRow): string {
  const parts = [row.title, row.page];
  for (const v of Object.values(row.values)) {
    parts.push(Array.isArray(v) ? v.join(" ") : String(v ?? ""));
  }
  return parts.join(" ").toLowerCase();
}

/** Rows containing every word of `phrase`, anywhere in their text. */
export function filterRows(rows: readonly DbRow[], phrase: string): DbRow[] {
  const words = phrase.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...rows];
  return rows.filter((row) => {
    const haystack = text(row);
    return words.every((w) => haystack.includes(w));
  });
}

/** Rows whose attributes equal what `where` asked for. */
export function matchesWhere(row: DbRow, where: Spec["where"]): boolean {
  return Object.entries(where).every(([key, wanted]) => {
    const actual = valueOf(row, key);
    if (Array.isArray(actual))
      return actual.map(String).includes(String(wanted));
    return String(actual) === String(wanted);
  });
}

export const NONE_KEY = "";

export type Group = { key: string; label: string; rows: DbRow[] };

/**
 * Columns for a board: the order the spec gives (shown even when empty), then
 * what else the data holds in the order it appears, then the rows with no
 * value. With no order given, `status` starts active, someday, done.
 */
export function groupRows(
  rows: readonly DbRow[],
  field: string,
  order?: readonly string[],
): Group[] {
  const keyOf = (row: DbRow) => {
    const v = valueOf(row, field);
    return isEmpty(v) ? NONE_KEY : String(Array.isArray(v) ? v[0] : v);
  };
  const preferred = order ?? (field === "status" ? DEFAULT_STATUS_ORDER : []);
  const keys: string[] = [...preferred];
  const seen = new Set(keys);
  for (const row of rows) {
    const key = keyOf(row);
    if (key !== NONE_KEY && !seen.has(key)) {
      seen.add(key);
      keys.push(key);
    }
  }
  const groups = keys.map((key) => ({ key, label: key, rows: [] as DbRow[] }));
  const byKey = new Map(groups.map((g) => [g.key, g]));
  const none: Group = { key: NONE_KEY, label: "(なし)", rows: [] };
  for (const row of rows) {
    const key = keyOf(row);
    (key === NONE_KEY ? none : byKey.get(key)!).rows.push(row);
  }
  // Without an explicit order, columns that were only made up for the default
  // (nobody has that status) are not shown.
  const shown =
    order || field !== "status"
      ? groups
      : groups.filter((g) => g.rows.length > 0 || preferred.includes(g.key));
  return none.rows.length > 0 ? [...shown, none] : shown;
}

export type Day = { iso: string; day: number; inMonth: boolean };

/** The weeks of a month (`month` is 1-12), padded with the neighbouring days. */
export function monthGrid(
  year: number,
  month: number,
  weekStart: 0 | 1,
): Day[][] {
  const first = new Date(year, month - 1, 1);
  const lead = (first.getDay() - weekStart + 7) % 7;
  const start = new Date(year, month - 1, 1 - lead);
  const daysInMonth = new Date(year, month, 0).getDate();
  const weeks = Math.ceil((lead + daysInMonth) / 7);
  const out: Day[][] = [];
  for (let w = 0; w < weeks; w++) {
    const week: Day[] = [];
    for (let d = 0; d < 7; d++) {
      const date = new Date(
        start.getFullYear(),
        start.getMonth(),
        start.getDate() + w * 7 + d,
      );
      week.push({
        iso: isoDate(date),
        day: date.getDate(),
        inMonth: date.getMonth() === month - 1,
      });
    }
    out.push(week);
  }
  return out;
}

export function shiftMonth(
  year: number,
  month: number,
  delta: number,
): { year: number; month: number } {
  const index = year * 12 + (month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

/** The rows on each day by `field`, and the ones with no usable date. */
export function rowsByDate(
  rows: readonly DbRow[],
  field: string,
): { byDay: Map<string, DbRow[]>; undated: DbRow[] } {
  const byDay = new Map<string, DbRow[]>();
  const undated: DbRow[] = [];
  for (const row of rows) {
    const iso = normalizeDate(valueOf(row, field));
    if (!iso) {
      undated.push(row);
      continue;
    }
    const list = byDay.get(iso);
    if (list) list.push(row);
    else byDay.set(iso, [row]);
  }
  return { byDay, undated };
}

const DATE_KEY = /(^|[A-Z_-])(date|due|start|deadline|completed)s?$/i;

/** The property a database declares under `key`, if it declares one. */
export function declaredProperty(
  key: string,
  database?: DatabaseSpec,
): DatabaseProperty | undefined {
  return database?.properties.find((p) => p.key === key);
}

/**
 * What kind of editor a column wants: what the database declares, else a
 * guess from its name and what it holds. A page link is edited as text.
 */
export function cellKind(
  key: string,
  rows: readonly DbRow[],
  database?: DatabaseSpec,
): CellKind {
  const declared = declaredProperty(key, database);
  if (declared) return declared.type === "page" ? "text" : declared.type;
  if (key === "status") return "select";
  if (DATE_KEY.test(key)) return "date";
  const values = rows.map((r) => valueOf(r, key)).filter((v) => !isEmpty(v));
  if (values.length > 0 && values.every((v) => typeof v === "boolean"))
    return "boolean";
  if (values.length > 0 && values.every((v) => typeof v === "number"))
    return "number";
  return "text";
}

/** The kind of cell an attribute is, `done` being the task's checkbox. */
export function columnKind(
  key: string,
  rows: readonly DbRow[],
  database?: DatabaseSpec,
): CellKind {
  return key === "done" ? "boolean" : cellKind(key, rows, database);
}

const DEFAULT_COLUMNS: Record<string, string[]> = {
  projects: ["title", "status", "due", "area", "goal", "openTasks"],
  tasks: ["title", "done", "due", "tags", "page"],
};

const LABELS: Record<string, string> = {
  title: "名前",
  status: "状態",
  due: "期限",
  area: "エリア",
  goal: "目標",
  openTasks: "未完了",
  doneTasks: "完了",
  done: "完了",
  tags: "タグ",
  page: "ページ",
};

/** The columns of a table: the spec's, else the database's properties, else
 * the source's usual, else what the rows have in common. */
export function columnsFor(rows: readonly DbRow[], spec: Spec): Column[] {
  const database = spec.database;
  let keys = spec.columns;
  if (!keys && database) {
    keys = ["title", ...database.properties.map((p) => p.key)];
  }
  if (!keys) {
    keys = DEFAULT_COLUMNS[spec.source.kind];
  }
  if (!keys) {
    const seen = new Set<string>();
    for (const row of rows)
      for (const k of Object.keys(row.values)) seen.add(k);
    keys = ["title", ...seen];
  }
  return keys.map((key) => {
    const declared = declaredProperty(key, database);
    const kind = columnKind(key, rows, database);
    const readOnly =
      key === "title" ||
      key === "name" ||
      key === "page" ||
      key === "tags" ||
      key === "openTasks" ||
      key === "doneTasks";
    const options =
      kind === "select" ? selectOptions(key, rows, spec) : undefined;
    return {
      key,
      label: declared?.label ?? LABELS[key] ?? key,
      kind,
      editable: !readOnly,
      ...(options ? { options } : {}),
      ...(declared?.type === "page" ? { link: true } : {}),
    };
  });
}

/** The choices of a select: what the database declares; else what the spec
 * orders, the usual, and what is used. */
export function selectOptions(
  key: string,
  rows: readonly DbRow[],
  spec: Pick<Spec, "order" | "database">,
): string[] {
  const declared = declaredProperty(key, spec.database);
  if (declared?.type === "select" && declared.options) {
    return [...declared.options];
  }
  const out: string[] = [];
  const add = (v: string) => {
    if (v && !out.includes(v)) out.push(v);
  };
  for (const v of spec.order ?? (key === "status" ? DEFAULT_STATUS_ORDER : []))
    add(v);
  for (const row of rows) {
    const v = valueOf(row, key);
    if (!isEmpty(v)) add(String(Array.isArray(v) ? v[0] : v));
  }
  return out;
}
