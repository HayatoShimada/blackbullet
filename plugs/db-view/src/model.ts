export type ViewKind = "table" | "board" | "calendar";

export type SourceSpec =
  | { kind: "projects" }
  | { kind: "tasks" }
  | { kind: "tag"; tag: string };

/** What a ```db block asks for, after validation and defaults. */
export type Spec = {
  source: SourceSpec;
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
  /** Only rows whose attributes equal these. */
  where: Record<string, string | number | boolean>;
  limit: number;
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
};

export const DEFAULT_LIMIT = 500;
export const DEFAULT_STATUS_ORDER = ["active", "someday", "done"];
