import type {
  ActionMeta as BaseActionMeta,
  Decoration,
  Row as BaseRow,
} from "../../plug-api/ui/tree_types.ts";

export type { Decoration };

/** An action as the row menu draws it: `danger` puts it last, in red. */
export type ActionMeta = BaseActionMeta & { danger?: boolean };

/**
 * A row of a navigator view. `passive` makes it a sentence or a count rather
 * than something to act on: no hover, no selection, no Enter.
 */
export type Row = BaseRow & {
  passive?: boolean;
  /**
   * Shown only while the phrase is empty (`"empty"`: a group title, a copy
   * under Recent) or only once something is typed (`"typed"`: a command that
   * is found by name, never browsed into).
   */
  when?: "empty" | "typed";
};

export type FilterFields = Record<
  string,
  number | { weight: number; segments?: boolean }
>;

export type NavigatorHook =
  | "meta"
  | "rows"
  | "content"
  | "select"
  | "create"
  | "key"
  | "action"
  | "rowState"
  | "dropdown"
  | "move";

export type SegmentMeta = {
  label: string;
  icon?: string;
  hasWhere: boolean;
  default?: boolean;
  prefix?: string;
  placeholder?: string;
  /** What the input says in a dock, where there is room for little. */
  dockPlaceholder?: string;
  helpText?: string;
  /**
   * Names this segment leaves out until the phrase starts with them: a
   * trailing `/` is a folder, anything else is one page's name.
   */
  hiddenNames?: string[];
};

export type DropdownMeta = {
  placeholder?: string;
  allLabel?: string;
};

/** One selectable entry of a view's dropdown, as its `options` produced it. */
export type DropdownOption = {
  label: string;
  value: any;
};

export type SourceCtx = {
  phrase: string;
  segment?: string;
  dock?: string;
};

export const WINDOW_DOCKS = ["lhs", "rhs", "bhs"] as const;
export const PAGE_DOCKS = ["page-top", "page-bottom"] as const;
export const ALL_DOCKS = [...WINDOW_DOCKS, "modal", ...PAGE_DOCKS] as const;

export function isPageDock(dock: string): boolean {
  return (PAGE_DOCKS as readonly string[]).includes(dock);
}
export function isWindowDock(dock: string): boolean {
  return (WINDOW_DOCKS as readonly string[]).includes(dock);
}

export const TABLE_COLUMN_TYPES = [
  "ref",
  "number",
  "boolean",
  "url",
  "text",
  "markdown",
] as const;
export type TableColumnType = (typeof TABLE_COLUMN_TYPES)[number];

export type TableColumn = {
  attribute?: string;
  label: string;
  type?: TableColumnType;
};

export type ViewMeta = {
  name: string;
  title: string;
  label?: string;
  placeholder?: string;
  helpText?: string;
  stripPrefix?: string;
  mode: "list" | "tree" | "table";
  columns?: TableColumn[];
  hasContent?: boolean;
  hasSelect?: boolean;
  dock: (typeof ALL_DOCKS)[number];
  supportedDocks?: string[];
  hierarchy: { field: string; separator: string };
  foldersFirst: boolean;
  selectableFolders?: boolean;
  expandAll: boolean;
  expansionScope: "view" | "page";
  filterFields?: FilterFields;
  inlineFilter?: boolean;
  /** `filter = false`: no phrase filtering; the input is hidden but stays the
   * panel's focus home so the keyboard pipeline keeps working. */
  noFilter?: boolean;
  emptyText?: string;
  followEditor: boolean;
  refreshOn: string[];
  hasMove: boolean;
  uploadFiles?: boolean;
  hasCreate: boolean;
  refreshOnOpen: boolean;
  keys?: string[];
  actions?: ActionMeta[];
  segments?: SegmentMeta[];
  dropdown?: DropdownMeta;
  limit: number;
  search: "client" | "source";
  hasRowIcon: boolean;
  prefixViews?: Record<string, string>;
  createIcon?: string;
  /** Create row and hint name the folder the new page goes in. */
  createInFolder?: boolean;
  pathCompletion: boolean;
  hashtagFilter: boolean;
  ephemeral?: boolean;
  openOnStart?: boolean;
  defaultOpen?: boolean;
  builtin?: boolean;
};
