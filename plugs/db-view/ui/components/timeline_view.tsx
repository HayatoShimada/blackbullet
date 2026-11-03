// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada
/**
 * The timeline (Gantt) view: a toolbar, the table of rows on the left and the
 * grid of bars on the right, one line each. Everything it draws comes from
 * the Mediator's state (`selectTimeline`); everything the reader does goes
 * back as a `tl.*` event, through `bar_drag.ts` for the pointer.
 *
 * Rule note (Passive View): the scroll position, the hovered day of an
 * undated row's lane and the table's resize drag are geometry the Mediator
 * cannot see from the sandbox; they never decide what happens. Where to scroll
 * to (`focus`), the window and every write still come from the Mediator.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { valueOf } from "../../src/derive.ts";
import type { Column, DbRow, Zoom } from "../../src/model.ts";
import {
  addDays,
  dayAt,
  type Line,
  type Span,
  spanDays,
  xOf,
  ZOOMS,
} from "../../src/timeline.ts";
import { createBarDrag, type BarDrag } from "../mediator/bar_drag.ts";
import {
  type DbEvent,
  type DbState,
  type DbView,
  newRowOf,
} from "../mediator/db_mediator.ts";
import {
  spanLabel,
  type TimelineView as TimelineModel,
} from "../mediator/timeline_mediator.ts";
import { Cell, isDoneRow, PageLink } from "./cell.tsx";
import { NewRowEntry } from "./new_row.tsx";
import { Popover, rectOf } from "./popover.tsx";

type Emit = (event: DbEvent) => void;

/** Every line is this tall, in the table and on the grid. */
export const ROW = 32;
/** The two header rows of the scale. */
const HEAD = 48;
const EDGE_PX = 8;

const ZOOM_LABELS: Record<Zoom, string> = {
  day: "Day",
  week: "Week",
  month: "Month",
  quarter: "Quarter",
  year: "Year",
};

const noScroll = (e: Event) => e.preventDefault();

/** The attributes a timeline can be grouped by: the selects and the page
 * links among the columns, and the usual ones. */
function groupChoices(columns: Column[], state: DbState): string[] {
  const out: string[] = [];
  for (const c of columns)
    if ((c.kind === "select" || c.link) && !out.includes(c.key))
      out.push(c.key);
  for (const k of state.spec.source.kind === "tasks"
    ? ["page"]
    : ["status", "area"])
    if (!out.includes(k)) out.push(k);
  return out;
}

function Toolbar({
  state,
  model,
  columns,
  emit,
}: {
  state: DbState;
  model: TimelineModel;
  columns: Column[];
  emit: Emit;
}) {
  const t = state.timeline;
  return (
    <div class="db-tl-bar">
      <nav class="sb-segments db-tl-zoom" aria-label="Zoom">
        {ZOOMS.map((z) => (
          <button
            type="button"
            key={z}
            class={`sb-segment${t.zoom === z ? " sb-segment-active" : ""}`}
            aria-pressed={t.zoom === z}
            onClick={() => emit({ type: "tl.zoom", zoom: z })}
          >
            {ZOOM_LABELS[z]}
          </button>
        ))}
      </nav>
      <button
        type="button"
        class="sb-button"
        onClick={() => emit({ type: "tl.today" })}
      >
        Today
      </button>
      <label class="db-tl-group">
        <span>Group</span>
        <select
          class="sb-select"
          value={t.group ?? ""}
          onChange={(e) =>
            emit({
              type: "tl.group",
              key: (e.currentTarget as HTMLSelectElement).value || null,
            })
          }
        >
          <option value="">None</option>
          {groupChoices(columns, state).map((k) => (
            <option value={k} key={k}>
              {columns.find((c) => c.key === k)?.label ?? k}
            </option>
          ))}
        </select>
      </label>
      <span class="db-tl-spacer" />
      <button
        type="button"
        class={`sb-button${t.showUndated ? " db-tl-on" : ""}`}
        aria-pressed={t.showUndated}
        disabled={model.undated.length === 0 && !t.showUndated}
        onClick={() => emit({ type: "tl.undated" })}
      >
        No date ({model.undated.length})
      </button>
      <button
        type="button"
        class={`sb-button${t.showTable ? " db-tl-on" : ""}`}
        aria-pressed={t.showTable}
        onClick={() => emit({ type: "tl.table" })}
      >
        Table
      </button>
    </div>
  );
}

