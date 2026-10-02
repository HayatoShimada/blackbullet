/**
 * The block editor's CodeMirror extension: the part that touches the DOM.
 *
 * It is deliberately thin. What a block is (`blocksOf`), where a drop lands
 * (`pickDropTarget`), what a move does (`planBlockMove`) and what the pointer
 * means (the Mediator) are all pure and live beside it. This file only
 *  - paints what the Mediator's state says (classes on lines, the drop line),
 *  - turns raw pointer events into events for the Mediator, and
 *  - carries out the one thing a Mediator effect asks of the editor: dispatch.
 *
 * The handle and the fold toggle are drawn by CSS (`::before` / `::after` on
 * the first line of a block), so they add no DOM to the document and cannot
 * disturb the caret or click positions; a press in their strip of the left
 * margin is what starts a drag or a toggle.
 */
import {
  foldable,
  foldedRanges,
  foldEffect,
  syntaxTree,
  unfoldEffect,
} from "@codemirror/language";
import {
  type Extension,
  RangeSetBuilder,
  StateEffect,
  StateField,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  type EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import { autoScrollDelta } from "./auto_scroll.ts";
import { type Block, blocksOf } from "./blocks.ts";
import { createBlockRunner, type BlockRunner } from "./block_runner.ts";
import type { Boundary } from "./drop_target.ts";
import type { BlockState } from "./block_mediator.ts";

/** The strips left of a block's first line: the handle, then the fold toggle. */
const HANDLE_STRIP = { from: -24, to: 0 };
const FOLD_STRIP = { from: -46, to: -24 };
/** How many lines either side of the pointer count as drop candidates. */
const NEARBY_LINES = 60;

/** Asks the plugin to repaint after its state changed outside an update. */
const repaint = StateEffect.define<null>();

/** Asks for the blocks of the whole document, parsing as much as that takes:
 * sent when a drag starts, so every gap in the page is a possible drop. */
const wholeDocument = StateEffect.define<null>();
const WHOLE_DOCUMENT_BUDGET_MS = 1500;

const blocksField = StateField.define<Block[]>({
  create: (state) => blocksOf(state),
  update(blocks, tr) {
    if (tr.effects.some((e) => e.is(wholeDocument))) {
      return blocksOf(tr.state, WHOLE_DOCUMENT_BUDGET_MS);
    }
    // The parser works in the background: when it has got further, so have the
    // blocks, or a long page would only ever have handles near its top.
    const parsed = syntaxTree(tr.state) !== syntaxTree(tr.startState);
    return tr.docChanged || parsed ? blocksOf(tr.state) : blocks;
  },
});

/** The blocks that start within [from, to]: blocks are in document order, so
 * a binary search finds where to begin. */
function blocksIn(blocks: readonly Block[], from: number, to: number): Block[] {
  let lo = 0;
  let hi = blocks.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (blocks[mid].from < from) lo = mid + 1;
    else hi = mid;
  }
  const out: Block[] = [];
  for (let i = lo; i < blocks.length && blocks[i].from <= to; i++) {
    out.push(blocks[i]);
  }
  return out;
}

/** The innermost block that contains `line`. */
function innermostAt(
  blocks: readonly Block[],
  line: number,
): Block | undefined {
  let best: Block | undefined;
  for (const b of blocks) {
    if (b.startLine <= line && line <= b.endLine) {
      if (!best || b.startLine >= best.startLine) best = b;
    }
  }
  return best;
}

function toggleFoldAtLine(view: EditorView, lineNumber: number): void {
  const line = view.state.doc.line(lineNumber);
  const range = foldable(view.state, line.from, line.to);
  if (!range) return;
  let folded = false;
  foldedRanges(view.state).between(range.from, range.to, (from, to) => {
    if (from === range.from && to === range.to) folded = true;
  });
  view.dispatch({
    effects: (folded ? unfoldEffect : foldEffect).of(range),
  });
}

