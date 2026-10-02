/**
 * Manual ordering of tree siblings, expressed in the only vocabulary the tree
 * has: `pageDecoration.tree.priority`. Siblings sort by priority, highest
 * first, and ties fall back to the name. So putting a page between two others
 * means finding the fewest priorities to write that make the whole level sort
 * the way the user dropped it.
 *
 * Pure: it plans, it writes nothing.
 */

export type Sibling = {
  path: string;
  /** 0 when the page carries none. */
  priority: number;
  /** Whether this sibling can carry a priority of its own. A folder with no
   * page behind it, or a document, has no frontmatter: it sits at 0 for good. */
  movable: boolean;
};

export type Placement = { before: string } | { after: string };

export type PriorityChange = { path: string; from: number; to: number };

export type ReorderPlan =
  | { ok: true; changes: PriorityChange[]; order: string[] }
  | { ok: false; reason: "not-movable" | "no-room" | "unknown-target" };

type Compare = (a: string, b: string) => number;

/**
 * `siblings` is the level as it is displayed now. The page `moving` is taken
 * out and put at `placement`; `compare` is the order names fall back to (the
 * space tree's collation).
 */
export function planReorder(
  siblings: Sibling[],
  moving: string,
  placement: Placement,
  compare: Compare,
): ReorderPlan {
  const mover = siblings.find((s) => s.path === moving);
  if (!mover) return { ok: false, reason: "unknown-target" };
  const rest = siblings.filter((s) => s.path !== moving);
  const anchorPath = "before" in placement ? placement.before : placement.after;
  const anchor = rest.findIndex((s) => s.path === anchorPath);
  if (anchor === -1) return { ok: false, reason: "unknown-target" };
  const index = "before" in placement ? anchor : anchor + 1;
  const desired = [...rest.slice(0, index), mover, ...rest.slice(index)];
  const order = desired.map((s) => s.path);

  if (order.every((path, i) => path === siblings[i].path)) {
    return { ok: true, changes: [], order };
  }
  if (!mover.movable) return { ok: false, reason: "not-movable" };

  const raised = raise(desired, index, compare);
  const lowered = lower(desired, index, compare);
  const candidates = [raised, lowered].filter(
    (c): c is PriorityChange[] => c !== undefined,
  );
  if (candidates.length === 0) return { ok: false, reason: "no-room" };
  const changes = candidates.reduce((best, c) =>
    c.length < best.length ? c : best,
  );
  return { ok: true, changes, order };
}

/** Whether `a` sorting above `b` needs a strictly higher priority. */
function need(
  a: Sibling,
  b: Sibling,
  priorityOfB: number,
  compare: Compare,
): number {
  return compare(a.path, b.path) < 0 ? priorityOfB : priorityOfB + 1;
}

/** Raise only: the mover takes the lowest priority its lower neighbour allows,
 * and whatever sits above it is lifted just far enough to stay above it. */
function raise(
  desired: Sibling[],
  index: number,
  compare: Compare,
): PriorityChange[] | undefined {
  const mover = desired[index];
  const next = desired[index + 1];
  const prev = desired[index - 1];
  const final = new Map<string, number>();
  if (next) {
    final.set(mover.path, need(mover, next, next.priority, compare));
  } else if (prev) {
    // Last of the level: nothing below to be above, so stay under the one above.
    final.set(
      mover.path,
      compare(prev.path, mover.path) < 0 ? prev.priority : prev.priority - 1,
    );
  }
  for (let i = index - 1; i >= 0; i--) {
    const above = desired[i];
    const below = desired[i + 1];
    const floor = need(above, below, final.get(below.path)!, compare);
    if (above.priority >= floor) break; // everything higher is already fine
    if (!above.movable) return undefined;
    final.set(above.path, floor);
  }
  return changesOf(desired, final);
}

/** Lower only: the mover takes the highest priority its upper neighbour
 * allows, and whatever sits below it is pushed just far enough down. */
function lower(
  desired: Sibling[],
  index: number,
  compare: Compare,
): PriorityChange[] | undefined {
  const mover = desired[index];
  const next = desired[index + 1];
  const prev = desired[index - 1];
  const final = new Map<string, number>();
  if (prev) {
    final.set(
      mover.path,
      compare(prev.path, mover.path) < 0 ? prev.priority : prev.priority - 1,
    );
  } else if (next) {
    final.set(mover.path, need(mover, next, next.priority, compare));
  }
  for (let i = index + 1; i < desired.length; i++) {
    const above = desired[i - 1];
    const below = desired[i];
    const aboveP = final.get(above.path) ?? above.priority;
    const ceiling = compare(above.path, below.path) < 0 ? aboveP : aboveP - 1;
    if (below.priority <= ceiling) break; // everything lower is already fine
    if (!below.movable) return undefined;
    final.set(below.path, ceiling);
  }
  return changesOf(desired, final);
}

function changesOf(
  desired: Sibling[],
  final: Map<string, number>,
): PriorityChange[] {
  const out: PriorityChange[] = [];
  for (const s of desired) {
    const to = final.get(s.path);
    if (to !== undefined && to !== s.priority) {
      out.push({ path: s.path, from: s.priority, to });
    }
  }
  return out;
}
