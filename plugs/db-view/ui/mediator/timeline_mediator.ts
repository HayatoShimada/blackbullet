// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada
/**
 * The timeline's part of the db view's Mediator: what a drag on a bar, a draw
 * on the empty lane, a pull from a bar's link handle or a press on the toolbar
 * means. `db_mediator.ts` hands every `tl.*` event here; like it, this only
 * returns the next state and the effects for the runner, and hears back what
 * landed as `tl.written`.
 */
import { normalizeDate, sortRows, valueOf } from "../../src/derive.ts";
import type { CellKind, DbRow, Zoom } from "../../src/model.ts";
import {
  addDays,
  applyDrag,
  cascade,
  daysBetween,
  dependencyEdges,
  type Dependency,
  type Edge,
  extendWindow,
  initialWindow,
  layoutRows,
  type Line,
  linkTargets,
  scaleOf,
  type Span,
  spanOf,
  ticks,
  type Tick,
  type TimelineKeys,
  timelineKeys,
  type Window,
  windowAround,
  withDependency,
  xOf,
} from "../../src/timeline.ts";
import {
  type DbEffect,
  type DbState,
  type Rect,
  type Transition,
  UNDO_MS,
} from "./db_mediator.ts";

/** What the timeline remembers between renders. */
export type TimelineState = {
  zoom: Zoom;
  window: Window;
  /** A day to scroll to; `seq` changes on every ask, so the same day can be
   * asked for again ("Today" twice). */
  focus: { day: string; seq: number };
  /** Folds flipped from their default: rows with children start folded,
   * groups open. `r:<id>` / `g:<key>`. */
  toggled: string[];
  showTable: boolean;
  tableWidth: number;
  showUndated: boolean;
  /** The attribute top-level rows are grouped by, or none. */
  group?: string;
};

export const TABLE_WIDTH = 280;
export const MIN_TABLE = 160;
export const MAX_TABLE = 640;

/** The timeline's modes, part of the view's `Mode`. */
export type TimelineMode =
  /** A bar is being dragged: moved whole, or by one end, `delta` days. */
  | { kind: "scheduling"; rowId: string; edge: Edge; base: Span; delta: number }
  /** A new row's span is being drawn on the empty lane. */
  | { kind: "drawing"; from: string; to: string }
  /** An undated row is being dragged onto a day. */
  | { kind: "placing"; rowId: string; over: string | null }
  /** A link is being pulled from `fromId` (the blocker) to another bar. */
  | { kind: "linking"; fromId: string; over: string | null }
  /** An arrow's menu is open. */
  | { kind: "depmenu"; from: string; to: string; anchor?: Rect };

/** One attribute a timeline write sets; null clears it. */
export type ValueSet = {
  key: string;
  kind: CellKind;
  value: string | string[] | null;
};

export type RowWrite = { row: DbRow; changes: ValueSet[] };

export type TimelineEvent =
  | { type: "tl.zoom"; zoom: Zoom }
  | { type: "tl.today" }
  /** The reader scrolled near an edge: more days that side. */
  | { type: "tl.extend"; side: "before" | "after" }
  | { type: "tl.fold"; key: string }
  | { type: "tl.table" }
  | { type: "tl.table.width"; width: number }
  | { type: "tl.undated" }
  | { type: "tl.group"; key: string | null }
  | { type: "tl.bar.drag"; rowId: string; edge: Edge }
  | { type: "tl.bar.over"; delta: number }
  | { type: "tl.bar.drop" }
  /** The keyboard: ←/→ on a focused bar. */
  | { type: "tl.bar.nudge"; rowId: string; edge: Edge; delta: number }
  | { type: "tl.place.drag"; rowId: string }
  | { type: "tl.place.over"; day: string | null }
  | { type: "tl.place.drop" }
  /** A click on an undated row's lane: it gets that day. */
  | { type: "tl.place"; rowId: string; day: string }
  | { type: "tl.draw.start"; day: string }
  | { type: "tl.draw.over"; day: string }
  | { type: "tl.draw.drop" }
  | { type: "tl.link.start"; rowId: string }
  | { type: "tl.link.over"; target: string | null }
  | { type: "tl.link.drop" }
  /** A drag of any kind let go somewhere it means nothing, or Esc. */
  | { type: "tl.cancel" }
  | { type: "tl.dep.menu"; from: string; to: string; rect?: Rect }
  | { type: "tl.dep.remove" }
  | { type: "tl.dep.close" }
  /** The runner: every write of a `writeMany` landed. */
  | {
      type: "tl.written";
      results: { rowId: string; modified: string; changes: ValueSet[] }[];
    };

