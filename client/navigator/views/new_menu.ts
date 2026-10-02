// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada
//
// One New. Every way to create something lists the same options in the same
// order: Page here, Row in <database>… (one per declared database), Quick
// note, Journal: Today. The tree's `+` and the New command (Ctrl-Alt-n) both
// draw this list; choosing an item runs the command that already does it.

import { config, editor, system } from "@silverbulletmd/silverbullet/syscalls";

export type NewEntry = {
  /** `page`, `row:<database>`, `quick` or `journal`. */
  id: string;
  label: string;
  /** A dim second part: the folder a page goes in. */
  description?: string;
};

type DatabaseDef = { tag?: string; title?: string; [key: string]: unknown };

/** The databases the space declares (`database.define`), by name. */
async function databases(): Promise<Record<string, DatabaseDef>> {
  try {
    const all = await config.get<Record<string, DatabaseDef>>("databases", {});
    return all && typeof all === "object" ? all : {};
  } catch {
    return {};
  }
}

/** The New list for a tree whose selection is in `folder` (`""`: the root). */
export async function newMenuEntries(folder: string): Promise<NewEntry[]> {
  const entries: NewEntry[] = [
    {
      id: "page",
      label: "Page here",
      description: folder ? `${folder}/` : undefined,
    },
  ];
  const defs = await databases();
  for (const name of Object.keys(defs).sort()) {
    entries.push({
      id: `row:${name}`,
      label: `Row in ${defs[name].title ?? name}…`,
    });
  }
  entries.push({ id: "quick", label: "Quick note" });
  entries.push({ id: "journal", label: "Journal: Today" });
  return entries;
}

/**
 * Makes a row of database `name`: asks for a title, creates the page from the
 * database's template, opens it. The same call "Database: New Row" makes, with
 * the database already chosen.
 */
export async function newDatabaseRow(name: string): Promise<void> {
  const def = (await databases())[name];
  if (!def) {
    await editor.flashNotification(`${name} is not a database.`, "error");
    return;
  }
  const typed = await editor.prompt("Title");
  const title = (typed ?? "").trim();
  if (title === "") return;
  const result = await system.invokeFunction(
    "db-view.createRow",
    {
      source: { kind: "tag", tag: def.tag ?? name },
      database: def,
      view: "table",
      group: "status",
      date: "due",
      where: {},
      limit: 500,
      weekStart: 0,
    },
    title,
  );
  if (result?.ok) await editor.navigate(`${result.page}@0`);
  else {
    await editor.flashNotification(
      result?.message ?? "The row could not be made.",
      "error",
    );
  }
}

/**
 * Runs one entry. `page` is the caller's to run (the tree Mediator owns the
 * one page-creation path), so it comes in as `newPage`.
 */
export async function runNewEntry(
  id: string,
  folder: string,
  newPage: (folder: string) => void | Promise<void>,
): Promise<void> {
  if (id === "page") await newPage(folder);
  else if (id.startsWith("row:")) await newDatabaseRow(id.slice(4));
  else if (id === "quick") await editor.invokeCommand("Quick Note");
  else if (id === "journal") await editor.invokeCommand("Journal: Today");
}