class BlockEditorPlugin {
  decorations: DecorationSet = Decoration.none;
  private runner: BlockRunner;
  private dropLine: HTMLElement | null = null;
  private cleanupDrag: (() => void) | null = null;
  private pendingRepaint = false;

  constructor(
    private view: EditorView,
    private flash: (message: string) => void,
  ) {
    this.runner = createBlockRunner({
      blocks: () => view.state.field(blocksField),
      text: () => view.state.doc.toString(),
      measure: (pointerY, moving) => this.measure(pointerY, moving),
      apply: (change, cursor) =>
        view.dispatch({
          changes: change,
          selection: { anchor: cursor },
          scrollIntoView: true,
          userEvent: "move.block",
        }),
      toggleFold: (line) => toggleFoldAtLine(view, line),
      flash: (message) => this.flash(message),
      onState: () => this.scheduleRepaint(),
    });
    this.decorations = this.build();
  }

  /** The handle and the fold toggle each have a strip left of the line. */
  zoneAt(event: MouseEvent): {
    kind: "handle" | "fold";
    line: number;
  } | null {
    const el = (event.target as HTMLElement | null)?.closest?.(
      ".cm-line.sb-block-start",
    ) as HTMLElement | null;
    if (!el) return null;
    const dx = event.clientX - el.getBoundingClientRect().left;
    const line = this.view.state.doc.lineAt(this.view.posAtDOM(el)).number;
    if (dx >= HANDLE_STRIP.from && dx < HANDLE_STRIP.to) {
      return { kind: "handle", line };
    }
    if (
      dx >= FOLD_STRIP.from &&
      dx < FOLD_STRIP.to &&
      el.classList.contains("sb-block-foldable")
    ) {
      return { kind: "fold", line };
    }
    return null;
  }

  onMouseDown(event: MouseEvent): boolean {
    // Not while a composition is open: a drag would end it half-written.
    if (event.button !== 0 || this.view.composing) return false;
    const zone = this.zoneAt(event);
    if (!zone) return false;
    event.preventDefault();
    if (zone.kind === "fold") {
      this.runner.emit({ type: "fold.toggle", line: zone.line });
      return true;
    }
    if (this.view.state.readOnly) return true;
    this.view.dispatch({ effects: wholeDocument.of(null) });
    this.runner.emit({ type: "drag.start", line: zone.line, x: event.clientX });
    this.followPointer({ x: event.clientX, y: event.clientY });
    return true;
  }

  onMouseMove(event: MouseEvent): void {
    if (this.runner.getState().kind === "dragging" || this.view.composing) {
      return;
    }
    const top = this.view.documentTop;
    const block = this.view.lineBlockAtHeight(event.clientY - top);
    const line = this.view.state.doc.lineAt(block.from).number;
    const inner = innermostAt(this.view.state.field(blocksField), line);
    this.runner.emit({ type: "hover", line: inner ? inner.startLine : null });
  }

  onMouseLeave(): void {
    this.runner.emit({ type: "hover", line: null });
  }