export function initialTimeline(
  state: Pick<DbState, "spec" | "rows" | "children" | "today">,
): TimelineState {
  const zoom = state.spec.zoom ?? "week";
  const keys = timelineKeys(state.spec);
  const spans = [...state.rows, ...state.children]
    .map((r) => spanOf(r, keys))
    .filter((s): s is Span => !!s);
  return {
    zoom,
    window: initialWindow(spans, state.today, zoom, state.spec.weekStart),
    focus: { day: state.today, seq: 1 },
    toggled: [],
    showTable: true,
    tableWidth: TABLE_WIDTH,
    showUndated: false,
    ...(state.spec.grouped ? { group: groupOf(state) } : {}),
  };
}

/** Tasks have no status: grouped by "status", they go by page. */
function groupOf(state: Pick<DbState, "spec">): string {
  return state.spec.source.kind === "tasks" && state.spec.group === "status"
    ? "page"
    : state.spec.group;
}

const stay = (state: DbState): Transition => ({ state, effects: [] });

const idle = (state: DbState): DbState => ({
  ...state,
  mode: { kind: "idle" },
});

const allRows = (state: DbState) => [...state.rows, ...state.children];

const findRow = (state: DbState, id: string) =>
  allRows(state).find((r) => r.id === id);

const withTimeline = (state: DbState, t: Partial<TimelineState>): DbState => ({
  ...state,
  timeline: { ...state.timeline, ...t },
});

/** What an attribute holds, as a write would put it back. */
function previousValue(row: DbRow, key: string): string | string[] | null {
  const v = valueOf(row, key);
  if (v === undefined || v === null || v === "") return null;
  if (Array.isArray(v)) return v.length ? v.map(String) : null;
  return String(v);
}

/** The dates a bar's new span writes: always its end; its start too when the
 * row had one or the bar is longer than a day. */
export function dateChanges(
  row: DbRow,
  keys: TimelineKeys,
  next: Span,
): ValueSet[] {
  const hadStart = !!normalizeDate(valueOf(row, keys.start));
  const out: ValueSet[] = [];
  if (hadStart || next.start !== next.end) {
    out.push({ key: keys.start, kind: "date", value: next.start });
  }
  out.push({ key: keys.end, kind: "date", value: next.end });
  return out;
}

const undoOf = (writes: RowWrite[]): RowWrite[] =>
  writes.map((w) => ({
    row: w.row,
    changes: w.changes.map((c) => ({
      ...c,
      value: previousValue(w.row, c.key),
    })),
  }));

const databaseOf = (state: DbState) =>
  state.spec.database ? { database: state.spec.database.name } : {};

/** "Oct 3 – Oct 10" (or one day). */
export function spanLabel(span: Span): string {
  const f = (iso: string) => {
    const [, m, d] = iso.split("-").map(Number);
    return `${MONTH_SHORT[m - 1]} ${d}`;
  };
  return span.start === span.end
    ? f(span.start)
    : `${f(span.start)} – ${f(span.end)}`;
}

const MONTH_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** Whether a row's dates can be changed here: not a project's rolled-up
 * bar, and a task only when it can be found in its page. */