/** The undated rows, to be dragged onto a day. */
function Undated({
  rows,
  state,
  drag,
}: {
  rows: DbRow[];
  state: DbState;
  drag: BarDrag;
}) {
  return (
    <div class="db-tl-undated" aria-label="Rows without dates">
      <span class="db-hint">Drag onto the timeline to give it a date:</span>
      {rows.map((r) => (
        <span
          key={r.id}
          class={`db-chip db-tl-undated-item${state.mode.kind === "placing" && state.mode.rowId === r.id ? " db-dragging" : ""}`}
          onPointerDown={(e) => drag.down({ kind: "place", rowId: r.id }, e)}
        >
          {r.title}
        </span>
      ))}
    </div>
  );
}

/** One line of the table: a group's heading, or a row with its cells. */
function TableLine({
  line,
  columns,
  state,
  emit,
}: {
  line: Line;
  columns: Column[];
  state: DbState;
  emit: Emit;
}) {
  if (line.type === "group") {
    return (
      <div class="db-tl-tr db-tl-group-line">
        <button
          type="button"
          class="db-tl-fold"
          aria-expanded={!line.collapsed}
          aria-label={`${line.collapsed ? "Open" : "Fold"} ${line.label}`}
          onClick={() => emit({ type: "tl.fold", key: `g:${line.key}` })}
        >
          <span class={`db-tl-caret${line.collapsed ? "" : " db-tl-open"}`}>
            ▸
          </span>
        </button>
        <strong>{line.label}</strong>
        <span class="db-count">{line.count}</span>
      </div>
    );
  }
  const { row } = line;
  const editing = state.mode.kind === "editing" && state.mode.rowId === row.id;
  return (
    <div class={`db-tl-tr${isDoneRow(row) ? " db-row-done" : ""}`}>
      {columns.map((c, i) => (
        <div
          key={c.key}
          class={`db-tl-td${i === 0 ? " db-tl-td-title" : ""}`}
          style={
            i === 0 ? { paddingLeft: `${4 + line.depth * 16}px` } : undefined
          }
        >
          {i === 0 &&
            (line.children > 0 ? (
              <button
                type="button"
                class="db-tl-fold"
                aria-expanded={!line.collapsed}
                aria-label={`${line.collapsed ? "Show" : "Hide"} the ${line.children} under ${row.title}`}
                onClick={() => emit({ type: "tl.fold", key: `r:${row.id}` })}
              >
                <span
                  class={`db-tl-caret${line.collapsed ? "" : " db-tl-open"}`}
                >
                  ▸
                </span>
              </button>
            ) : (
              <span class="db-tl-fold-gap" />
            ))}
          {i === 0 ? (
            <PageLink
              title={row.page}
              onOpen={() => emit({ type: "row.open", rowId: row.id })}
            >
              {row.title}
            </PageLink>
          ) : (
            <Cell
              row={row}
              column={c}
              value={valueOf(row, c.key)}
              today={state.today}
              busy={state.mode.kind === "writing"}
              editing={
                editing &&
                state.mode.kind === "editing" &&
                state.mode.column === c.key
              }
              emit={emit}
            />
          )}
        </div>
      ))}
    </div>
  );
}

