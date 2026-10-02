import {
  allFolderPaths,
  type TreeNode,
} from "../../../../plug-api/ui/tree_model.ts";
import type { FilterOption } from "../../../../plug-api/types/client.ts";

/**
 * The folders a page can be moved into, as filter-box options: the space root
 * first, then every folder -- minus the page's own folder and, for a folder,
 * its subtree (the rename would chase itself; `planMove` refuses it too, but
 * offering it only to refuse it is worse).
 */
export function moveTargets(
  root: TreeNode | undefined,
  path: string,
  separator: string,
): (FilterOption & { folder: string })[] {
  const own = parentOf(path, separator);
  const out: (FilterOption & { folder: string })[] = [];
  if (own !== "") out.push({ name: "(Space root)", folder: "", orderId: 0 });
  if (!root) return out;
  const folders = [...allFolderPaths(root)]
    .filter(
      (folder) =>
        folder !== path &&
        folder !== own &&
        !folder.startsWith(path + separator),
    )
    .sort((a, b) => a.localeCompare(b));
  for (const folder of folders) out.push({ name: folder, folder });
  return out;
}

function parentOf(name: string, separator: string): string {
  const idx = name.lastIndexOf(separator);
  return idx === -1 ? "" : name.slice(0, idx);
}