function canSchedule(row: DbRow): boolean {
  return row.kind === "page" || !!row.range;
}

/** The writes a bar's move makes: the bar itself, and what it pushes. */
function moveWrites(
  state: DbState,
  row: DbRow,
  next: Span,
): { writes: RowWrite[]; pushed: number } {
  const keys = timelineKeys(state.spec);
  const writes: RowWrite[] = [{ row, changes: dateChanges(row, keys, next) }];
  const pushed = cascade(allRows(state), keys, row.id, next);
  for (const [id, span] of pushed) {
    const other = findRow(state, id);
    if (other && canSchedule(other))
      writes.push({ row: other, changes: dateChanges(other, keys, span) });
  }
  return { writes, pushed: writes.length - 1 };
}

function writeMany(
  state: DbState,
  writes: RowWrite[],
  label: string,
): Transition {
  return {
    state: {
      ...state,
      mode: { kind: "writing" },
      notice: null,
      pending: { label, undo: undoOf(writes) },
    },
    effects: [{ type: "writeMany", writes, ...databaseOf(state) }],
  };
}

function schedule(state: DbState, rowId: string, edge: Edge, delta: number) {
  const row = findRow(state, rowId);
  const keys = timelineKeys(state.spec);
  const base = row && spanOf(row, keys);
  if (!row || !base || delta === 0 || !canSchedule(row))
    return stay(idle(state));
  const next = applyDrag(base, edge, delta);
  if (next.start === base.start && next.end === base.end)
    return stay(idle(state));
  const { writes, pushed } = moveWrites(state, row, next);
  const verb = edge === "move" ? "Moved to" : "Set to";
  return writeMany(
    state,
    writes,
    `${verb} ${spanLabel(next)}${pushed ? ` · ${pushed} pushed later` : ""}`,
  );
}

/** Whether `from` is reachable from `to` by following blockers: a link from
 * `from` to `to` would then close a loop. */
function wouldLoop(state: DbState, from: string, to: string): boolean {
  const key = timelineKeys(state.spec).dependsOn;
  const byId = new Map(allRows(state).map((r) => [r.id, r]));
  const stack = [from];
  const seen = new Set<string>();
  while (stack.length) {
    const id = stack.pop() as string;
    if (id === to) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    const r = byId.get(id);
    if (r) stack.push(...linkTargets(r.values[key]));
  }
  return false;
}

function link(state: DbState, fromId: string, toId: string | null): Transition {
  const from = findRow(state, fromId);
  const to = toId ? findRow(state, toId) : undefined;
  if (
    !from ||
    !to ||
    from.id === to.id ||
    to.kind !== "page" ||
    from.kind !== "page"
  )
    return stay(idle(state));
  const key = timelineKeys(state.spec).dependsOn;
  if (linkTargets(to.values[key]).includes(from.id)) return stay(idle(state));
  if (wouldLoop(state, from.id, to.id)) {
    return stay({
      ...idle(state),
      notice: {
        level: "error",
        text: `${to.title} already leads to ${from.title}: linking them would make a loop.`,
      },
    });
  }
  return writeMany(
    state,
    [
      {
        row: to,
        changes: [
          {
            key,
            kind: "pages",
            value: withDependency(to.values[key], from.id, true),
          },
        ],
      },
    ],
    `${to.title} waits for ${from.title}`,
  );
}