  /** While a drag is on, the whole window is the drag's: the pointer leaves
   * the editor, and Escape and a release must still be heard. */
  private followPointer(start: { x: number; y: number }): void {
    const doc = this.view.dom.ownerDocument;
    const win = doc.defaultView!;
    let last = start;
    let frame = 0;
    const emitMove = () =>
      this.runner.emit({ type: "drag.move", x: last.x, y: last.y });
    const move = (e: MouseEvent) => {
      last = { x: e.clientX, y: e.clientY };
      emitMove();
    };
    // Near the top or bottom of the editor the page scrolls by itself, and the
    // target is re-picked each frame: the content moves under a still pointer.
    let lastFrame = win.performance.now();
    const scroll = () => {
      const now = win.performance.now();
      // Speed is per second, not per frame: a slow frame scrolls further.
      const frames = Math.min(6, (now - lastFrame) / (1000 / 60));
      lastFrame = now;
      const scroller = this.view.scrollDOM;
      const rect = scroller.getBoundingClientRect();
      const delta = Math.round(
        autoScrollDelta(last.y, rect.top, rect.bottom) * frames,
      );
      if (delta !== 0) {
        scroller.scrollTop += delta;
        emitMove();
      }
      frame = win.requestAnimationFrame(scroll);
    };
    const up = () => {
      this.runner.emit({ type: "drag.drop" });
      stop();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      this.runner.emit({ type: "drag.cancel" });
      stop();
    };
    const stop = () => {
      win.cancelAnimationFrame(frame);
      doc.removeEventListener("mousemove", move);
      doc.removeEventListener("mouseup", up);
      doc.removeEventListener("keydown", key, true);
      this.cleanupDrag = null;
    };
    doc.addEventListener("mousemove", move);
    doc.addEventListener("mouseup", up);
    doc.addEventListener("keydown", key, true);
    frame = win.requestAnimationFrame(scroll);
    this.cleanupDrag = stop;
  }

  /**
   * Where the gaps are on screen, and how far one list level is indented. Only
   * the gaps near the pointer are measured (a long page has thousands, and this
   * runs on every pointer move), plus the two around the block being dragged:
   * when the pointer is inside it, those are where it can still go.
   */
  private measure(
    pointerY: number,
    moving: Block,
  ): { boundaries: Boundary[]; indentPx: number } {
    const view = this.view;
    const { doc } = view.state;
    const blocks = view.state.field(blocksField);
    const centre = doc.lineAt(
      view.lineBlockAtHeight(pointerY - view.documentTop).from,
    ).number;
    const near = (line: number) => Math.abs(line - centre) <= NEARBY_LINES;
    const lines = new Set<number>([moving.startLine, moving.endLine + 1]);
    for (const b of blocks) {
      if (near(b.startLine)) lines.add(b.startLine);
      if (near(b.endLine + 1)) lines.add(b.endLine + 1);
    }
    const boundaries: Boundary[] = [];
    for (const insertAt of lines) {
      const y =
        insertAt <= doc.lines
          ? view.lineBlockAt(doc.line(insertAt).from).top
          : view.lineBlockAt(doc.length).bottom;
      boundaries.push({ insertAt, y: view.documentTop + y });
    }
    return { boundaries, indentPx: this.indentPx(blocks) };
  }

  private indentPx(blocks: readonly Block[]): number {
    const view = this.view;
    const textLeft = (b: Block) =>
      view.coordsAtPos(
        b.from +
          (/^\s*/.exec(view.state.doc.lineAt(b.from).text)?.[0].length ?? 0),
      )?.left;
    const top = blocks.find((b) => b.kind === "list-item" && b.depth === 0);
    const child = blocks.find((b) => b.kind === "list-item" && b.depth === 1);
    const a = top && textLeft(top);
    const c = child && textLeft(child);
    if (a !== undefined && c !== undefined && c - a > 4) return c - a;
    return view.defaultCharacterWidth * 2;
  }

  private scheduleRepaint(): void {
    if (this.pendingRepaint) return;
    this.pendingRepaint = true;
    // Never inside an update: a state change can arrive from one.
    queueMicrotask(() => {
      this.pendingRepaint = false;
      this.view.dispatch({ effects: repaint.of(null) });
      // Measuring the layout is only allowed outside an update.
      this.paintDropLine();
    });
  }

  update(update: ViewUpdate): void {
    if (update.docChanged) this.runner.emit({ type: "doc.changed" });
    const folds = update.transactions.some((tr) =>
      tr.effects.some(
        (e) => e.is(foldEffect) || e.is(unfoldEffect) || e.is(repaint),
      ),
    );
    const blocksChanged =
      update.state.field(blocksField) !== update.startState.field(blocksField);
    if (update.docChanged || update.viewportChanged || folds || blocksChanged) {
      this.decorations = this.build();
    }
  }

