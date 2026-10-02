/**
 * Moving a block, as a pure computation on the document's lines. Nothing here
 * touches CodeMirror: it takes lines and blocks, and answers with the lines
 * the document should have afterwards.
 *
 * Blocks are separated by blank lines, and a move has to keep that true at
 * both ends: the block takes one adjacent blank line with it, and meets the
 * blank lines of wherever it lands. A list item is the exception -- items sit
 * on consecutive lines -- and it can also change depth on the way.
 */
import type { Block } from "./blocks.ts";

export type MoveRefusal = "inside-itself" | "inside-list";

export type MovePlan =
  | { kind: "none" }
  | { kind: "refused"; reason: MoveRefusal }
  | {
      kind: "move";
      newLines: string[];
      /** Where the moved block's first line ended up (1-based). */
      movedStartLine: number;
    };

/** The depths a list item may be dropped at on a given line boundary. */
export type DepthRange = { min: number; max: number };

const DEFAULT_UNIT = "  ";

function leadingWhitespace(line: string): string {
  return /^[ \t]*/.exec(line)![0];
}

function isBlank(line: string | undefined): boolean {
  return line !== undefined && line.trim() === "";
}

/**
 * The list items either side of the boundary "before line `insertAt`", with
 * the moving block taken out of the picture: dropping a block where it already
 * is must see the neighbours it would have once it had gone.
 */
function neighbours(
  blocks: readonly Block[],
  moving: Block,
  insertAt: number,
): { above: Block | undefined; below: Block | undefined } {
  const inMoving = (line: number) =>
    line >= moving.startLine && line <= moving.endLine;
  const prevLine = inMoving(insertAt - 1) ? moving.startLine - 1 : insertAt - 1;
  const nextLine = inMoving(insertAt) ? moving.endLine + 1 : insertAt;
  let above: Block | undefined;
  for (const b of blocks) {
    if (b.kind !== "list-item") continue;
    if (b.startLine <= prevLine && prevLine <= b.endLine) {
      if (!above || b.depth >= above.depth) above = b;
    }
  }
  const below = blocks.find(
    (b) => b.kind === "list-item" && b.startLine === nextLine,
  );
  return { above, below };
}

/**
 * The depths a list item can take if dropped before line `insertAt`: no
 * deeper than one below the item above (Markdown nests one level at a time),
 * and no shallower than the item below (which would make it that item's child).
 * Anything that is not directly between list items stays at the top level.
 */
export function allowedDepths(
  blocks: readonly Block[],
  moving: Block,
  insertAt: number,
): DepthRange {
  const { above, below } = neighbours(blocks, moving, insertAt);
  if (!above) return { min: 0, max: 0 };
  const max = above.depth + 1;
  return { min: Math.min(below?.depth ?? 0, max), max };
}

/** Whether a block that is not a list item may land on this boundary: not in
 * the middle of a list, where it would split it. */
function splitsAList(
  blocks: readonly Block[],
  moving: Block,
  insertAt: number,
): boolean {
  const { above, below } = neighbours(blocks, moving, insertAt);
  return above !== undefined && below !== undefined;
}

/** The whitespace a list item at `depth` is written with, learnt from the
 * nearest item at that depth above the drop point, else built from its parent. */
function indentFor(
  lines: readonly string[],
  blocks: readonly Block[],
  insertAt: number,
  depth: number,
): string {
  if (depth === 0) return "";
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i];
    if (b.kind === "list-item" && b.depth === depth && b.startLine < insertAt) {
      return leadingWhitespace(lines[b.startLine - 1]);
    }
  }
  for (const b of blocks) {
    if (b.kind === "list-item" && b.depth === 1) {
      const parent = blocks
        .filter(
          (p) =>
            p.kind === "list-item" &&
            p.depth === 0 &&
            p.startLine < b.startLine &&
            p.endLine >= b.endLine,
        )
        .at(-1);
      const unit = leadingWhitespace(lines[b.startLine - 1]).slice(
        parent ? leadingWhitespace(lines[parent.startLine - 1]).length : 0,
      );
      if (unit) return indentFor(lines, blocks, insertAt, depth - 1) + unit;
    }
  }
  return indentFor(lines, blocks, insertAt, depth - 1) + DEFAULT_UNIT;
}

/** Why a block cannot land before line `insertAt`, if it cannot. */
export function refusalFor(
  blocks: readonly Block[],
  moving: Block,
  insertAt: number,
): MoveRefusal | undefined {
  if (insertAt > moving.startLine && insertAt <= moving.endLine) {
    return "inside-itself";
  }
  if (moving.kind !== "list-item" && splitsAList(blocks, moving, insertAt)) {
    return "inside-list";
  }
  return undefined;
}