export function transitionTimeline(
  state: DbState,
  event: TimelineEvent,
): Transition {
  const mode = state.mode;
  const t = state.timeline;
  switch (event.type) {
    case "tl.zoom": {
      if (event.zoom === t.zoom) return stay(state);
      // Keep the day at the left edge where it was, in the new scale.
      const keys = timelineKeys(state.spec);
      const spans = allRows(state)
        .map((r) => spanOf(r, keys))
        .filter((s): s is Span => !!s);
      const window = initialWindow(
        spans,
        state.today,
        event.zoom,
        state.spec.weekStart,
      );
      return stay(
        withTimeline(state, {
          zoom: event.zoom,
          window,
          focus: { day: t.focus.day, seq: t.focus.seq + 1 },
        }),
      );
    }
    case "tl.today":
      return stay(
        withTimeline(state, {
          window: windowAround(state.today, t.window, t.zoom),
          focus: { day: state.today, seq: t.focus.seq + 1 },
        }),
      );
    case "tl.extend":
      return stay(
        withTimeline(state, {
          window: extendWindow(t.window, event.side, t.zoom),
        }),
      );
    case "tl.fold": {
      const toggled = t.toggled.includes(event.key)
        ? t.toggled.filter((k) => k !== event.key)
        : [...t.toggled, event.key];
      return stay(withTimeline(state, { toggled }));
    }
    case "tl.table":
      return stay(withTimeline(state, { showTable: !t.showTable }));
    case "tl.table.width":
      return stay(
        withTimeline(state, {
          tableWidth: Math.round(
            Math.min(MAX_TABLE, Math.max(MIN_TABLE, event.width)),
          ),
        }),
      );
    case "tl.undated":
      return stay(withTimeline(state, { showUndated: !t.showUndated }));
    case "tl.group": {
      const { group: _, ...rest } = t;
      return stay({
        ...state,
        timeline: event.key ? { ...rest, group: event.key } : rest,
      });
    }

    case "tl.bar.drag": {
      if (mode.kind !== "idle") return stay(state);
      const row = findRow(state, event.rowId);
      const base = row && spanOf(row, timelineKeys(state.spec));
      if (!row || !base || !canSchedule(row)) return stay(state);
      return stay({
        ...state,
        mode: {
          kind: "scheduling",
          rowId: row.id,
          edge: event.edge,
          base,
          delta: 0,
        },
      });
    }
    case "tl.bar.over":
      if (mode.kind !== "scheduling" || mode.delta === event.delta)
        return stay(state);
      return stay({ ...state, mode: { ...mode, delta: event.delta } });
    case "tl.bar.drop":
      if (mode.kind !== "scheduling") return stay(state);
      return schedule(state, mode.rowId, mode.edge, mode.delta);
    case "tl.bar.nudge":
      if (mode.kind !== "idle") return stay(state);
      return schedule(state, event.rowId, event.edge, event.delta);

    case "tl.place.drag": {
      if (mode.kind !== "idle") return stay(state);
      const row = findRow(state, event.rowId);
      if (!row || !canSchedule(row)) return stay(state);
      return stay({
        ...state,
        mode: { kind: "placing", rowId: row.id, over: null },
      });
    }
    case "tl.place.over":
      if (mode.kind !== "placing" || mode.over === event.day)
        return stay(state);
      return stay({ ...state, mode: { ...mode, over: event.day } });
    case "tl.place.drop":
      if (mode.kind !== "placing") return stay(state);
      if (!mode.over) return stay(idle(state));
      return place(idle(state), mode.rowId, mode.over);
    case "tl.place":
      if (mode.kind !== "idle") return stay(state);
      return place(state, event.rowId, event.day);

    case "tl.draw.start":
      if (mode.kind !== "idle" || !state.spec.database) return stay(state);
      return stay({
        ...state,
        mode: { kind: "drawing", from: event.day, to: event.day },
      });
    case "tl.draw.over":
      if (mode.kind !== "drawing" || mode.to === event.day) return stay(state);
      return stay({ ...state, mode: { ...mode, to: event.day } });
    case "tl.draw.drop": {
      if (mode.kind !== "drawing") return stay(state);
      const keys = timelineKeys(state.spec);
      const [start, end] =
        mode.from <= mode.to ? [mode.from, mode.to] : [mode.to, mode.from];
      // The title comes next: the new-row input opens with the span drawn.
      return stay({
        ...state,
        mode: {
          kind: "creating",
          at: "timeline",
          values:
            start === end
              ? { [keys.end]: end }
              : { [keys.start]: start, [keys.end]: end },
        },
      });
    }

    case "tl.link.start": {
      if (mode.kind !== "idle") return stay(state);
      const row = findRow(state, event.rowId);
      if (row?.kind !== "page") return stay(state);
      return stay({
        ...state,
        mode: { kind: "linking", fromId: row.id, over: null },
      });
    }
    case "tl.link.over":
      if (mode.kind !== "linking" || mode.over === event.target)
        return stay(state);
      return stay({ ...state, mode: { ...mode, over: event.target } });
    case "tl.link.drop":
      if (mode.kind !== "linking") return stay(state);
      return link(state, mode.fromId, mode.over);

    case "tl.cancel":
      return stay(
        mode.kind === "scheduling" ||
          mode.kind === "drawing" ||
          mode.kind === "placing" ||
          mode.kind === "linking" ||
          mode.kind === "depmenu"
          ? idle(state)
          : state,
      );

    case "tl.dep.menu":
      if (mode.kind !== "idle" && mode.kind !== "depmenu") return stay(state);
      if (
        mode.kind === "depmenu" &&
        mode.from === event.from &&
        mode.to === event.to
      )
        return stay(idle(state));
      return stay({
        ...state,
        mode: {
          kind: "depmenu",
          from: event.from,
          to: event.to,
          ...(event.rect ? { anchor: event.rect } : {}),
        },
      });
    case "tl.dep.close":
      return stay(mode.kind === "depmenu" ? idle(state) : state);
    case "tl.dep.remove": {
      if (mode.kind !== "depmenu") return stay(state);
      const to = findRow(state, mode.to);
      const from = findRow(state, mode.from);
      if (!to || !from) return stay(idle(state));
      const key = timelineKeys(state.spec).dependsOn;
      const rest = withDependency(to.values[key], mode.from, false);
      return writeMany(
        state,
        [
          {
            row: to,
            changes: [{ key, kind: "pages", value: rest.length ? rest : null }],
          },
        ],
        `${to.title} no longer waits for ${from.title}`,
      );
    }

    case "tl.written": {
      const byId = new Map(event.results.map((r) => [r.rowId, r]));
      const apply = (r: DbRow): DbRow => {
        const done = byId.get(r.id);
        if (!done) return r;
        const values = { ...r.values };
        for (const c of done.changes) {
          if (c.value === null) delete values[c.key];
          else values[c.key] = c.value;
        }
        return { ...r, values, modified: done.modified };
      };
      const rows = state.rows.map(apply);
      const children = state.children.map(apply);
      const next: DbState = {
        ...state,
        rows,
        children,
        mode: { kind: "idle" },
        reloading: true,
        pending: undefined,
      };
      const effects: DbEffect[] = [{ type: "reload" }];
      const pending = state.pending;
      if (!pending) return { state: { ...next, undo: null }, effects };
      // Undo puts back what was there, on the rows as the write left them.
      const fresh = new Map([...rows, ...children].map((r) => [r.id, r]));
      const id = state.undoSeq + 1;
      effects.push({ type: "timer", id, ms: UNDO_MS });
      return {
        state: {
          ...next,
          undoSeq: id,
          undo: {
            id,
            label: pending.label,
            action: {
              kind: "revertMany",
              writes: pending.undo.map((w) => ({
                ...w,
                row: fresh.get(w.row.id) ?? w.row,
              })),
            },
          },
        },
        effects,
      };
    }
  }
}

