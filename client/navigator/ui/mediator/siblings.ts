import { findNode, type TreeNode } from "../../../../plug-api/ui/tree_model.ts";
import type { Sibling } from "./reorder.ts";

export function parentPath(path: string, separator: string): string {
  const idx = path.lastIndexOf(separator);
  return idx === -1 ? "" : path.slice(0, idx);
}

/** The priority the tree sorts a node by: its own row's, else the default. */
export function priorityOf(node: TreeNode): number {
  const priority = node.row?.priority;
  return typeof priority === "number" && Number.isFinite(priority)
    ? priority
    : 0;
}

/**
 * The level `path` sits in, in the order the tree shows it, as the reorder
 * planner wants it. Only a writable page can carry a priority: a folder with
 * no page, a document and a read-only page stay where they are.
 */
export function siblingsOf(
  tree: TreeNode,
  path: string,
  separator: string,
): Sibling[] | undefined {
  const parent = findNode(tree, parentPath(path, separator));
  if (!parent?.children.some((c) => c.path === path)) {
    return undefined;
  }
  return parent.children.map((node) => {
    const obj = node.row?.obj;
    return {
      path: node.path,
      priority: priorityOf(node),
      movable: obj?.tag === "page" && obj?.ref != null && obj?.perm !== "ro",
    };
  });
}

/** One above everything else on the level: what "pin" means. */
export function topPriority(siblings: Sibling[], except: string): number {
  return (
    Math.max(
      0,
      ...siblings.filter((s) => s.path !== except).map((s) => s.priority),
    ) + 1
  );
}
