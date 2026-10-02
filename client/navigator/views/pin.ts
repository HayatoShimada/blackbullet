import type { YamlPatch } from "../../../plug-api/lib/yaml.ts";
import { space, system } from "@silverbulletmd/silverbullet/syscalls";

type Decoration = Record<string, any>;

/** A page counts as pinned once something has lifted it above the default of 0
 * -- pinning, or a manual reorder that had to. */
export function isPinned(decoration: Decoration | undefined): boolean {
  const priority = decoration?.tree?.priority;
  return typeof priority === "number" && priority > 0;
}

/**
 * The frontmatter patch that gives a page `pageDecoration.tree.priority`. The
 * YAML patcher only addresses top-level keys, so the whole `pageDecoration` is
 * rewritten: every other decoration the page carries (`icon`, `cssClasses`,
 * ...) is kept. A priority of 0 is the default and is not written, so a page
 * left with nothing loses the key entirely.
 */
export function priorityPatch(
  decoration: Decoration | undefined,
  priority: number,
): YamlPatch {
  const next: Decoration = { ...(decoration ?? {}) };
  const tree: Decoration = { ...(next.tree ?? {}) };
  if (priority === 0) {
    delete tree.priority;
  } else {
    tree.priority = priority;
  }
  if (Object.keys(tree).length > 0) {
    next.tree = tree;
  } else {
    delete next.tree;
  }
  if (Object.keys(next).length === 0) {
    return { op: "delete-key", path: "pageDecoration" };
  }
  return { op: "set-key", path: "pageDecoration", value: next };
}

export async function setPagePriority(
  name: string,
  priority: number,
): Promise<void> {
  const text = await space.readPage(name);
  const { frontmatter } = await system.invokeFunction(
    "index.extractFrontmatter",
    text,
  );
  const patched: string = await system.invokeFunction(
    "index.patchFrontmatter",
    text,
    [priorityPatch(frontmatter?.pageDecoration, priority)],
  );
  if (patched !== text) await space.writePage(name, patched);
}