function place(state: DbState, rowId: string, day: string): Transition {
  const row = findRow(state, rowId);
  if (!row || !canSchedule(row)) return stay(state);
  const keys = timelineKeys(state.spec);
  return writeMany(
    state,
    [{ row, changes: [{ key: keys.end, kind: "date", value: day }] }],
    `Set to ${spanLabel({ start: day, end: day })}`,
  );
}

/** What the timeline paints, derived from the state. */
export type TimelineView = {
  keys: TimelineKeys;
  lines: Line[];
  window: Window;
  pxPerDay: number;
  width: number;
  ticks: { upper: Tick[]; lower: Tick[]; weekends: Tick[] };
  todayX: number | null;
  /** Arrows between rows on screen, by line index. */
  edges: (Dependency & { fromLine: number; toLine: number })[];
  /** Spans as a drag in progress would leave them. */
  preview: Map<string, Span>;
  /** The span being drawn for a new row. */
  drawing?: Span;
  undated: DbRow[];
};

/** Rows with a start first, by start; then the undated, as they came. A
 * chosen sort wins. */
function ordered(rows: readonly DbRow[], state: DbState, keys: TimelineKeys) {
  if (state.sort) return sortRows(rows, state.sort);
  return [...rows]
    .map((row, i) => ({ row, i, s: spanOf(row, keys)?.start }))
    .sort((a, b) =>
      a.s && b.s
        ? a.s < b.s
          ? -1
          : a.s > b.s
            ? 1
            : a.i - b.i
        : a.s
          ? -1
          : b.s
            ? 1
            : a.i - b.i,
    )
    .map((x) => x.row);
}