function Table({
  model,
  columns,
  state,
  emit,
}: {
  model: TimelineModel;
  columns: Column[];
  state: DbState;
  emit: Emit;
}) {
  const startX = useRef(0);
  const startW = useRef(0);
  const width = state.timeline.tableWidth;
  return (
    <div class="db-tl-table" style={{ width: `${width}px` }}>
      <div class="db-tl-tr db-tl-th" style={{ height: `${HEAD}px` }}>
        {columns.map((c, i) => (
          <div
            key={c.key}
            class={`db-tl-td${i === 0 ? " db-tl-td-title" : ""}`}
          >
            {c.label}
          </div>
        ))}
      </div>
      {model.lines.map((line) => (
        <TableLine
          key={line.type === "group" ? `g:${line.key}` : line.row.id}
          line={line}
          columns={columns}
          state={state}
          emit={emit}
        />
      ))}
      {state.spec.database && <div class="db-tl-tr db-tl-add-line" />}
      <div
        class="db-tl-resize"
        role="separator"
        aria-orientation="vertical"
        aria-label="Table width"
        aria-valuenow={width}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
            e.preventDefault();
            emit({
              type: "tl.table.width",
              width: width + (e.key === "ArrowLeft" ? -24 : 24),
            });
          }
        }}
        onPointerDown={(e) => {
          (e.currentTarget as Element).setPointerCapture(e.pointerId);
          startX.current = e.clientX;
          startW.current = width;
        }}
        onPointerMove={(e) => {
          if (!(e.currentTarget as Element).hasPointerCapture(e.pointerId))
            return;
          emit({
            type: "tl.table.width",
            width: startW.current + e.clientX - startX.current,
          });
        }}
      />
    </div>
  );
}

