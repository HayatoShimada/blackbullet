// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada
/**
 * The timeline (Gantt) view's pure part: where a row's bar sits, the scale and
 * its ticks, the rows in their groups and under their parents, a parent's
 * rolled-up span, and the dependency arrows with what a move pushes along.
 * Every date is an ISO day (`2026-10-02`); a span's end is inclusive.
 */
import { groupRows, NONE_KEY, normalizeDate, valueOf } from "./derive.ts";
import type { DbRow, Spec, Zoom } from "./model.ts";

export type { Zoom };
export const ZOOMS: Zoom[] = ["day", "week", "month", "quarter", "year"];

export type Span = { start: string; end: string };

/** The attributes a timeline reads, with their defaults. */
export type TimelineKeys = {
  start: string;
  end: string;
  parent: string;
  dependsOn: string;
};

export function timelineKeys(spec: Spec): TimelineKeys {
  return {
    start: spec.start ?? "start",
    end: spec.date,
    parent: spec.parent ?? "parent",
    dependsOn: spec.dependsOn ?? "blockedBy",
  };
}

export const dayNumber = (iso: string): number => {
  const [y, m, d] = iso.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
};

export function isoOf(day: number): string {
  return new Date(day * 86400000).toISOString().slice(0, 10);
}

export const addDays = (iso: string, n: number): string =>
  isoOf(dayNumber(iso) + n);

/** Days from `a` to `b` (positive when `b` is later). */
export const daysBetween = (a: string, b: string): number =>
  dayNumber(b) - dayNumber(a);

/** Where a row's bar runs: both dates, or the one it has (a one-day bar).
 * Start after end is read the other way round. */
export function spanOf(
  row: DbRow,
  keys: Pick<TimelineKeys, "start" | "end">,
): Span | undefined {
  const s = normalizeDate(valueOf(row, keys.start));
  const e = normalizeDate(valueOf(row, keys.end));
  if (!s && !e) return undefined;
  const start = s ?? (e as string);
  const end = e ?? start;
  return start <= end ? { start, end } : { start: end, end: start };
}

export const spanDays = (span: Span): number =>
  daysBetween(span.start, span.end) + 1;

/** How wide a day is, and what the two header rows count in. */
export type Scale = {
  pxPerDay: number;
  upper: "month" | "year";
  lower: "day" | "week" | "month";
  /** Days added either side of the rows when the view opens. */
  pad: number;
};

const SCALES: Record<Zoom, Scale> = {
  day: { pxPerDay: 44, upper: "month", lower: "day", pad: 7 },
  week: { pxPerDay: 22, upper: "month", lower: "day", pad: 14 },
  month: { pxPerDay: 7, upper: "month", lower: "week", pad: 31 },
  quarter: { pxPerDay: 2.5, upper: "year", lower: "month", pad: 92 },
  year: { pxPerDay: 1, upper: "year", lower: "month", pad: 183 },
};

export const scaleOf = (zoom: Zoom): Scale => SCALES[zoom];

/** The days the timeline draws: `from`, and how many. */
export type Window = { from: string; days: number };

export const xOf = (iso: string, w: Window, zoom: Zoom): number =>
  daysBetween(w.from, iso) * scaleOf(zoom).pxPerDay;

/** The day under `x` (pixels from the window's left edge). */
export const dayAt = (x: number, w: Window, zoom: Zoom): string =>
  addDays(w.from, Math.floor(x / scaleOf(zoom).pxPerDay));

/** Whole days `dx` pixels make, rounded to the nearest. */
export const daysFor = (dx: number, zoom: Zoom): number =>
  Math.round(dx / scaleOf(zoom).pxPerDay) || 0;

const weekday = (iso: string): number => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
};

const monthStart = (iso: string) => `${iso.slice(0, 7)}-01`;

/** The first day of the week `iso` is in. */
export const weekStartOf = (iso: string, weekStart: 0 | 1): string =>
  addDays(iso, -((weekday(iso) - weekStart + 7) % 7));

/**
 * The days the view opens on: every bar and today, with some room either side,
 * starting on a week (day, week zoom) or a month (wider zooms), and never
 * narrower than a screenful.
 */
