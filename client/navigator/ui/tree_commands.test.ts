import { expect, test, vi } from "vitest";
import { buildTree } from "../../../plug-api/ui/tree_model.ts";
import type { NavigatorEngine } from "./engine.ts";
import type { DerivedView } from "./hooks/use_derived.ts";
import type { ActiveView, PanelSetters, SharedRefs } from "./panel.ts";

const writes: { key: string[]; paths: string[] }[] = [];
const flashes: unknown[][] = [];
let filterBox: (...args: unknown[]) => unknown = () => undefined;
vi.mock("@silverbulletmd/silverbullet/syscalls", () => ({
  datastore: {
    set: (key: string[], paths: string[]) => {
      writes.push({ key, paths });
    },
  },
  editor: {
    flashNotification: (...args: unknown[]) => flashes.push(args),
    filterBox: (...args: unknown[]) => filterBox(...args),
  },
}));

const { createTreeCommands } = await import("./tree_commands.ts");

function setup(
  defaultExpanded: boolean,
  filtering = false,
  initialExpanded = ["Projects"],
  extraNames: string[] = [],
) {
  writes.length = 0;
  flashes.length = 0;
  const move = vi.fn(async (_view: string, _obj: unknown, _name: string) => {});
  let expanded = new Set(initialExpanded);
  let dirty = false;
  const tree = buildTree(
    [
      { obj: { name: "Projects/Plan" }, primary: "Projects/Plan" },
      {
        obj: { name: "Projects/Archive/Old" },
        primary: "Projects/Archive/Old",
      },
      { obj: { name: "Journal/Today" }, primary: "Journal/Today" },
      ...extraNames.map((name) => ({ obj: { name }, primary: name })),
    ],
    "/",
    false,
  );
  const refs = {
    input: { current: null },
    treeHost: { current: undefined },
    expandedDirty: {
      get current() {
        return dirty;
      },
      set current(value: boolean) {
        dirty = value;
      },
    },
  } as SharedRefs;
  const cmd = createTreeCommands({
    view: {
      name: "std.spaceTree",
      meta: {
        expandAll: defaultExpanded,
        expansionScope: "view",
        hierarchy: { separator: "/" },
      },
    } as ActiveView,
    engine: { move } as unknown as NavigatorEngine,
    derived: {
      treeFiltering: filtering,
      treeDisplay: { tree, visible: [], effectiveExpanded: new Set() },
    } as unknown as DerivedView,
    refs,
    set: {
      setExpanded: (update: (prev: Set<string>) => Set<string>) => {
        expanded = update(expanded);
      },
    } as PanelSetters,
    refresh: () => {},
  });
  return {
    cmd,
    refs,
    move,
    expanded: () => [...expanded].sort(),
    dirty: () => dirty,
  };
}

test("expand all opens nested folders and collapse all closes them", () => {
  const { cmd, expanded, dirty } = setup(false);

  cmd.expandAllFolders();
  expect(expanded()).toEqual(["Journal", "Projects", "Projects/Archive"]);
  expect(writes.at(-1)).toEqual({
    key: ["navigator", "std.spaceTree", "expanded"],
    paths: ["Projects", "Projects/Archive", "Journal"],
  });
  expect(dirty()).toBe(true);

  cmd.collapseAllFolders();
  expect(expanded()).toEqual([]);
  expect(writes.at(-1)?.paths).toEqual([]);
});

test("bulk actions respect views expanded by default", () => {
  const { cmd, expanded } = setup(true);

  cmd.collapseAllFolders();
  expect(expanded()).toEqual(["Journal", "Projects", "Projects/Archive"]);
  expect(writes.at(-1)?.key).toEqual([
    "navigator",
    "std.spaceTree",
    "collapsed",
  ]);

  cmd.expandAllFolders();
  expect(expanded()).toEqual([]);
  expect(writes.at(-1)?.paths).toEqual([]);
});

test("bulk expansion leaves filtered trees unchanged", () => {
  const { cmd, expanded, dirty } = setup(false, true);

  cmd.expandAllFolders();
  cmd.collapseAllFolders();

  expect(expanded()).toEqual(["Projects"]);
  expect(writes).toEqual([]);
  expect(dirty()).toBe(false);
});

test("bulk actions preserve folders outside the current segment", () => {
  const { cmd, expanded } = setup(false, false, ["Projects", "Elsewhere"]);

  cmd.expandAllFolders();
  expect(expanded()).toEqual([
    "Elsewhere",
    "Journal",
    "Projects",
    "Projects/Archive",
  ]);

  cmd.collapseAllFolders();
  expect(expanded()).toEqual(["Elsewhere"]);
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test("dropping a page on a folder renames it and opens the folder", async () => {
  const { cmd, move, expanded } = setup(false, false, []);

  cmd.moveNode("Journal/Today", "Projects/Archive");
  await settle();

  expect(move).toHaveBeenCalledTimes(1);
  expect(move.mock.calls[0][0]).toBe("std.spaceTree");
  expect(move.mock.calls[0][2]).toBe("Projects/Archive/Today");
  expect(expanded()).toEqual(["Projects/Archive"]);
  expect(String(flashes.at(-1)?.[0])).toContain("Tree: Undo Move");
});

test("a drop onto an existing name changes nothing and says so", async () => {
  const { cmd, move } = setup(false, false, [], ["Projects/Today"]);

  cmd.moveNode("Journal/Today", "Projects");
  await settle();

  expect(move).not.toHaveBeenCalled();
  expect(flashes.at(-1)).toEqual(["Projects/Today already exists", "error"]);
});

test("a drop that moves nothing is silent", async () => {
  const { cmd, move } = setup(false, false, []);

  cmd.moveNode("Journal/Today", "Journal");
  await settle();

  expect(move).not.toHaveBeenCalled();
  expect(flashes).toEqual([]);
});

test("a failed rename is reported and nothing is offered for undo", async () => {
  const { cmd, move } = setup(false, false, []);
  move.mockRejectedValueOnce(new Error("disk full"));

  cmd.moveNode("Journal/Today", "Projects");
  await settle();

  expect(flashes.at(-1)).toEqual(["Move failed: disk full", "error"]);
});

test("a Move to… picker that fails is a dismissed picker: the next move still works", async () => {
  const { cmd, refs, move } = setup(false, false, []);
  filterBox = () => Promise.reject(new Error("modal host gone"));
  refs.treeHost.current!.runner.emit({
    type: "move.pick",
    path: "Journal/Today",
  });
  await settle();
  expect(refs.treeHost.current!.runner.getState()).toEqual({ kind: "idle" });

  filterBox = () => undefined;
  cmd.moveNode("Journal/Today", "Projects");
  await settle();
  expect(move).toHaveBeenCalledTimes(1);
});
