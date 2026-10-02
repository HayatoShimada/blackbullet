import { config, editor, system } from "@silverbulletmd/silverbullet/syscalls";
import { compareCollated } from "@silverbulletmd/silverbullet/lib/collation";
import type { ObjectValue } from "@silverbulletmd/silverbullet/type/index";
import type { QueryCollationConfig } from "@silverbulletmd/silverbullet/type/config";
import { isHiddenPage, isMetaPage, spaceContents } from "./pages.ts";
import { emitToTree } from "../ui/mediator/tree_host.ts";
import { isPinned } from "./pin.ts";
import { moveToTrash, restoreRow, TRASH_PREFIX } from "../trash.ts";
import { pendingPages } from "./pending_pages.ts";
import { inboxOrder } from "./inbox.ts";
import { HOME_PAGE, labelTiebreak, listLabel } from "../page_title.ts";
import {
  baseMeta,
  type BuiltinView,
  INDEX_REFRESH_EVENTS,
  type Segment,
} from "./types.ts";
import { PENDING_PAGES_EVENT } from "./pending_pages.ts";

type TreeObj = Partial<ObjectValue<Record<string, any>>> & {
  name: string;
  isFolder?: boolean;
};

function treeIcon(obj: TreeObj): string {
  // Only a pure folder gets the folder icon. A dual has a page behind it and
  // reads as that page, so it falls through to the icons below like any other.
  if (obj.isFolder && obj.ref == null) return "folder";
  const decorated = obj.pageDecoration?.icon;
  if (typeof decorated === "string" && decorated !== "") return decorated;
  if (obj.isAspiring) return "file-plus";
  if (obj.perm === "ro") return "lock";
  if (obj.tag === "document") {
    return String(obj.contentType ?? "").startsWith("image/")
      ? "image"
      : "file";
  }
  return "file-text";
}

const spaceTreeSegments: Segment<TreeObj>[] = [
  {
    label: "All",
    icon: "layers",
    default: true,
    placeholder: "Open a page or document…",
    dockPlaceholder: "Open…",
    // Meta pages are reachable only via the Meta segment.
    where: (obj) => !isMetaPage(obj),
  },
  {
    label: "Pages",
    icon: "file-text",
    placeholder: "Open a page…",
    dockPlaceholder: "Open…",
    where: (obj) => obj.tag === "page" && !isMetaPage(obj),
  },
  {
    label: "Documents",
    icon: "file",
    placeholder: "Open a document…",
    dockPlaceholder: "Open…",
    where: (obj) => obj.tag === "document",
  },
  {
    label: "Meta",
    icon: "settings",
    placeholder: "Open a meta page…",
    dockPlaceholder: "Open…",
    where: isMetaPage,
  },
];

/** Unlike the picker, the tree has no segment that keeps hidden pages: a page
 * hidden from navigation is hidden here too, and `tree.hide` hides it from
 * here alone. A hidden page with children still leaves its folder behind --
 * the folder is synthesized from the children's names. */
function isTreeHidden(obj: TreeObj): boolean {
  return isHiddenPage(obj) || obj.pageDecoration?.tree?.hide === true;
}

/** Home leads the tree: it is read by its title, not by the name `index`. */
function homeOrder(a: TreeObj, b: TreeObj): number {
  return (
    Number(String(b.name) === HOME_PAGE) - Number(String(a.name) === HOME_PAGE)
  );
}

async function spaceTreeSource(): Promise<TreeObj[]> {
  const contents = [
    ...(await spaceContents()),
    // A page that was just created has no file until its first edit, and no
    // row until the index has seen that file: show it now.
    ...(pendingPages.rows() as TreeObj[]),
  ];
  pendingPages.settle(contents.map((obj) => String(obj.name)));
  const collation = await config.get<QueryCollationConfig>(
    "queryCollation",
    {},
  );
  const collator = Intl.Collator(collation?.locale, collation?.options);
  return (contents as TreeObj[])
    .filter((obj) => !isTreeHidden(obj))
    .sort(
      (a, b) =>
        homeOrder(a, b) ||
        inboxOrder(a, b) ||
        compareCollated(String(a.name), String(b.name), collation, collator),
    );
}

async function moveByRename(obj: TreeObj, newName: string): Promise<void> {
  if (obj.isFolder) {
    // Covers documents as well as pages under the prefix.
    await system.invokeFunction("index.renamePrefixCommand", {
      oldPrefix: `${obj.name}/`,
      newPrefix: `${newName}/`,
      disableConfirmation: true,
    });
  }
  // A page that also has children is both: renamePrefixCommand only touches
  // files under "name/", so the page itself still needs its own rename.
  if (!obj.isFolder || obj.ref) {
    if (obj.tag === "document") {
      // A document's name carries its extension and is the file name itself,
      // so the page rename (which appends ".md") would rename the wrong file.
      await system.invokeFunction("index.renameDocumentCommand", {
        oldDocument: obj.name,
        document: newName,
      });
    } else {
      await system.invokeFunction("index.renamePageCommand", {
        oldPage: obj.name,
        page: newName,
      });
    }
  }
}

/** Renaming means something different for each of the three kinds of row a
 * space tree has, and only the folder case needs a prompt of its own (the
 * other two are the same commands the editor's own rename commands run). */