export function initialWindow(
  spans: readonly Span[],
  today: string,
  zoom: Zoom,
  weekStart: 0 | 1 = 0,
): Window {
  const { pad, pxPerDay } = scaleOf(zoom);
  let lo = today;
  let hi = today;
  for (const s of spans) {
    if (s.start < lo) lo = s.start;
    if (s.end > hi) hi = s.end;
  }
  // A view opens near today: a project from years ago does not stretch it.
  const reach = Math.round(1200 / pxPerDay) * 2;
  if (daysBetween(lo, today) > reach) lo = addDays(today, -reach);
  if (daysBetween(today, hi) > reach) hi = addDays(today, reach);
  let from = addDays(lo, -pad);
  from =
    zoom === "day" || zoom === "week"
      ? weekStartOf(from, weekStart)
      : monthStart(from);
  const minDays = Math.ceil(1600 / pxPerDay);
  const days = Math.max(daysBetween(from, addDays(hi, pad)) + 1, minDays);
  return { from, days };
}

/** More days on one side, when the reader scrolls near an edge. */
export function extendWindow(
  w: Window,
  side: "before" | "after",
  zoom: Zoom,
): Window {
  const more = Math.ceil(1600 / scaleOf(zoom).pxPerDay);
  return side === "before"
    ? { from: addDays(w.from, -more), days: w.days + more }
    : { from: w.from, days: w.days + more };
}

/** A window that holds `iso` with room to its left: `w` when it already
 * does, else one of the same size centred on it. */
export function windowAround(iso: string, w: Window, zoom: Zoom): Window {
  const lead = Math.ceil(240 / scaleOf(zoom).pxPerDay);
  if (
    daysBetween(w.from, iso) >= lead &&
    daysBetween(iso, addDays(w.from, w.days)) > lead
  ) {
    return w;
  }
  return { from: addDays(iso, -Math.floor(w.days / 2)), days: w.days };
}

export type Tick = { start: string; x: number; width: number; label: string };

const MONTHS = [
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

function nextOf(iso: string, unit: "day" | "week" | "month" | "year"): string {
  if (unit === "day") return addDays(iso, 1);
  if (unit === "week") return addDays(iso, 7);
  const [y, m] = iso.split("-").map(Number);
  if (unit === "month")
    return m === 12
      ? `${y + 1}-01-01`
      : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  return `${y + 1}-01-01`;
}

function unitStart(
  iso: string,
  unit: "day" | "week" | "month" | "year",
  weekStart: 0 | 1,
): string {
  if (unit === "day") return iso;
  if (unit === "week") return weekStartOf(iso, weekStart);
  if (unit === "month") return monthStart(iso);
  return `${iso.slice(0, 4)}-01-01`;
}

function label(
  iso: string,
  unit: "day" | "week" | "month" | "year",
  zoom: Zoom,
) {
  const [y, m, d] = iso.split("-").map(Number);
  if (unit === "day") return String(d);
  if (unit === "week") return `${m}/${d}`;
  if (unit === "month")
    return zoom === "day" || zoom === "week" || zoom === "month"
      ? `${MONTHS[m - 1]} ${y}`
      : MONTHS[m - 1];
  return String(y);
}

function tickRow(
  w: Window,
  zoom: Zoom,
  unit: "day" | "week" | "month" | "year",
  weekStart: 0 | 1,
): Tick[] {
  const end = addDays(w.from, w.days);
  const out: Tick[] = [];
  for (
    let at = unitStart(w.from, unit, weekStart);
    at < end;
    at = nextOf(at, unit)
  ) {
    const from = at < w.from ? w.from : at;
    const next = nextOf(at, unit);
    const to = next > end ? end : next;
    out.push({
      start: at,
      x: xOf(from, w, zoom),
      width: daysBetween(from, to) * scaleOf(zoom).pxPerDay,
      label: label(at, unit, zoom),
    });
  }
  return out;
}

/** The two header rows, and the weekend bands (day and week zoom only). */
export function ticks(
  w: Window,
  zoom: Zoom,
  weekStart: 0 | 1 = 0,
): { upper: Tick[]; lower: Tick[]; weekends: Tick[] } {
  const scale = scaleOf(zoom);
  const weekends: Tick[] = [];
  if (scale.lower === "day") {
    for (let i = 0; i < w.days; i++) {
      const iso = addDays(w.from, i);
      const wd = weekday(iso);
      if (wd === 0 || wd === 6) {
        weekends.push({
          start: iso,
          x: i * scale.pxPerDay,
          width: scale.pxPerDay,
          label: "",
        });
      }
    }
  }
  return {
    upper: tickRow(w, zoom, scale.upper, weekStart),
    lower: tickRow(w, zoom, scale.lower, weekStart),
    weekends,
  };
}

/** Which edge of a bar is dragged, or the whole bar. */
export type Edge = "move" | "start" | "end";

/** A bar after a drag of `delta` days: moved whole, or one end, never shorter
 * than one day. */
export function applyDrag(span: Span, edge: Edge, delta: number): Span {
  if (edge === "move")
    return { start: addDays(span.start, delta), end: addDays(span.end, delta) };
  if (edge === "start") {
    const start = addDays(span.start, delta);
    return { start: start > span.end ? span.end : start, end: span.end };
  }
  const end = addDays(span.end, delta);
  return { start: span.start, end: end < span.start ? span.start : end };
}

/** The page a link value names: `[[Page|alias]]`, `[[Page]]` or `Page`. */
export function linkTarget(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  const m = /^\[\[([^\]|]+)(?:\|[^\]]*)?\]\]$/.exec(text);
  const name = (m ? m[1] : text).trim();
  return name === "" ? undefined : name;
}

