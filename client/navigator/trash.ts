// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada
//
// Trash: "Move to trash" renames a page to `Trash/<name>` and writes where it
// came from into its frontmatter, so it can be put back; permanent deletion
// exists only for what is already in Trash/. Same marks and same names as the
// db row menu (`plugs/db-view/src/functions.ts`), so either path restores
// the other's.

import { syscall } from "@silverbulletmd/silverbullet/syscall";
import { editor, space, system } from "@silverbulletmd/silverbullet/syscalls";

export const TRASH_PREFIX = "Trash/";

/** How long a toast with an Undo stays up. */
export const UNDO_TOAST_MS = 8000;

export type TrashEntry = {
  /** The name under Trash/. */
  name: string;
  /** Where it goes back to. */
  from: string;
  /** `YYYY-MM-DD` of the day it was trashed, when known. */
  at?: string;
  tag: "page" | "document";
};

/** The first free name for `name` under Trash/: `Trash/<name>`, then ` 2`. */
export async function trashTarget(
  name: string,
  taken: (candidate: string) => Promise<boolean>,
  document = false,
): Promise<string> {
  const split = document ? splitExtension(name) : { stem: name, ext: "" };
  for (let n = 1; ; n++) {
    const candidate = `${TRASH_PREFIX}${split.stem}${n === 1 ? "" : ` ${n}`}${split.ext}`;
    if (!(await taken(candidate))) return candidate;
  }
}

function splitExtension(name: string): { stem: string; ext: string } {
  const slash = name.lastIndexOf("/");
  const dot = name.lastIndexOf(".");
  return dot > slash + 1
    ? { stem: name.slice(0, dot), ext: name.slice(dot) }
    : { stem: name, ext: "" };
}

/** `Trash/Projects/A` -> `Projects/A`; undefined when it is not under Trash/. */
export function untrashedName(name: string): string | undefined {
  return name.startsWith(TRASH_PREFIX) && name.length > TRASH_PREFIX.length
    ? name.slice(TRASH_PREFIX.length)
    : undefined;
}

function isoDay(date = new Date()): string {
  const two = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
}

/** The toast API in-process: a message with one real button. */
export function flashWithAction(
  message: string,
  action: { name: string; run: () => void | Promise<void> },
  timeout = UNDO_TOAST_MS,
): void {
  void syscall("editor.flashNotification", message, "info", {
    timeout,
    actions: [{ name: action.name, run: () => void action.run() }],
  });
}

/**
 * Whether `name` is taken, asked of the space itself: the cached page list the
 * client keeps lags a rename by a moment, which would refuse an Undo.
 */
async function exists(name: string, document: boolean): Promise<boolean> {
  try {
    if (document) await space.getDocumentMeta(name);
    else await space.getPageMeta(name);
    return true;
  } catch (e) {
    // Only "not found" means free: anything else could be a page that is
    // there, and the rename after it would overwrite.
    if (/not found/i.test(e instanceof Error ? e.message : String(e))) {
      return false;
    }
    throw e;
  }
}

// `silent`: the index plug's own "Renamed X to Y" would name the internal
// Trash/ path and stack under ours, which says what happened in the product's
// words and carries the Undo.
async function renameTo(
  from: string,
  to: string,
  document: boolean,
): Promise<boolean> {
  return document
    ? await system.invokeFunction("index.renameDocumentCommand", {
        oldDocument: from,
        document: to,
        silent: true,
      })
    : await system.invokeFunction("index.renamePageCommand", {
        oldPage: from,
        page: to,
        silent: true,
      });
}

async function patchFrontmatter(
  page: string,
  patches: unknown[],
): Promise<void> {
  const text = await space.readPage(page);
  const patched: string = await system.invokeFunction(
    "index.patchFrontmatter",
    text,
    patches,
  );
  if (patched !== text) await space.writePage(page, patched);
}

async function currentPage(): Promise<string | undefined> {
  try {
    return await editor.getCurrentPage();
  } catch {
    return undefined;
  }
}

/** What the user is asked, in the vocabulary of the product (one sentence for
 * the question, one for the consequence). */
export function trashQuestion(name: string): string {
  return `Move ${name} to trash? You can restore it from Trash.`;
}

/**
 * Moves one page or document to Trash/, after asking, and offers Undo. Returns
 * whether it moved.
 */
