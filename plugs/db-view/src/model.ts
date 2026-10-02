export type ViewKind = "table" | "board" | "calendar";

export type SourceSpec =
  | { kind: "projects" }
  | { kind: "tasks" }
  | { kind: "tag"; tag: string };

/** What a declared property holds; `page` is a link to another page. */
export type PropertyType =
  | "text"
  | "select"
  | "date"
  | "number"
  | "boolean"
  | "page";

export type DatabaseProperty = {
  key: string;
  type: PropertyType;
  label?: string;
  /** A select's choices. */
  options?: string[];
  /** What a new row starts with. */
  default?: string | number | boolean;
};

/** A database as `database.define` declared it (Space Lua, via config). */
export type DatabaseSpec = {
  name: string;
  /** The tag its rows carry. */
  tag: string;
  /** Where new rows are made (ends in `/`), or "" for anywhere. */
  folder: string;
  /** A page whose body seeds a new row. */
  template?: string;
  title?: string;
  properties: DatabaseProperty[];
  /** Board: the order of the columns. */
  order?: string[];
};

export type Scalar = string | number | boolean;

/** One test on an attribute; every operator given must hold. `today` stands
 * for today's date in a comparison. */
export type Operators = {
  not?: Scalar;
  lt?: Scalar;
  lte?: Scalar;
  gt?: Scalar;
  gte?: Scalar;
  /** Alias of `lt` / `gt`: reads well with dates (`before: today`). */
  before?: Scalar;
  after?: Scalar;
  /** Text contains (case-insensitive), or a list has an item containing. */
  contains?: Scalar;
  /** true: no value; false: has a value. */
  empty?: boolean;
};

export const OPERATOR_KEYS = [
  "not",
  "lt",
  "lte",
  "gt",
  "gte",
  "before",
  "after",
  "contains",
  "empty",
] as const;

/** A `where` value: equality, an operator object, or a list of either (all
 * of which must hold: several conditions on one key). */
export type WhereValue = Scalar | Operators | (Scalar | Operators)[];

/** What a ```db block asks for, after validation and defaults. */
export type Spec = {
  source: SourceSpec;
  /** The database the block is a view of, when it named one. */
  database?: DatabaseSpec;
  view: ViewKind;
  title?: string;
  /** Board: the attribute whose values are the columns. */
  group: string;
  /** Calendar: the attribute holding the date a card sits on. */
  date: string;
  /** Table: which attributes to show, in order. */
  columns?: string[];
  sort?: { key: string; desc: boolean };
  /** Board: the order of the columns; whatever else is found follows. */
  order?: string[];
  /** Only rows whose attributes satisfy these (see `WhereValue`). */
  where: Record<string, WhereValue>;
  /** The filter box's starting phrase (`filter:` in the block). */
  filter?: string;
  limit: number;
  /** Show archived rows too (`archived: true`); they are hidden otherwise. */
  showArchived?: boolean;
  /** 0 = Sunday, 1 = Monday. */
  weekStart: 0 | 1;
};

export type RowKind = "page" | "task";

/** One row of a view: a page, or a task. The UI knows nothing else. */
export type DbRow = {
  /** The page name, or the task's ref. */
  id: string;
  kind: RowKind;
  /** The page it lives on (a page row's own name). */
  page: string;
  /** What it is called. */
  title: string;
  /** Its attributes: frontmatter for a page, the task's own for a task. */
  values: Record<string, unknown>;
  /** The page's last change when the row was read: to catch a stale write. */
  modified: string;
  /** When the page was created, as the index has it (pages only). */
  created?: string;
  /** A task's range in the page text, and its state character. */
  range?: [number, number];
  state?: string;
  /** A project's task counts. */
  openTasks?: number;
  doneTasks?: number;
};

export type CellKind = "text" | "select" | "date" | "number" | "boolean";

export type Column = {
  key: string;
  label: string;
  kind: CellKind;
  /** Whether the cell can be edited in place. */
  editable: boolean;
  /** A select's choices. */
  options?: string[];
  /** The value names a page: shown as a link to it. */
  link?: boolean;
};

export const DEFAULT_LIMIT = 500;
export const DEFAULT_STATUS_ORDER = ["active", "someday", "done"];