/** The pages a list of links (or one link) names, each once. */
export function linkTargets(value: unknown): string[] {
  const list = Array.isArray(value)
    ? value
    : value === undefined
      ? []
      : [value];
  const out: string[] = [];
  for (const v of list) {
    const t = linkTarget(v);
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

/** A row's parent: what the loader set (a project's task, a nested task),
 * else a page's `parent` link. */
export function parentOf(row: DbRow, parentKey: string): string | undefined {
  if (row.parentId) return row.parentId;
  return row.kind === "page" ? linkTarget(row.values[parentKey]) : undefined;
}

/** Whether a row counts as finished in a parent's progress. */
export const isDone = (row: DbRow): boolean =>
  row.kind === "task"
    ? row.values.done === true
    : String(row.values.status ?? "") === "done";

export type Rollup = { span?: Span; done: number; total: number };

/** One line of the timeline: a group's heading, or a row at its depth. */
export type Line =
  | {
      type: "group";
      key: string;
      label: string;
      count: number;
      collapsed: boolean;
    }
  | {
      type: "row";
      row: DbRow;
      depth: number;
      /** Rows under it (shown or folded). */
      children: number;
      collapsed: boolean;
      span?: Span;
      /** Its descendants' span and progress, when it has any. */
      rollup?: Rollup;
    };

export type LayoutOptions = {
  keys: TimelineKeys;
  /** Group the top-level rows by this attribute. */
  group?: string;
  order?: readonly string[];
  /** Whether a group (`g:<key>`) or a row with children (`r:<id>`) is
   * folded. */
  collapsed: (key: string) => boolean;
};

/** Rows whose parent is shown sit under it; the rest are top level. A loop of
 * parents is cut where it closes. */
function tree(rows: readonly DbRow[], parentKey: string) {
  const ids = new Set(rows.map((r) => r.id));
  const kids = new Map<string, DbRow[]>();
  const top: DbRow[] = [];
  for (const row of rows) {
    let p = parentOf(row, parentKey);
    // Walk up: a parent that leads back here is no parent.
    const seen = new Set([row.id]);
    for (let at = p; at && ids.has(at); ) {
      if (seen.has(at)) {
        p = undefined;
        break;
      }
      seen.add(at);
      const up = rows.find((r) => r.id === at);
      at = up ? parentOf(up, parentKey) : undefined;
    }
    if (p && ids.has(p) && p !== row.id) {
      const list = kids.get(p);
      if (list) list.push(row);
      else kids.set(p, [row]);
    } else top.push(row);
  }
  return { top, kids };
}

export function rollupOf(
  id: string,
  kids: ReadonlyMap<string, DbRow[]>,
  keys: TimelineKeys,
): Rollup | undefined {
  const under = kids.get(id);
  if (!under || under.length === 0) return undefined;
  let start: string | undefined;
  let end: string | undefined;
  let done = 0;
  let total = 0;
  const stack = [...under];
  const seen = new Set<string>();
  while (stack.length) {
    const r = stack.pop() as DbRow;
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    total++;
    if (isDone(r)) done++;
    const s = spanOf(r, keys);
    if (s) {
      if (!start || s.start < start) start = s.start;
      if (!end || s.end > end) end = s.end;
    }
    stack.push(...(kids.get(r.id) ?? []));
  }
  return {
    ...(start && end ? { span: { start, end } } : {}),
    done,
    total,
  };
}

/** The lines the timeline draws, top to bottom: groups (when asked), each
 * row followed by its children unless folded. */
export function layoutRows(
  rows: readonly DbRow[],
  opts: LayoutOptions,
): Line[] {
  const { top, kids } = tree(rows, opts.keys.parent);
  const out: Line[] = [];
  const emit = (row: DbRow, depth: number) => {
    const under = kids.get(row.id) ?? [];
    const collapsed = under.length > 0 && opts.collapsed(`r:${row.id}`);
    const span = spanOf(row, opts.keys);
    const rollup = rollupOf(row.id, kids, opts.keys);
    out.push({
      type: "row",
      row,
      depth,
      children: under.length,
      collapsed,
      ...(span ? { span } : {}),
      ...(rollup ? { rollup } : {}),
    });
    if (!collapsed) for (const k of under) emit(k, depth + 1);
  };
  if (!opts.group) {
    for (const row of top) emit(row, 0);
    return out;
  }
  for (const g of groupRows(top, opts.group, opts.order)) {
    if (g.rows.length === 0) continue;
    const collapsed = opts.collapsed(`g:${g.key}`);
    out.push({
      type: "group",
      key: g.key,
      label: g.key === NONE_KEY ? "None" : g.label,
      count: g.rows.length,
      collapsed,
    });
    if (!collapsed) for (const row of g.rows) emit(row, 0);
  }
  return out;
}

/** An arrow from the end of `from` to the start of `to` (`to` is blocked by
 * `from`); `late` when `to` starts before `from` is over. */
export type Dependency = { from: string; to: string; late: boolean };

/** The dependency arrows between rows that are drawn with a span. */
export function dependencyEdges(
  rows: readonly DbRow[],
  keys: TimelineKeys,
): Dependency[] {
  const spans = new Map<string, Span>();
  for (const r of rows) {
    const s = spanOf(r, keys);
    if (s) spans.set(r.id, s);
  }
  const out: Dependency[] = [];
  for (const r of rows) {
    if (r.kind !== "page") continue;
    const to = spans.get(r.id);
    if (!to) continue;
    for (const target of linkTargets(r.values[keys.dependsOn])) {
      const from = spans.get(target);
      if (!from || target === r.id) continue;
      out.push({ from: target, to: r.id, late: to.start <= from.end });
    }
  }
  return out;
}

/**
 * What moving `moved` to `next` pushes along: every row it blocks that would
 * now start on or before the blocker's end moves later just enough to start
 * the day after, and so on down the chain. A loop is followed once.
 */
export function cascade(
  rows: readonly DbRow[],
  keys: TimelineKeys,
  moved: string,
  next: Span,
): Map<string, Span> {
  const spans = new Map<string, Span>();
  for (const r of rows) {
    const s = spanOf(r, keys);
    if (s) spans.set(r.id, s);
  }
  const blocks = new Map<string, string[]>();
  for (const e of dependencyEdges(rows, keys)) {
    const list = blocks.get(e.from);
    if (list) list.push(e.to);
    else blocks.set(e.from, [e.to]);
  }
  const out = new Map<string, Span>();
  const now = new Map(spans);
  now.set(moved, next);
  const queue = [moved];
  const seen = new Set([moved]);
  while (queue.length) {
    const id = queue.shift() as string;
    const blocker = now.get(id) as Span;
    for (const to of blocks.get(id) ?? []) {
      if (seen.has(to)) continue;
      const span = now.get(to) as Span;
      if (span.start > blocker.end) continue;
      const shifted = applyDrag(
        span,
        "move",
        daysBetween(span.start, blocker.end) + 1,
      );
      now.set(to, shifted);
      out.set(to, shifted);
      seen.add(to);
      queue.push(to);
    }
  }
  return out;
}

/** The link a dependency is written as. */
export const linkTo = (page: string) => `[[${page}]]`;

/** `blockedBy` with `page` added, or taken out. */
export function withDependency(
  current: unknown,
  page: string,
  add: boolean,
): string[] {
  const list = Array.isArray(current)
    ? current.map(String)
    : current === undefined || current === null || current === ""
      ? []
      : [String(current)];
  const kept = list.filter((v) => linkTarget(v) !== page);
  return add ? [...kept, linkTo(page)] : kept;
}
