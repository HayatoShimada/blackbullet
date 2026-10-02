import { expect, test } from "vitest";
import { buildTree } from "../../../../plug-api/ui/tree_model.ts";
import { moveTargets } from "./move_targets.ts";

const tree = buildTree(
  ["Projects/Plan", "Projects/Archive/Old", "Journal/Today", "Inbox"].map(
    (name) => ({ obj: { name }, primary: name }),
  ),
  "/",
  false,
);
const names = (path: string) =>
  moveTargets(tree, path, "/").map((o) => o.folder);

test("offers the root and every other folder, not the page's own", () => {
  expect(names("Projects/Plan")).toEqual(["", "Journal", "Projects/Archive"]);
});

test("a root page is not offered the root", () => {
  expect(names("Inbox")).toEqual(["Journal", "Projects", "Projects/Archive"]);
});

test("a folder is not offered itself or its own subtree", () => {
  expect(names("Projects")).toEqual(["Journal"]);
  expect(names("Projects/Archive")).toEqual(["", "Journal"]);
});

test("no tree yet offers nothing but the root", () => {
  expect(moveTargets(undefined, "A/B", "/").map((o) => o.folder)).toEqual([""]);
});