/** A bar: its body moves it, its ends stretch it, the dot pulls a link. */
function Bar({
  line,
  span,
  model,
  state,
  drag,
  emit,
}: {
  line: Extract<Line, { type: "row" }>;
  span: Span;
  model: TimelineModel;
  state: DbState;
  drag: BarDrag;
  emit: Emit;
}) {
  const { row } = line;
  const x = xOf(span.start, model.window, state.timeline.zoom);
  const width = Math.max(spanDays(span) * model.pxPerDay, 6);
  const mode = state.mode;
  const active = mode.kind === "scheduling" && mode.rowId === row.id;
  const target =
    mode.kind === "linking" && mode.over === row.id && mode.fromId !== row.id;
  const busy = mode.kind === "writing";
  const label = `${row.title}: ${spanLabel(span)}`;
  const grip = (edge: "move" | "start" | "end") => (e: PointerEvent) => {
    e.stopPropagation();
    drag.down({ kind: "bar", rowId: row.id, edge }, e, busy);
  };
  const progress =
    line.rollup && line.rollup.total > 0 ? line.rollup : undefined;
  return (
    <div
      class={`db-tl-bar-item${active ? " db-tl-active" : ""}${target ? " db-drop" : ""}${isDoneRow(row) ? " db-row-done" : ""}`}
      data-bar={row.id}
      style={{ left: `${x}px`, width: `${width}px` }}
      role="button"
      tabIndex={0}
      aria-label={`${label}. Arrow keys move it a day; Shift and arrows change the end.`}
      title={label}
      onPointerDown={grip("move")}
      onClickCapture={(e) => {
        if (drag.consumeClick()) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
      onClick={() => emit({ type: "row.open", rowId: row.id })}
      onKeyDown={(e) => {
        if (e.key === "Enter") emit({ type: "row.open", rowId: row.id });
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        e.preventDefault();
        emit({
          type: "tl.bar.nudge",
          rowId: row.id,
          edge: e.shiftKey ? (e.altKey ? "start" : "end") : "move",
          delta: e.key === "ArrowLeft" ? -1 : 1,
        });
      }}
    >
      <span class="db-tl-grip db-tl-grip-start" onPointerDown={grip("start")} />
      <span class="db-tl-bar-label">
        {row.title}
        {progress && (
          <span class="db-tl-progress">
            {" "}
            {progress.done}/{progress.total}
          </span>
        )}
      </span>
      <span class="db-tl-grip db-tl-grip-end" onPointerDown={grip("end")} />
      {row.kind === "page" && (
        <span
          class="db-tl-link"
          title="Drag to a row that waits for this one"
          onPointerDown={(e) => {
            e.stopPropagation();
            drag.down({ kind: "link", rowId: row.id }, e, busy);
          }}
        />
      )}
      {active && <span class="db-tl-tip">{spanLabel(span)}</span>}
    </div>
  );
}

/** A project's span from its tasks: drawn, not dragged. */
function RollupBar({
  span,
  line,
  model,
  state,
}: {
  span: Span;
  line: Extract<Line, { type: "row" }>;
  model: TimelineModel;
  state: DbState;
}) {
  const x = xOf(span.start, model.window, state.timeline.zoom);
  const width = Math.max(spanDays(span) * model.pxPerDay, 6);
  const r = line.rollup;
  return (
    <div
      class={`db-tl-rollup${line.span ? " db-tl-rollup-band" : ""}`}
      style={{ left: `${x}px`, width: `${width}px` }}
      title={`${line.row.title}: ${spanLabel(span)} from its ${r?.total ?? 0} items`}
    >
      {!line.span && (
        <span class="db-tl-bar-label">
          {line.row.title}
          {r && r.total > 0 && (
            <span class="db-tl-progress">
              {" "}
              {r.done}/{r.total}
            </span>
          )}
        </span>
      )}
    </div>
  );
}

/** An undated row's lane: a ghost bar follows the pointer, a click dates it. */
function EmptyLane({
  row,
  model,
  state,
  emit,
}: {
  row: DbRow;
  model: TimelineModel;
  state: DbState;
  emit: Emit;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const zoom = state.timeline.zoom;
  const dayOf = (e: MouseEvent) => {
    const rect = (e.currentTarget as Element).getBoundingClientRect();
    return dayAt(e.clientX - rect.left, model.window, zoom);
  };
  return (
    <div
      class="db-tl-empty"
      onMouseMove={(e) => state.mode.kind === "idle" && setHover(dayOf(e))}
      onMouseLeave={() => setHover(null)}
      onClick={(e) => emit({ type: "tl.place", rowId: row.id, day: dayOf(e) })}
    >
      {hover && state.mode.kind === "idle" && (
        <span
          class="db-tl-ghost"
          style={{
            left: `${xOf(hover, model.window, zoom)}px`,
            width: `${Math.max(model.pxPerDay, 12)}px`,
          }}
          title={`Set to ${spanLabel({ start: hover, end: hover })}`}
        />
      )}
    </div>
  );
}

/** The arrows: from the end of a blocker to the start of what waits for it. */
function Arrows({
  model,
  state,
  emit,
}: {
  model: TimelineModel;
  state: DbState;
  emit: Emit;
}) {
  const zoom = state.timeline.zoom;
  const spanOfId = (id: string, line: number) => {
    const l = model.lines[line];
    return model.preview.get(id) ?? (l.type === "row" ? l.span : undefined);
  };
  return (
    <svg
      class="db-tl-arrows"
      width={model.width}
      height={model.lines.length * ROW}
      aria-hidden="true"
    >
      <defs>
        <marker
          id="db-tl-head"
          viewBox="0 0 8 8"
          refX="7"
          refY="4"
          markerWidth="7"
          markerHeight="7"
          orient="auto"
        >
          <path d="M0,0 L8,4 L0,8 z" class="db-tl-head" />
        </marker>
        <marker
          id="db-tl-head-late"
          viewBox="0 0 8 8"
          refX="7"
          refY="4"
          markerWidth="7"
          markerHeight="7"
          orient="auto"
        >
          <path d="M0,0 L8,4 L0,8 z" class="db-tl-head db-tl-late" />
        </marker>
      </defs>
      {model.edges.map((e) => {
        const from = spanOfId(e.from, e.fromLine);
        const to = spanOfId(e.to, e.toLine);
        if (!from || !to) return null;
        const late = to.start <= from.end;
        const x1 = xOf(addDays(from.end, 1), model.window, zoom);
        const x2 = xOf(to.start, model.window, zoom);
        const y1 = e.fromLine * ROW + ROW / 2;
        const y2 = e.toLine * ROW + ROW / 2;
        const mid = y1 + (y2 > y1 ? ROW / 2 : -ROW / 2);
        const d =
          x2 - EDGE_PX >= x1 + EDGE_PX
            ? `M${x1},${y1} H${x1 + EDGE_PX} V${y2} H${x2}`
            : `M${x1},${y1} H${x1 + EDGE_PX} V${mid} H${x2 - EDGE_PX * 2} V${y2} H${x2}`;
        const open =
          state.mode.kind === "depmenu" &&
          state.mode.from === e.from &&
          state.mode.to === e.to;
        return (
          <g
            key={`${e.from}>${e.to}`}
            class={`db-tl-arrow${late ? " db-tl-late" : ""}${open ? " db-tl-active" : ""}`}
          >
            <path
              d={d}
              class="db-tl-arrow-line"
              markerEnd={`url(#${late ? "db-tl-head-late" : "db-tl-head"})`}
            />
            <path
              d={d}
              class="db-tl-arrow-hit"
              data-popover-trigger
              onClick={(ev) =>
                emit({
                  type: "tl.dep.menu",
                  from: e.from,
                  to: e.to,
                  rect: rectOf(ev.currentTarget as Element),
                })
              }
            >
              <title>
                {late ? "Starts before what it waits for is done" : "Waits for"}
              </title>
            </path>
          </g>
        );
      })}
    </svg>
  );
}

function DependencyMenu({ state, emit }: { state: DbState; emit: Emit }) {
  if (state.mode.kind !== "depmenu") return null;
  const name = (id: string) =>
    [...state.rows, ...state.children].find((r) => r.id === id)?.title ?? id;
  return (
    <Popover
      anchor={state.mode.anchor}
      label="Dependency"
      onClose={() => emit({ type: "tl.dep.close" })}
      items={[
        {
          label: `Open ${name(state.mode.from)}`,
          onSelect: () =>
            emit({
              type: "link.open",
              target: state.mode.kind === "depmenu" ? state.mode.from : "",
            }),
        },
        {
          label: `Open ${name(state.mode.to)}`,
          onSelect: () =>
            emit({
              type: "link.open",
              target: state.mode.kind === "depmenu" ? state.mode.to : "",
            }),
        },
        "separator",
        {
          label: "Remove dependency",
          danger: true,
          onSelect: () => emit({ type: "tl.dep.remove" }),
        },
      ]}
    />
  );
}

/** The grid: the scale, weekends, today, every line's bar, and the arrows. */
function Grid({
  model,
  state,
  emit,
  drag,
  canvas,
}: {
  model: TimelineModel;
  state: DbState;
  emit: Emit;
  drag: BarDrag;
  canvas: { current: HTMLDivElement | null };
}) {
  const zoom = state.timeline.zoom;
  const rowsHeight = (model.lines.length + (state.spec.database ? 1 : 0)) * ROW;
  return (
    <div
      class="db-tl-canvas"
      ref={canvas}
      style={{ width: `${model.width}px` }}
    >
      <div class="db-tl-head" style={{ height: `${HEAD}px` }}>
        <div class="db-tl-ticks db-tl-upper">
          {model.ticks.upper.map((t) => (
            <span
              key={t.start}
              class="db-tl-tick"
              style={{ left: `${t.x}px`, width: `${t.width}px` }}
            >
              <span class="db-tl-tick-label">{t.label}</span>
            </span>
          ))}
        </div>
        <div class="db-tl-ticks db-tl-lower">
          {model.ticks.lower.map((t) => (
            <span
              key={t.start}
              class={`db-tl-tick${t.start === state.today ? " db-today" : ""}`}
              style={{ left: `${t.x}px`, width: `${t.width}px` }}
            >
              {t.width >= 14 && <span class="db-tl-tick-label">{t.label}</span>}
            </span>
          ))}
        </div>
      </div>
      <div class="db-tl-rows" style={{ height: `${rowsHeight}px` }}>
        {model.ticks.weekends.map((w) => (
          <span
            key={w.start}
            class="db-tl-weekend"
            style={{ left: `${w.x}px`, width: `${w.width}px` }}
          />
        ))}
        {model.ticks.lower.map((t) => (
          <span
            key={t.start}
            class="db-tl-gridline"
            style={{ left: `${t.x}px` }}
          />
        ))}
        {model.lines.map((line, i) => {
          const top = { top: `${i * ROW}px` };
          if (line.type === "group") {
            return (
              <div
                key={`g:${line.key}`}
                class="db-tl-lane db-tl-group-lane"
                style={top}
              />
            );
          }
          const span = model.preview.get(line.row.id) ?? line.span;
          const roll = line.rollup?.span;
          return (
            <div
              key={line.row.id}
              class="db-tl-lane"
              style={top}
              data-row={line.row.id}
            >
              {roll && (
                <RollupBar
                  span={roll}
                  line={line}
                  model={model}
                  state={state}
                />
              )}
              {span ? (
                <Bar
                  line={line}
                  span={span}
                  model={model}
                  state={state}
                  drag={drag}
                  emit={emit}
                />
              ) : (
                !roll && (
                  <EmptyLane
                    row={line.row}
                    model={model}
                    state={state}
                    emit={emit}
                  />
                )
              )}
            </div>
          );
        })}
        {state.spec.database && (
          <div
            class="db-tl-lane db-tl-add-lane"
            style={{ top: `${model.lines.length * ROW}px` }}
            title="Drag across the days to add a row"
            onPointerDown={(e) => {
              const rect = (e.currentTarget as Element).getBoundingClientRect();
              drag.down(
                {
                  kind: "draw",
                  day: dayAt(e.clientX - rect.left, model.window, zoom),
                },
                e,
                state.mode.kind !== "idle",
              );
            }}
          >
            {model.drawing ? (
              <span
                class="db-tl-bar-item db-tl-drawing"
                style={{
                  left: `${xOf(model.drawing.start, model.window, zoom)}px`,
                  width: `${spanDays(model.drawing) * model.pxPerDay}px`,
                }}
              >
                <span class="db-tl-tip">{spanLabel(model.drawing)}</span>
              </span>
            ) : (
              <span class="db-hint db-tl-add-hint">
                + Drag across the days to add a row
              </span>
            )}
          </div>
        )}
        {model.todayX !== null && (
          <span
            class="db-tl-now"
            style={{ left: `${model.todayX + model.pxPerDay / 2}px` }}
          />
        )}
        <Arrows model={model} state={state} emit={emit} />
      </div>
    </div>
  );
}

export function TimelineView({
  state,
  view,
  emit,
}: {
  state: DbState;
  view: DbView;
  emit: Emit;
}) {
  const model = view.timeline as TimelineModel;
  const t = state.timeline;
  const scroller = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const emitRef = useRef(emit);
  emitRef.current = emit;
  const modelRef = useRef(model);
  modelRef.current = model;
  const drag = useRef<BarDrag | null>(null);
  // The element a press landed on: it takes the pointer when a drag starts,
  // so a release outside the frame still ends the drag.
  const pressed = useRef<Element | null>(null);
  if (!drag.current) {
    drag.current = createBarDrag({
      emit: (e) => emitRef.current(e),
      pxPerDay: () => modelRef.current.pxPerDay,
      dayAt: (x, y) => {
        const c = canvas.current?.getBoundingClientRect();
        if (!c || x < c.left || x > c.right || y < c.top || y > c.bottom)
          return null;
        const m = modelRef.current;
        return addDays(m.window.from, Math.floor((x - c.left) / m.pxPerDay));
      },
      rowAt: (x, y) =>
        document
          .elementFromPoint(x, y)
          ?.closest("[data-row]")
          ?.getAttribute("data-row") ?? null,
      onStart: (id) => {
        try {
          pressed.current?.setPointerCapture(id);
        } catch {
          // The element is gone: the drag still ends on Esc or the next press.
        }
        document.addEventListener("touchmove", noScroll, { passive: false });
      },
      onEnd: (id) => {
        if (pressed.current?.hasPointerCapture?.(id))
          pressed.current.releasePointerCapture(id);
        document.removeEventListener("touchmove", noScroll);
      },
    });
  }
  const d = drag.current;
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && d.cancel();
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("keydown", esc);
      d.cancel();
    };
  }, []);

  // Bring the asked-for day into view (on opening, Today, a new zoom); else,
  // when days were added on the left, keep what was on screen where it was.
  const seen = useRef({ seq: -1, from: t.window.from });
  const extending = useRef(false);
  useLayoutEffect(() => {
    const el = scroller.current;
    const before = seen.current;
    seen.current = { seq: t.focus.seq, from: t.window.from };
    extending.current = false;
    if (!el) return;
    if (before.seq !== t.focus.seq) {
      el.scrollLeft = Math.max(
        0,
        xOf(t.focus.day, t.window, t.zoom) - el.clientWidth / 3,
      );
    } else if (before.from !== t.window.from) {
      el.scrollLeft += xOf(before.from, t.window, t.zoom);
    }
  }, [t.focus.seq, t.window.from, t.window.days, t.zoom]);

  const columns = state.spec.columns
    ? view.columns
    : view.columns.filter((c) => c.key === "title");
  const named = columns.some((c) => c.key === "title")
    ? columns
    : [
        { key: "title", label: "Name", kind: "text" as const, editable: false },
        ...columns,
      ];
  const newRow = newRowOf(state);

  return (
    <div
      class="db-timeline"
      onPointerDownCapture={(e) => {
        pressed.current = e.target as Element;
      }}
      onPointerMove={(e) => d.move(e)}
      onPointerUp={(e) => d.up(e)}
      onPointerCancel={() => d.cancel()}
      onLostPointerCapture={() => d.dragging() && d.cancel()}
    >
      <Toolbar state={state} model={model} columns={view.columns} emit={emit} />
      {t.showUndated && model.undated.length > 0 && (
        <Undated rows={model.undated} state={state} drag={d} />
      )}
      {newRow && (newRow.at === "timeline" || newRow.at === undefined) && (
        <NewRowEntry row={newRow} emit={emit} />
      )}
      <div class="db-tl-body">
        {t.showTable && (
          <Table model={model} columns={named} state={state} emit={emit} />
        )}
        <div
          class="db-tl-scroll"
          ref={scroller}
          onScroll={(e) => {
            const el = e.currentTarget as HTMLDivElement;
            if (extending.current) return;
            const room = 240;
            if (el.scrollLeft < room) {
              extending.current = true;
              emit({ type: "tl.extend", side: "before" });
            } else if (el.scrollLeft + el.clientWidth > el.scrollWidth - room) {
              extending.current = true;
              emit({ type: "tl.extend", side: "after" });
            }
          }}
        >
          <Grid
            model={model}
            state={state}
            emit={emit}
            drag={d}
            canvas={canvas}
          />
        </div>
      </div>
      {model.lines.length === 0 && (
        <p class="db-empty-note">Nothing to show yet.</p>
      )}
      <DependencyMenu state={state} emit={emit} />
    </div>
  );
}
