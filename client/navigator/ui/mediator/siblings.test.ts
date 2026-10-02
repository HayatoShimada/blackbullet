import { expect, test } from "vitest";
import { buildTree } from "../../../../plug-api/ui/tree_model.ts";
import { siblingsOf, topPriority } from "./siblings.ts";

const row = (
  name: string,
  extra: Record<string, any> = {},
  priority?: number,
) => ({
  obj: { name, tag: "page", ref: name, ...extra },
  primary: name,
  priority,
});

const tree = buildTree(
  [
    row("Projects/Plan", {}, 5),
    row("Projects/Notes"),
    row("Projects/Locked", { perm: "ro" }),
    { obj: { name: "Projects/logo.png", tag: "document" }, primary: "x" },
    row("Projects/Sub/Deep"),
    row("Inbox"),
  ],
  "/",
  false,
);

test("lists the level in display order, flagging what can carry a priority", () => {
  expect(siblingsOf(tree, "Projects/Notes", "/")).toEqual([
    { path: "Projects/Plan", priority: 5, movable: true },
    { path: "Projects/Notes", priority: 0, movable: true },
    { path: "Projects/Locked", priority: 0, movable: false },
    { path: "Projects/logo.png", priority: 0, movable: false },
    { path: "Projects/Sub", priority: 0, movable: false },
  ]);
});

test("a root-level page is looked up among the root's children", () => {
  expect(siblingsOf(tree, "Inbox", "/")?.map((s) => s.path)).toEqual([
    "Projects",
    "Inbox",
  ]);
});

test("an unknown path has no level", () => {
  expect(siblingsOf(tree, "Nope/Page", "/")).toBeUndefined();
  expect(siblingsOf(tree, "Projects/Nope", "/")).toBeUndefined();
});

test("pin goes one above the highest sibling, never below the default", () => {
  const siblings = siblingsOf(tree, "Projects/Notes", "/")!;
  expect(topPriority(siblings, "Projects/Notes")).toBe(6);
  expect(topPriority([{ path: "a", priority: -3, movable: true }], "b")).toBe(
    1,
  );
  // The page's own priority is not counted against itself.
  expect(topPriority(siblings, "Projects/Plan")).toBe(1);
});
