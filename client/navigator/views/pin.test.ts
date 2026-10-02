import { expect, test } from "vitest";
import { isPinned, priorityPatch } from "./pin.ts";

test("a priority on a page with no decoration creates one", () => {
  expect(priorityPatch(undefined, 3)).toEqual({
    op: "set-key",
    path: "pageDecoration",
    value: { tree: { priority: 3 } },
  });
});

test("a priority keeps every other decoration", () => {
  expect(
    priorityPatch(
      { icon: "gift", cssClasses: ["x"], tree: { hide: false } },
      2,
    ),
  ).toEqual({
    op: "set-key",
    path: "pageDecoration",
    value: {
      icon: "gift",
      cssClasses: ["x"],
      tree: { hide: false, priority: 2 },
    },
  });
});

test("negative priorities are kept: they sort below the default", () => {
  expect(priorityPatch(undefined, -1)).toEqual({
    op: "set-key",
    path: "pageDecoration",
    value: { tree: { priority: -1 } },
  });
});

test("0 is the default: it drops only the priority", () => {
  expect(
    priorityPatch({ icon: "gift", tree: { priority: 4, hide: true } }, 0),
  ).toEqual({
    op: "set-key",
    path: "pageDecoration",
    value: { icon: "gift", tree: { hide: true } },
  });
});

test("0 on a page that had nothing else removes the key", () => {
  expect(priorityPatch({ tree: { priority: 4 } }, 0)).toEqual({
    op: "delete-key",
    path: "pageDecoration",
  });
  expect(priorityPatch(undefined, 0)).toEqual({
    op: "delete-key",
    path: "pageDecoration",
  });
});

test("does not mutate the decoration it was given", () => {
  const decoration = { tree: { priority: 4 } };
  priorityPatch(decoration, 0);
  expect(decoration).toEqual({ tree: { priority: 4 } });
});

test("only a priority above the default counts as pinned", () => {
  expect(isPinned({ tree: { priority: 1 } })).toBe(true);
  expect(isPinned({ tree: { priority: 100 } })).toBe(true);
  expect(isPinned({ tree: { priority: 0 } })).toBe(false);
  expect(isPinned({ tree: { priority: -1 } })).toBe(false);
  expect(isPinned(undefined)).toBe(false);
});