async function renameTreeRow(obj: TreeObj): Promise<void> {
  if (obj.isFolder) {
    const newName = await editor.prompt(`Rename ${obj.name} to:`, obj.name);
    if (newName == null) return;
    const trimmed = newName.trim();
    if (trimmed === "" || trimmed === obj.name) return;
    await moveByRename(obj, trimmed);
  } else if (obj.tag === "document") {
    await system.invokeFunction("index.renameDocumentCommand", {
      oldDocument: obj.name,
    });
  } else {
    await system.invokeFunction("index.renamePageCommand", {
      oldPage: obj.name,
    });
  }
}

/** Never a permanent delete from the tree: it goes to Trash/ and can come
 * back (Trash: Restore, or the toast's Undo). */
async function trashTreeRow(obj: TreeObj): Promise<void> {
  await moveToTrash(obj);
}

/** Something that is in Trash/ (or Trash/ itself). */
function inTrash(obj: TreeObj): boolean {
  const name = String(obj.name);
  return name === "Trash" || name.startsWith(TRASH_PREFIX);
}

/** What is in Trash/ has one way out of it: back where it came from. */
function isRestorable(obj: TreeObj): boolean {
  return (
    inTrash(obj) &&
    obj.ref != null &&
    !obj.isAspiring &&
    obj.isPending !== true &&
    String(obj.name).length > TRASH_PREFIX.length
  );
}

/** "New page here": the one creation path, owned by the tree Mediator. */
function newPageUnder(obj: TreeObj): void {
  void emitToTree({ type: "page.new", folder: obj.name });
}

// A pure folder has no object behind it, so it has nothing to trash (and
// trashing a whole subtree is not a job for a menu item). A page that also
// heads a folder keeps its own entry: it has a page to remove. What is in
// Trash/ already is emptied by Trash: Empty, not from here.
function isTrashable(obj: TreeObj): boolean {
  return (
    (!obj.isFolder || obj.ref != null) &&
    !obj.isAspiring &&
    obj.isPending !== true &&
    !String(obj.name).startsWith(TRASH_PREFIX)
  );
}

// Only a page carries frontmatter: a pure folder has no file, a document no
// Markdown.
function isPinnable(obj: TreeObj): boolean {
  return (
    obj.tag === "page" &&
    obj.ref != null &&
    obj.isPending !== true &&
    !inTrash(obj)
  );
}

export const spaceTreeView: BuiltinView<TreeObj> = {
  meta: baseMeta({
    title: "Space",
    label: "Open",
    dock: "lhs",
    supportedDocks: ["lhs", "rhs", "bhs", "modal"],
    mode: "tree",
    followEditor: true,
    hasCreate: true,
    uploadFiles: true,
    foldersFirst: false,
    // Every folder here names a page, whether or not one exists yet, so
    // clicking one opens that page as well as expanding the row.
    selectableFolders: true,
    refreshOn: [...INDEX_REFRESH_EVENTS, PENDING_PAGES_EVENT],
  }),
  row: {
    icon: treeIcon,
    label: (obj) => listLabel(String(obj.name)),
    // Two quick notes of one minute read alike: the seconds set them apart.
    description: (obj) => labelTiebreak(String(obj.name)),
    priority: (obj) => obj.pageDecoration?.tree?.priority,
  },
  segments: spaceTreeSegments,
  // The order here is the order of the row menu: edits first, the way out last.
  actions: [
    {
      icon: "edit-3",
      label: "Rename",
      requireMode: "rw",
      // A page that has no file yet has nothing to rename.
      when: (obj) => obj.isPending !== true && !inTrash(obj),
      run: renameTreeRow,
    },
    {
      icon: "corner-down-right",
      label: "Move to…",
      requireMode: "rw",
      // An aspiring page has no file behind it to move.
      when: (obj) =>
        obj.isPending !== true &&
        !inTrash(obj) &&
        (obj.isFolder === true || obj.ref != null),
      run: (obj) => void emitToTree({ type: "move.pick", path: obj.name }),
    },
    {
      icon: "bookmark",
      label: "Pin",
      requireMode: "rw",
      when: (obj) => isPinnable(obj) && !isPinned(obj.pageDecoration),
      run: (obj) =>
        void emitToTree({ type: "pin.request", path: obj.name, pinned: true }),
    },
    {
      icon: "x-circle",
      label: "Unpin",
      requireMode: "rw",
      when: (obj) => isPinnable(obj) && isPinned(obj.pageDecoration),
      run: (obj) =>
        void emitToTree({ type: "pin.request", path: obj.name, pinned: false }),
    },
    {
      icon: "plus",
      label: "New page here",
      requireMode: "rw",
      when: (obj) => obj.isFolder === true && !inTrash(obj),
      run: newPageUnder,
    },
    {
      icon: "trash-2",
      label: "Move to trash",
      requireMode: "rw",
      danger: true,
      when: isTrashable,
      run: trashTreeRow,
    },
    // Last in the array so the indexes above stay put; in the menu it comes
    // before the danger item, and a row in Trash/ has no other action.
    {
      icon: "rotate-ccw",
      label: "Restore",
      requireMode: "rw",
      when: isRestorable,
      run: (obj) => void restoreRow(obj),
    },
  ],
  keymap: {
    // Peek: open the row without leaving the panel, so the next arrow keeps
    // browsing. `editor.navigate` focuses the editor; the panel takes focus
    // back on its own afterwards.
    " ": (obj) => editor.navigate(obj.ref ?? obj.name),
  },
  onMove: moveByRename,
  source: spaceTreeSource,
  onSelect: (obj) => editor.navigate(obj.ref ?? obj.name),
  onCreate: (name) => editor.navigate(name),
};
