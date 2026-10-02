// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada

import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { expect, test } from "vitest";
import { TopBar } from "../components/top_bar.tsx";
import {
  homeLabel,
  labelTiebreak,
  listLabel,
  pageTitle,
  quickNoteLabel,
  quickNoteParts,
  titleCommit,
} from "./page_title.ts";

test("the index page is Home, with no breadcrumb", () => {
  expect(pageTitle("index")).toEqual({ crumb: "", title: "Home" });
  expect(homeLabel("index")).toBe("Home");
  // Only the root index: a page called index in a folder is still its name.
  expect(homeLabel("Projects/index")).toBeUndefined();
  expect(pageTitle("Projects/index")).toEqual({
    crumb: "Projects ›",
    title: "index",
  });
});

test("a quick note is titled by its time, with the day as the dim crumb", () => {
  expect(pageTitle("Inbox/2026-10-02/11-17-18")).toEqual({
    crumb: "2026-10-02 ›",
    title: "Quick note · 11:17",
  });
  expect(quickNoteLabel("Inbox/2026-10-02/09-05-00")).toBe(
    "Quick note · 09:05",
  );
  expect(quickNoteParts("Inbox/2026-10-02/09-05-00")).toEqual({
    date: "2026-10-02",
    time: "09:05",
    seconds: "00",
  });
});

test("anything else that is not a time under a day keeps its own name", () => {
  expect(quickNoteLabel("Inbox/2026-10-02")).toBeUndefined();
  expect(quickNoteLabel("Inbox/Idea")).toBeUndefined();
  expect(quickNoteLabel("Inbox/Idea/11-17-18")).toBeUndefined();
  expect(quickNoteLabel("Journal/2026-10-02")).toBeUndefined();
  expect(pageTitle("Inbox/Idea")).toEqual({ crumb: "Inbox ›", title: "Idea" });
  expect(pageTitle("Projects/Spring Launch")).toEqual({
    crumb: "Projects ›",
    title: "Spring Launch",
  });
  expect(pageTitle(undefined)).toEqual({ crumb: "", title: "" });
});

test("lists label Home and quick notes, and leave every other row alone", () => {
  expect(listLabel("index")).toBe("Home");
  expect(listLabel("Inbox/2026-10-02/11-17-18")).toBe("Quick note · 11:17");
  expect(listLabel("Projects/Spring Launch")).toBeUndefined();
});

const bar = (pageName: string) =>
  renderToString(
    h(TopBar, {
      pageName,
      unsavedChanges: false,
      isOnline: true,
      isLoading: false,
      notifications: [],
      onRename: async () => {},
      onDismissNotification: () => {},
      actionButtons: [],
      readOnly: false,
    }),
  );

test("the top bar says Home for index and Quick note · HH:MM for an Inbox note", () => {
  const home = bar("index");
  expect(home).toContain('value="Home"');
  expect(home).not.toContain("sb-page-breadcrumb");
  const note = bar("Inbox/2026-10-02/11-17-18");
  expect(note).toContain("Quick note · 11:17");
  expect(note).toContain("2026-10-02 ›");
  expect(note).not.toContain('value="11-17-18"');
});

test("leaving the title field unchanged never takes focus back into the editor", () => {
  expect(titleCommit("Spring Launch", "Spring Launch", false)).toBe("confirm");
  expect(titleCommit("Spring Launch", "Spring Launch", true)).toBe("none");
  expect(titleCommit("Renamed", "Spring Launch", true)).toBe("rename");
  expect(titleCommit("Renamed", "Spring Launch", false)).toBe("rename");
});

test("two quick notes of one minute differ by their seconds", () => {
  expect(labelTiebreak("Inbox/2026-10-02/16-54-25")).toBe(":25");
  expect(labelTiebreak("Inbox/2026-10-02/16-54-41")).toBe(":41");
  expect(quickNoteParts("Inbox/2026-10-02/16-54-25")?.seconds).toBe("25");
  expect(labelTiebreak("index")).toBeUndefined();
  expect(labelTiebreak("Projects/Spring Launch")).toBeUndefined();
});