  private build(): DecorationSet {
    const view = this.view;
    const state = view.state;
    const blocks = state.field(blocksField);
    const ui: BlockState = this.runner.getState();
    const classes = new Map<number, string[]>();
    const add = (lineFrom: number, cls: string) => {
      const list = classes.get(lineFrom);
      if (list) list.push(cls);
      else classes.set(lineFrom, [cls]);
    };
    // Only what is on screen: a long page has thousands of blocks.
    const seen = new Set<Block>();
    for (const range of view.visibleRanges) {
      for (const b of blocksIn(blocks, range.from, range.to)) seen.add(b);
    }
    if (ui.kind === "dragging") {
      const source = blocks.find((b) => b.startLine === ui.line);
      if (source) seen.add(source);
    }
    for (const b of seen) {
      add(b.from, "sb-block-start");
      if (ui.kind === "hover" && ui.line === b.startLine) {
        add(b.from, "sb-block-hover");
      }
      const first = state.doc.line(b.startLine);
      const range = foldable(state, first.from, first.to);
      if (range) {
        add(b.from, "sb-block-foldable");
        foldedRanges(state).between(range.from, range.to, (from, to) => {
          if (from === range.from && to === range.to) {
            add(b.from, "sb-block-folded");
          }
        });
      }
      if (ui.kind === "dragging" && ui.line === b.startLine) {
        // The block being dragged, as far as it is on screen.
        for (const r of view.visibleRanges) {
          const lo = Math.max(b.startLine, state.doc.lineAt(r.from).number);
          const hi = Math.min(b.endLine, state.doc.lineAt(r.to).number);
          for (let n = lo; n <= hi; n++) {
            add(state.doc.line(n).from, "sb-block-dragging");
          }
        }
      }
    }
    const builder = new RangeSetBuilder<Decoration>();
    for (const from of [...classes.keys()].sort((a, b) => a - b)) {
      builder.add(
        from,
        from,
        Decoration.line({ class: classes.get(from)!.join(" ") }),
      );
    }
    return builder.finish();
  }

  /** The line that shows where the dragged block would land. */
  private paintDropLine(): void {
    const ui = this.runner.getState();
    if (ui.kind !== "dragging" || !ui.target) {
      this.dropLine?.remove();
      this.dropLine = null;
      return;
    }
    const doc = this.view.dom.ownerDocument;
    if (!this.dropLine) {
      this.dropLine = doc.createElement("div");
      this.dropLine.className = "sb-block-drop-line";
      doc.body.append(this.dropLine);
    }
    const line = this.view.contentDOM.querySelector(".cm-line");
    const rect = line?.getBoundingClientRect();
    if (!rect) return;
    const indent = this.indentPx(this.view.state.field(blocksField));
    const left = rect.left + ui.target.depth * indent;
    Object.assign(this.dropLine.style, {
      top: `${ui.target.y}px`,
      left: `${left}px`,
      width: `${Math.max(0, rect.right - left)}px`,
    });
  }

  destroy(): void {
    this.cleanupDrag?.();
    this.dropLine?.remove();
  }
}

/**
 * Drag handles, fold toggles and block reordering for the page editor.
 * `flash` shows the user a message (a refused move).
 */
export function blockEditor(flash: (message: string) => void): Extension {
  const plugin = ViewPlugin.define(
    (view) => new BlockEditorPlugin(view, flash),
    {
      decorations: (p) => p.decorations,
      eventHandlers: {
        mousedown(this: BlockEditorPlugin, event: MouseEvent) {
          return this.onMouseDown(event);
        },
        mousemove(this: BlockEditorPlugin, event: MouseEvent) {
          this.onMouseMove(event);
        },
        mouseleave(this: BlockEditorPlugin) {
          this.onMouseLeave();
        },
      },
    },
  );
  return [blocksField, plugin];
}
