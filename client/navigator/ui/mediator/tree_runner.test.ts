import { describe, expect, it } from "vitest";
import type { MovePlan } from "../../../../plug-api/ui/tree_model.ts";
import type { ReorderPlan } from "./reorder.ts";
import { createTreeRunner, UNDO_WINDOW_MS } from "./tree_runner.ts";

function setup(
  plan: (path: string, folder: string) => MovePlan,
  planReorder: () => ReorderPlan = () => ({
    ok: true,
    changes: [],
    order: [],
  }),
) {
  const log: string[] = [];
  const timers: { fn: () => void; ms: number; cleared: boolean }[] = [];
  const failNext: { error?: Error; after?: number } = {};
  const runner = createTreeRunner({
    separator: "/",
    plan,
    async move(obj, newName) {
      if (failNext.error) throw failNext.error;
      log.push(
        `move ${obj.name} -> ${newName}${obj.isFolder ? " (folder)" : ""}`,
      );
    },
    flash: (m, level) => void log.push(`flash[${level}] ${m}`),
    openMovePicker: (p) => void log.push(`picker ${p}`),
    async setPinned(p, pinned) {
      if (failNext.error) throw failNext.error;
      log.push(`pin ${p} ${pinned}`);
    },
    planReorder: async () => planReorder(),
    async setPriority(p, priority) {
      if (failNext.error && failNext.after === 0) {
        const error = failNext.error;
        failNext.error = undefined; // the rollback's own writes must succeed
        throw error;
      }
      if (failNext.after !== undefined) failNext.after--;
      log.push(`priority ${p} ${priority}`);
    },
    offerUndo: (a) =>
      void log.push(
        a.kind === "move"
          ? `offerUndo ${a.from} -> ${a.to}`
          : `offerUndo reorder x${a.restore.length}`,
      ),
    afterMove: (f) => void log.push(`afterMove "${f}"`),
    setTimer(fn, ms) {
      const t = { fn, ms, cleared: false };
      timers.push(t);
      return t;
    },
    clearTimer(h) {
      (h as { cleared: boolean }).cleared = true;
    },
  });
  return { runner, log, timers, failNext };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

const okPlan = (path: string, folder: string): MovePlan => ({
  kind: "move",
  obj: { name: path, isFolder: path === "Dir" },
  newName:
    folder === ""
      ? path.split("/").pop()!
      : `${folder}/${path.split("/").pop()}`,
});

describe("tree runner", () => {
  it("moves, announces the undo and reveals the target", async () => {
    const { runner, log } = setup(okPlan);
    runner.emit({ type: "drag.start", path: "A" });
    runner.emit({ type: "drag.drop", folder: "C" });
    await settle();
    expect(log).toEqual([
      "move A -> C/A",
      "offerUndo C/A -> A",
      'afterMove "C"',
    ]);
    expect(runner.getState()).toEqual({
      kind: "idle",
      undo: { kind: "move", from: "C/A", to: "A" },
    });
  });

  it("undo renames back as the same kind of thing", async () => {
    const { runner, log } = setup(okPlan);
    runner.emit({ type: "drag.start", path: "Dir" });
    runner.emit({ type: "drag.drop", folder: "C" });
    await settle();
    log.length = 0;
    runner.emit({ type: "move.undo" });
    await settle();
    expect(log).toContain("move C/Dir -> Dir (folder)");
    expect(log).toContain('afterMove ""');
    expect(runner.getState()).toEqual({ kind: "idle" });
  });

  it("reports a collision and changes nothing", async () => {
    const { runner, log } = setup(() => ({
      kind: "collision",
      newName: "C/A",
    }));
    runner.emit({ type: "drag.start", path: "A" });
    runner.emit({ type: "drag.drop", folder: "C" });
    await settle();
    expect(log).toEqual([
      "flash[error] C/A already exists. Rename one of them first.",
    ]);
    expect(runner.getState()).toEqual({ kind: "idle" });
  });

  it("is silent when the drop is a no-op", async () => {
    const { runner, log } = setup(() => ({ kind: "none" }));
    runner.emit({ type: "drag.start", path: "A" });
    runner.emit({ type: "drag.drop", folder: "A" });
    await settle();
    expect(log).toEqual([]);
    expect(runner.getState()).toEqual({ kind: "idle" });
  });

  it("reports a failed rename and returns to idle", async () => {
    const { runner, log, failNext } = setup(okPlan);
    failNext.error = new Error("disk full");
    runner.emit({ type: "drag.start", path: "A" });
    runner.emit({ type: "drag.drop", folder: "C" });
    await settle();
    expect(log).toEqual(["flash[error] Could not move it. disk full"]);
    expect(runner.getState()).toEqual({ kind: "idle" });
  });

  it("refuses a second drop while the first is running", async () => {
    const { runner, log } = setup(okPlan);
    runner.emit({ type: "drag.start", path: "A" });
    runner.emit({ type: "drag.drop", folder: "C" });
    runner.emit({ type: "drag.start", path: "B" });
    runner.emit({ type: "drag.drop", folder: "D" });
    await settle();
    expect(log.filter((l) => l.startsWith("move "))).toEqual(["move A -> C/A"]);
  });

  it("expires the undo after the window, and a newer move restarts it", async () => {
    const { runner, timers } = setup(okPlan);
    runner.emit({ type: "drag.start", path: "A" });
    runner.emit({ type: "drag.drop", folder: "C" });
    await settle();
    expect(timers[0].ms).toBe(UNDO_WINDOW_MS);
    runner.emit({ type: "drag.start", path: "B" });
    runner.emit({ type: "drag.drop", folder: "D" });
    await settle();
    expect(timers[0].cleared).toBe(true);
    timers[1].fn();
    expect(runner.getState()).toEqual({ kind: "idle" });
  });

  it("opens the picker and pins", async () => {
    const { runner, log } = setup(okPlan);
    runner.emit({ type: "move.pick", path: "A" });
    runner.emit({ type: "move.cancel" });
    runner.emit({ type: "pin.request", path: "A", pinned: true });
    await settle();
    expect(log).toEqual(["picker A", "pin A true"]);
  });

  it("flashes when pinning fails", async () => {
    const { runner, log, failNext } = setup(okPlan);
    failNext.error = new Error("read-only");
    runner.emit({ type: "pin.request", path: "A", pinned: true });
    await settle();
    expect(log).toEqual(["flash[error] Could not pin it. read-only"]);
  });
});

describe("reorder", () => {
  const plan = (): ReorderPlan => ({
    ok: true,
    order: ["A", "B"],
    changes: [
      { path: "A", from: 0, to: 2 },
      { path: "B", from: 1, to: 3 },
    ],
  });

  it("writes every priority, offers the undo and refreshes", async () => {
    const { runner, log } = setup(okPlan, plan);
    runner.emit({
      type: "reorder.drop",
      path: "Dir/A",
      placement: { before: "Dir/B" },
    });
    await settle();
    expect(log).toEqual([
      "priority A 2",
      "priority B 3",
      "offerUndo reorder x2",
      'afterMove "Dir"',
    ]);
    expect(runner.getState().kind).toBe("idle");
  });

  it("undo writes the old priorities back", async () => {
    const { runner, log } = setup(okPlan, plan);
    runner.emit({ type: "reorder.drop", path: "A", placement: { after: "B" } });
    await settle();
    log.length = 0;
    runner.emit({ type: "move.undo" });
    await settle();
    expect(log.slice(0, 2)).toEqual(["priority A 0", "priority B 1"]);
    expect(log).toContain("flash[info] Order restored.");
  });

  it("a failure part-way puts back what was already written", async () => {
    const { runner, log, failNext } = setup(okPlan, plan);
    failNext.error = new Error("disk full");
    failNext.after = 1; // the first write lands, the second fails
    runner.emit({ type: "reorder.drop", path: "A", placement: { after: "B" } });
    await settle();
    // The write that landed is put back; the one that failed never was.
    expect(log).toContain("priority A 2");
    expect(log).toContain("priority A 0");
    expect(log.at(-1)).toBe("flash[error] Could not move it. disk full");
    expect(runner.getState()).toEqual({ kind: "idle" });
  });

  it("a refused plan says why and changes nothing", async () => {
    const { runner, log } = setup(okPlan, () => ({
      ok: false,
      reason: "no-room",
    }));
    runner.emit({ type: "reorder.drop", path: "A", placement: { after: "B" } });
    await settle();
    expect(log).toEqual([
      "flash[error] There is no room to put it there. A folder without a page is in the way.",
    ]);
    expect(runner.getState()).toEqual({ kind: "idle" });
  });

  it("a plan with no changes is silent", async () => {
    const { runner, log } = setup(okPlan);
    runner.emit({ type: "reorder.drop", path: "A", placement: { after: "B" } });
    await settle();
    expect(log).toEqual([]);
    expect(runner.getState()).toEqual({ kind: "idle" });
  });
});

describe("an effect that throws", () => {
  it("does not leave the machine stuck: the move fails, the user is told, the next one works", async () => {
    let fail = true;
    const { runner, log } = setup(okPlan, () => {
      if (fail) throw new Error("config unavailable");
      return { ok: true, changes: [], order: [] };
    });
    runner.emit({
      type: "reorder.drop",
      path: "A",
      placement: { before: "B" },
    });
    await settle();
    expect(log).toEqual(["flash[error] Could not move it. config unavailable"]);
    expect(runner.getState()).toEqual({ kind: "idle" });
    fail = false;
    runner.emit({ type: "drag.start", path: "A" });
    runner.emit({ type: "drag.drop", folder: "C" });
    await settle();
    expect(log.some((l) => l.startsWith("move A"))).toBe(true);
  });
});

describe("menus and new pages", () => {
  function menuSetup() {
    const log: string[] = [];
    const runner = createTreeRunner({
      separator: "/",
      plan: () => ({ kind: "none" }),
      async move() {},
      flash: (m, level) => void log.push(`flash[${level}] ${m}`),
      planReorder: async () => ({ ok: true, changes: [], order: [] }),
      async setPriority() {},
      offerUndo() {},
      afterMove() {},
      showMenu: (menu) =>
        void log.push(`menu ${menu ? JSON.stringify(menu) : "hidden"}`),
      runMenuItem: async (menu, item) => {
        if (item === "boom") throw new Error("it broke");
        log.push(`run ${menu.kind} ${item}`);
      },
      newPage: (folder) => void log.push(`newPage ${folder}`),
      setTimer: () => 0,
      clearTimer() {},
    });
    const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
    return { runner, log, settle };
  }

  it("draws the menu, and hides it when an item is picked before running it", async () => {
    const { runner, log, settle } = menuSetup();
    runner.emit({ type: "menu.open", menu: { kind: "new" } });
    runner.emit({ type: "menu.pick", item: "page" });
    await settle();
    expect(log).toEqual(['menu {"kind":"new"}', "menu hidden", "run new page"]);
  });

  it("a menu item that throws is a notice, not a stuck machine", async () => {
    const { runner, log, settle } = menuSetup();
    runner.emit({ type: "menu.open", menu: { kind: "row", target: "A" } });
    runner.emit({ type: "menu.pick", item: "boom" });
    await settle();
    expect(log.at(-1)).toBe("flash[error] it broke");
    runner.emit({ type: "menu.open", menu: { kind: "new" } });
    await settle();
    expect(runner.getState().kind).toBe("idle");
    expect(log.at(-1)).toBe('menu {"kind":"new"}');
  });

  it("asks for a page in the folder it was given", async () => {
    const { runner, log, settle } = menuSetup();
    runner.emit({ type: "page.new", folder: "Projects" });
    await settle();
    expect(log).toEqual(["newPage Projects"]);
  });
});
