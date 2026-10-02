import { describe, expect, test } from "vitest";
import {
  planReorder,
  type Placement,
  type ReorderPlan,
  type Sibling,
} from "./reorder.ts";

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

const level = (spec: [string, number?, boolean?][]): Sibling[] =>
  spec.map(([path, priority = 0, movable = true]) => ({
    path,
    priority,
    movable,
  }));

/** How the tree sorts a level: priority high to low, then by name. */
function sorted(siblings: Sibling[]): string[] {
  return [...siblings]
    .sort((a, b) => b.priority - a.priority || compare(a.path, b.path))
    .map((s) => s.path);
}

function apply(siblings: Sibling[], plan: ReorderPlan): Sibling[] {
  if (!plan.ok) throw new Error("no plan");
  return siblings.map((s) => {
    const change = plan.changes.find((c) => c.path === s.path);
    return change ? { ...s, priority: change.to } : s;
  });
}

describe("planReorder", () => {
  test("an all-default level: lifts everything above the drop point", () => {
    const siblings = level([["a"], ["b"], ["c"], ["d"]]);
    const plan = planReorder(siblings, "d", { before: "b" }, compare);
    expect(plan.ok && plan.order).toEqual(["a", "d", "b", "c"]);
    expect(sorted(apply(siblings, plan))).toEqual(["a", "d", "b", "c"]);
    // The mover and the one above it: nothing below the drop point is touched.
    expect(plan.ok && plan.changes.map((c) => c.path).sort()).toEqual([
      "a",
      "d",
    ]);
  });

  test("to the very top takes a single write", () => {
    const siblings = level([["a"], ["b"], ["c"]]);
    const plan = planReorder(siblings, "c", { before: "a" }, compare);
    expect(plan.ok && plan.changes).toEqual([{ path: "c", from: 0, to: 1 }]);
    expect(sorted(apply(siblings, plan))).toEqual(["c", "a", "b"]);
  });

  test("to the very bottom takes a single write", () => {
    const siblings = level([["a"], ["b"], ["c"]]);
    const plan = planReorder(siblings, "a", { after: "c" }, compare);
    expect(plan.ok && plan.changes).toEqual([{ path: "a", from: 0, to: -1 }]);
    expect(sorted(apply(siblings, plan))).toEqual(["b", "c", "a"]);
  });

  test("dropping where it already is changes nothing", () => {
    const siblings = level([["a"], ["b"], ["c"]]);
    for (const placement of [{ before: "c" }, { after: "a" }] as Placement[]) {
      const plan = planReorder(siblings, "b", placement, compare);
      expect(plan.ok && plan.changes).toEqual([]);
    }
  });

  test("between two pinned pages writes only the mover", () => {
    const siblings = level([["p", 10], ["q", 5], ["a"], ["b"], ["m", 0]]);
    const plan = planReorder(siblings, "b", { after: "p" }, compare);
    expect(sorted(apply(siblings, plan))).toEqual(["p", "b", "q", "a", "m"]);
    expect(plan.ok && plan.changes.length).toBe(1);
  });

  test("a gap in the priorities is used instead of shifting others", () => {
    const siblings = level([
      ["a", 100],
      ["b", 0],
      ["c", 0],
    ]);
    const plan = planReorder(siblings, "c", { before: "b" }, compare);
    expect(sorted(apply(siblings, plan))).toEqual(["a", "c", "b"]);
    expect(plan.ok && plan.changes.length).toBe(1);
  });

  test("a folder without a page is never given a priority", () => {
    const siblings = level([["Dir", 0, false], ["a"], ["b"], ["c"]]);
    const plan = planReorder(siblings, "c", { before: "a" }, compare);
    // "Dir" sorts first by name at 0; c must stay at or below it.
    const after = apply(siblings, plan);
    expect(after.find((s) => s.path === "Dir")!.priority).toBe(0);
    expect(sorted(after)).toEqual(plan.ok ? plan.order : []);
  });

  test("moving a page that cannot carry a priority is refused", () => {
    const siblings = level([["a"], ["Dir", 0, false], ["c"]]);
    const plan = planReorder(siblings, "Dir", { after: "c" }, compare);
    expect(plan).toEqual({ ok: false, reason: "not-movable" });
  });

  test("an unknown target is refused", () => {
    const siblings = level([["a"], ["b"]]);
    expect(planReorder(siblings, "a", { before: "zzz" }, compare)).toEqual({
      ok: false,
      reason: "unknown-target",
    });
    expect(planReorder(siblings, "zzz", { before: "a" }, compare)).toEqual({
      ok: false,
      reason: "unknown-target",
    });
  });

  test("never mutates what it is given", () => {
    const siblings = level([["a"], ["b"], ["c"]]);
    const copy = JSON.stringify(siblings);
    planReorder(siblings, "c", { before: "a" }, compare);
    expect(JSON.stringify(siblings)).toBe(copy);
  });
});

describe("planReorder, against every move of every small level", () => {
  // A deterministic spread of starting states: names a..e, priorities drawn
  // from a small set (so ties and gaps both occur), some siblings immovable.
  const names = ["a", "b", "c", "d", "e"];
  const priorities = [-1, 0, 0, 1, 5];

  function* levels(): Generator<Sibling[]> {
    for (let seed = 0; seed < 300; seed++) {
      let s = seed;
      const siblings: Sibling[] = names.map((path, i) => {
        const priority = priorities[(s = (s * 31 + i * 7 + 3) % 997) % 5];
        const movable = (s >> 3) % 4 !== 0;
        return { path, priority: movable ? priority : 0, movable };
      });
      // Start from the order the tree would actually show.
      const order = sorted(siblings);
      yield order.map((p) => siblings.find((x) => x.path === p)!);
    }
  }

  test("an ok plan always sorts into the requested order, and touches only movable pages", () => {
    let planned = 0;
    for (const siblings of levels()) {
      for (const moving of siblings.map((s) => s.path)) {
        for (const anchor of siblings.map((s) => s.path)) {
          if (anchor === moving) continue;
          for (const placement of [{ before: anchor }, { after: anchor }]) {
            const plan = planReorder(siblings, moving, placement, compare);
            if (!plan.ok) continue;
            planned++;
            expect(sorted(apply(siblings, plan))).toEqual(plan.order);
            for (const change of plan.changes) {
              expect(
                siblings.find((s) => s.path === change.path)!.movable,
              ).toBe(true);
              expect(change.to).not.toBe(change.from);
            }
          }
        }
      }
    }
    expect(planned).toBeGreaterThan(1000);
  });

  test("a movable mover is only refused when an immovable sibling is in the way", () => {
    for (const siblings of levels()) {
      const everyoneMovable = siblings.map((s) => ({ ...s, movable: true }));
      for (const moving of everyoneMovable.map((s) => s.path)) {
        for (const anchor of everyoneMovable.map((s) => s.path)) {
          if (anchor === moving) continue;
          const plan = planReorder(
            everyoneMovable,
            moving,
            { before: anchor },
            compare,
          );
          expect(plan.ok).toBe(true);
        }
      }
    }
  });
});