export function selectTimeline(
  state: DbState,
  filtered: readonly DbRow[],
): TimelineView {
  const t = state.timeline;
  const keys = timelineKeys(state.spec);
  const rows = [
    ...ordered(filtered, state, keys),
    ...ordered(state.children, state, keys),
  ];
  const toggled = new Set(t.toggled);
  const lines = layoutRows(rows, {
    keys,
    ...(t.group ? { group: t.group, order: state.spec.order } : {}),
    // Rows with children start folded; groups start open.
    collapsed: (key) =>
      key.startsWith("r:") ? !toggled.has(key) : toggled.has(key),
  });
  const { pxPerDay } = scaleOf(t.zoom);
  const preview = new Map<string, Span>();
  const mode = state.mode;
  if (mode.kind === "scheduling" && mode.delta !== 0) {
    const next = applyDrag(mode.base, mode.edge, mode.delta);
    preview.set(mode.rowId, next);
    for (const [id, span] of cascade(allRows(state), keys, mode.rowId, next))
      preview.set(id, span);
  }
  if (mode.kind === "placing" && mode.over) {
    preview.set(mode.rowId, { start: mode.over, end: mode.over });
  }
  const lineOf = new Map<string, number>();
  lines.forEach((l, i) => {
    if (l.type === "row") lineOf.set(l.row.id, i);
  });
  const shown = lines.flatMap((l) => (l.type === "row" ? [l.row] : []));
  const edges = dependencyEdges(shown, keys).map((e) => ({
    ...e,
    fromLine: lineOf.get(e.from) as number,
    toLine: lineOf.get(e.to) as number,
  }));
  const end = addDays(t.window.from, t.window.days);
  const inside = state.today >= t.window.from && state.today < end;
  return {
    keys,
    lines,
    window: t.window,
    pxPerDay,
    width: t.window.days * pxPerDay,
    ticks: ticks(t.window, t.zoom, state.spec.weekStart),
    todayX: inside ? xOf(state.today, t.window, t.zoom) : null,
    edges,
    preview,
    ...(mode.kind === "drawing"
      ? {
          drawing:
            mode.from <= mode.to
              ? { start: mode.from, end: mode.to }
              : { start: mode.to, end: mode.from },
        }
      : {}),
    undated: shown.filter((r) => {
      if (spanOf(r, keys)) return false;
      const line = lines[lineOf.get(r.id) as number];
      return !(line.type === "row" && line.rollup?.span);
    }),
  };
}

/** Days between two ISO dates, for a bar's width (inclusive). */
export const barDays = (span: Span) => daysBetween(span.start, span.end) + 1;
