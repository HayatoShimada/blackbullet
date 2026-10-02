// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada
//
// What a page is called on screen. A page's name is its path, which is what
// the file is called and what links point at; the user sees the last segment
// as the title and the folders as a dim breadcrumb. Two pages read differently
// from their path: Home (`index`) and a quick note (`Inbox/<date>/<time>`).
// Display only: nothing here renames anything.

export const HOME_PAGE = "index";
export const HOME_TITLE = "Home";
export const QUICK_NOTE_TITLE = "Quick note";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^(\d{2})-(\d{2})-(\d{2})$/;

export type PageTitle = {
  /** The dim part before the title ("Projects ›"); empty when there is none. */
  crumb: string;
  title: string;
};

/**
 * A page's name is its last path segment; the folders before it are the dim
 * breadcrumb ("Projects ›"). The full path is what the rename field edits.
 */
export function splitPageName(pageName: string | undefined): {
  folder: string;
  base: string;
} {
  const name = pageName ?? "";
  const slash = name.lastIndexOf("/");
  // A trailing slash would leave an empty title: keep the whole name then.
  if (slash < 0 || slash === name.length - 1) return { folder: "", base: name };
  return { folder: name.slice(0, slash), base: name.slice(slash + 1) };
}

/** "Projects/Plans" -> "Projects › Plans ›" (the crumbs before the name). */
export function breadcrumbText(folder: string): string {
  return folder === "" ? "" : `${folder.split("/").join(" › ")} ›`;
}

/**
 * "11:17", "18" and "2026-10-02" for `Inbox/2026-10-02/11-17-18`; else
 * undefined. The seconds only tell two notes of one minute apart.
 */
export function quickNoteParts(
  name: string | undefined,
): { date: string; time: string; seconds: string } | undefined {
  const parts = (name ?? "").split("/");
  if (parts.length < 3) return undefined;
  const time = TIME.exec(parts[parts.length - 1]);
  const date = parts[parts.length - 2];
  if (!time || !DATE.test(date)) return undefined;
  return { date, time: `${time[1]}:${time[2]}`, seconds: time[3] };
}

/** "Quick note · 11:17" for a quick note's path; undefined for any other page. */
export function quickNoteLabel(name: string | undefined): string | undefined {
  const note = quickNoteParts(name);
  return note ? `${QUICK_NOTE_TITLE} · ${note.time}` : undefined;
}

/** "Home" for the index page; undefined for any other page. */
export function homeLabel(name: string | undefined): string | undefined {
  return name === HOME_PAGE ? HOME_TITLE : undefined;
}

/** A page's title and breadcrumb as the top bar draws them. */
export function pageTitle(name: string | undefined): PageTitle {
  const home = homeLabel(name);
  if (home) return { crumb: "", title: home };
  const note = quickNoteParts(name);
  if (note) {
    return { crumb: `${note.date} ›`, title: quickNoteLabel(name) as string };
  }
  const { folder, base } = splitPageName(name);
  return { crumb: breadcrumbText(folder), title: base };
}

/**
 * The dim text beside a label that cannot tell two pages apart: the seconds of
 * a quick note (":25"), so two taken in one minute differ. Undefined for any
 * other page.
 */
export function labelTiebreak(name: string | undefined): string | undefined {
  const note = quickNoteParts(name);
  return note ? `:${note.seconds}` : undefined;
}

/**
 * A page's label in lists: Home, a quick note's time, or undefined to keep the
 * name the list already shows.
 */
export function listLabel(name: string | undefined): string | undefined {
  return homeLabel(name) ?? quickNoteLabel(name);
}

/**
 * What leaving or confirming the title field means: a different name renames;
 * the same name confirmed with Enter hands focus back to the text; the same
 * name left by Tab or a click does nothing, so focus stays where the user put it.
 */
export function titleCommit(
  newName: string,
  pageName: string | undefined,
  fromBlur: boolean,
): "rename" | "confirm" | "none" {
  if (newName !== pageName) return "rename";
  return fromBlur ? "none" : "confirm";
}