export function planBlockMove(opts: {
  lines: readonly string[];
  blocks: readonly Block[];
  moving: Block;
  /** The block goes before this line (1-based); `lines.length + 1` is the end. */
  insertAt: number;
  /** For a list item: the depth to land at. Default: where it is. */
  depth?: number;
}): MovePlan {
  const { lines, blocks, moving, insertAt } = opts;
  const isItem = moving.kind === "list-item";
  const depth = isItem ? (opts.depth ?? moving.depth) : 0;

  const refusal = refusalFor(blocks, moving, insertAt);
  if (refusal) return { kind: "refused", reason: refusal };
  const isListLine = (line: number) =>
    blocks.some(
      (b) => b.kind === "list-item" && b.startLine <= line && line <= b.endLine,
    );
  // A list item among other items is a line of its own; one that stands alone
  // is a block like any other and is separated by blank lines.
  const standsAlone =
    !isItem ||
    (!isListLine(moving.startLine - 1) && !isListLine(moving.endLine + 1));

  // The gap a block already sits in has more than one name: before its first
  // line, after its last, and either side of the blank line that separates it.
  const gaps = new Set([moving.startLine, moving.endLine + 1]);
  if (standsAlone) {
    if (isBlank(lines[moving.startLine - 2])) gaps.add(moving.startLine - 1);
    if (isBlank(lines[moving.endLine])) gaps.add(moving.endLine + 2);
  }
  if (gaps.has(insertAt) && depth === moving.depth) return { kind: "none" };

  // What leaves: the block, and for one that stands alone the blank line that
  // separates it (the one after it, else the one before).
  let from = moving.startLine;
  let to = moving.endLine;
  if (standsAlone) {
    if (isBlank(lines[to])) to++;
    else if (from > 1 && isBlank(lines[from - 2])) from--;
  }
  let moved = lines.slice(from - 1, to);
  const rest = [...lines.slice(0, from - 1), ...lines.slice(to)];

  // Where it lands in `rest`.
  let at = insertAt > to ? insertAt - (to - from + 1) : insertAt;
  at = Math.min(at, rest.length + 1);

  const around = neighbours(blocks, moving, insertAt);
  const amongItems =
    isItem && (around.above !== undefined || around.below !== undefined);
  if (isItem) {
    const target = indentFor(lines, blocks, insertAt, depth);
    const current = leadingWhitespace(lines[moving.startLine - 1]);
    moved = moved.map((line) =>
      !isBlank(line) && line.startsWith(current)
        ? target + line.slice(current.length)
        : line,
    );
  }
  if (!amongItems) {
    // A block sits between blank lines: none leading, one trailing -- unless
    // it lands at the very end of the document, where it needs none.
    while (isBlank(moved[0])) moved = moved.slice(1);
    while (isBlank(moved.at(-1))) moved = moved.slice(0, -1);
    const atEnd = at === rest.length + 1;
    if (!atEnd) moved = [...moved, ""];
    if (at > 1 && !isBlank(rest[at - 2])) moved = ["", ...moved];
    // Two blank lines in a row where it lands: keep the one it brought.
    if (!atEnd && isBlank(rest[at - 1]) && isBlank(moved.at(-1))) {
      moved = moved.slice(0, -1);
    }
  }

  const newLines = [...rest.slice(0, at - 1), ...moved, ...rest.slice(at - 1)];
  const lead = moved.findIndex((line) => !isBlank(line));
  return {
    kind: "move",
    newLines,
    movedStartLine: at + Math.max(lead, 0),
  };
}

/** The one change that turns `before` into `after`: everything between the
 * first and the last place they differ, in character offsets of `before`. A
 * single change keeps the cursor, the folds and the undo history of whatever
 * the move did not touch. */
export function minimalChange(
  before: string,
  after: string,
): { from: number; to: number; insert: string } | null {
  const shortest = Math.min(before.length, after.length);
  let from = 0;
  while (from < shortest && before[from] === after[from]) from++;
  let endBefore = before.length;
  let endAfter = after.length;
  while (
    endBefore > from &&
    endAfter > from &&
    before[endBefore - 1] === after[endAfter - 1]
  ) {
    endBefore--;
    endAfter--;
  }
  if (endBefore === from && endAfter === from) return null;
  return { from, to: endBefore, insert: after.slice(from, endAfter) };
}