export async function moveToTrash(item: {
  name: string;
  tag?: string;
}): Promise<boolean> {
  const document = item.tag === "document";
  if (item.name.startsWith(TRASH_PREFIX)) {
    // Already in the trash: the only thing left is Trash: Empty.
    await editor.flashNotification(
      "This is already in Trash. Use Trash: Empty to delete it for good.",
    );
    return false;
  }
  if (
    !(await editor.confirm(trashQuestion(item.name), {
      destructive: true,
      okLabel: "Move to trash",
    }))
  ) {
    return false;
  }
  // What is on screen is what gets written below: flush it first.
  const wasOpen = !document && (await currentPage()) === item.name;
  if (wasOpen) await editor.save();
  const target = await trashTarget(
    item.name,
    (candidate) => exists(candidate, document),
    document,
  );
  try {
    if (!document) {
      await patchFrontmatter(item.name, [
        { op: "set-key", path: "trashedFrom", value: item.name },
        { op: "set-key", path: "trashedAt", value: isoDay() },
      ]);
    }
    if (!(await renameTo(item.name, target, document))) {
      throw new Error("The rename did not go through");
    }
  } catch (e) {
    // The page may have been marked before the rename failed: put it back.
    if (!document) {
      try {
        await patchFrontmatter(item.name, [
          { op: "delete-key", path: "trashedFrom" },
          { op: "delete-key", path: "trashedAt" },
        ]);
      } catch {
        // Only marked: the page itself is intact.
      }
    }
    await editor.flashNotification(
      `Could not move ${item.name} to trash. ${errorText(e)}`,
      "error",
    );
    return false;
  }
  // The rename follows the open page into Trash/: leave it for the home page,
  // or the editor would go on showing the trash marks as if it were a page.
  if (wasOpen) {
    try {
      await editor.navigate("");
    } catch {
      // Stay where we are.
    }
  }
  flashWithAction("Moved to trash", {
    name: "Undo",
    run: async () => {
      const back = await restoreFromTrash({
        name: target,
        from: item.name,
        tag: document ? "document" : "page",
      });
      if (back && wasOpen) await editor.navigate(item.name);
    },
  });
  return true;
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Puts one trashed page back under its old name and drops the two marks. */
export async function restoreFromTrash(entry: {
  name: string;
  from: string;
  tag: "page" | "document";
}): Promise<boolean> {
  const document = entry.tag === "document";
  if (await exists(entry.from, document)) {
    await editor.flashNotification(
      `${entry.from} already exists. Rename one of them first.`,
      "error",
    );
    return false;
  }
  try {
    if (!(await renameTo(entry.name, entry.from, document))) {
      throw new Error("The rename did not go through");
    }
  } catch (e) {
    await editor.flashNotification(
      `Could not restore ${entry.name}. ${errorText(e)}`,
      "error",
    );
    return false;
  }
  if (!document) {
    // Back already: failing to drop the marks is not a failed restore.
    try {
      await patchFrontmatter(entry.from, [
        { op: "delete-key", path: "trashedFrom" },
        { op: "delete-key", path: "trashedAt" },
      ]);
      // The open page was written behind the editor's back: show what is on
      // disk, or the next keystroke would save the marks back.
      if ((await currentPage()) === entry.from) await editor.reloadPage();
    } catch {
      // Leave the marks.
    }
  }
  await editor.flashNotification(`Restored ${entry.from}`);
  return true;
}

/** One page under Trash/ with where it goes back to. */
async function pageEntry(name: string): Promise<TrashEntry | undefined> {
  let from = untrashedName(name);
  let at: string | undefined;
  try {
    const text = await space.readPage(name);
    const { frontmatter } = await system.invokeFunction(
      "index.extractFrontmatter",
      text,
    );
    const marked = frontmatter?.trashedFrom;
    // A mark that points back into the trash would loop: ignore it.
    if (typeof marked === "string" && !marked.startsWith(TRASH_PREFIX)) {
      from = marked;
    }
    if (frontmatter?.trashedAt !== undefined) {
      at = String(frontmatter.trashedAt).slice(0, 10);
    }
  } catch {
    // A page we cannot read still goes back under its trash name.
  }
  return from ? { name, from, at, tag: "page" } : undefined;
}

/** Everything under Trash/, newest first, with where each goes back to. */
export async function listTrash(): Promise<TrashEntry[]> {
  const [pages, documents] = await Promise.all([
    space.listPages(),
    space.listDocuments(),
  ]);
  const entries: TrashEntry[] = [];
  for (const page of pages) {
    if (!page.name.startsWith(TRASH_PREFIX)) continue;
    const entry = await pageEntry(page.name);
    if (entry) entries.push(entry);
  }
  for (const document of documents) {
    const from = untrashedName(document.name);
    if (from) entries.push({ name: document.name, from, tag: "document" });
  }
  return entries.sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));
}

/**
 * The row menu's Restore: puts one thing in Trash/ back where it came from and
 * opens it, the way `Trash: Restore` does.
 */
export async function restoreRow(item: {
  name: string;
  tag?: string;
}): Promise<boolean> {
  const entry: TrashEntry | undefined =
    item.tag === "document"
      ? untrashedName(item.name)
        ? { name: item.name, from: untrashedName(item.name)!, tag: "document" }
        : undefined
      : await pageEntry(item.name);
  if (!entry) return false;
  if (!(await restoreFromTrash(entry))) return false;
  if (entry.tag === "page") await editor.navigate(entry.from);
  return true;
}

/** `Trash: Restore`: pick something in Trash/ and put it back. */
export async function restoreCommand(): Promise<void> {
  const entries = await listTrash();
  if (entries.length === 0) {
    await editor.flashNotification("Trash is empty.");
    return;
  }
  const picked = await editor.filterBox(
    "Restore",
    entries.map((entry) => ({
      name: entry.name,
      description: entry.at ? `${entry.from} · ${entry.at}` : entry.from,
    })),
    "Pick what to put back. It returns to the name in the description.",
    "Trash…",
  );
  if (!picked) return;
  const entry = entries.find((e) => e.name === picked.name);
  if (!entry) return;
  if (await restoreFromTrash(entry)) {
    if (entry.tag === "page") await editor.navigate(entry.from);
  }
}

/** `Trash: Empty`: delete everything under Trash/ for good, after asking. */
export async function emptyCommand(): Promise<void> {
  const entries = await listTrash();
  if (entries.length === 0) {
    await editor.flashNotification("Trash is empty.");
    return;
  }
  const noun = entries.length === 1 ? "page" : "pages";
  if (
    !(await editor.confirm(
      `Delete ${entries.length} ${noun} in Trash forever? This cannot be undone.`,
      { destructive: true, okLabel: "Delete forever" },
    ))
  ) {
    return;
  }
  let failed = 0;
  for (const entry of entries) {
    try {
      if (entry.tag === "document") await space.deleteDocument(entry.name);
      else await space.deletePage(entry.name);
    } catch {
      failed++;
    }
  }
  await editor.flashNotification(
    failed === 0
      ? "Trash is empty."
      : `${failed} could not be deleted. Try Trash: Empty again.`,
    failed === 0 ? "info" : "error",
  );
}
