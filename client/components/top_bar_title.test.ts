// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada

import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { expect, test } from "vitest";
import { breadcrumbText, splitPageName, TopBar } from "./top_bar.tsx";

test("the title is the last path segment, the folders are the breadcrumb", () => {
  expect(splitPageName("Projects/Spring Launch")).toEqual({
    folder: "Projects",
    base: "Spring Launch",
  });
  expect(splitPageName("Inbox/2026-10-02/11-17-18")).toEqual({
    folder: "Inbox/2026-10-02",
    base: "11-17-18",
  });
  expect(splitPageName("index")).toEqual({ folder: "", base: "index" });
  expect(splitPageName("Folder/")).toEqual({ folder: "", base: "Folder/" });
  expect(splitPageName(undefined)).toEqual({ folder: "", base: "" });
  expect(breadcrumbText("Inbox/2026-10-02")).toBe("Inbox › 2026-10-02 ›");
  expect(breadcrumbText("")).toBe("");
});

test("the top bar renders the last segment in a labelled field and the folders dim", () => {
  const html = renderToString(
    h(TopBar, {
      pageName: "Projects/Spring Launch",
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
  expect(html).toContain('aria-label="Page name"');
  expect(html).toContain('value="Spring Launch"');
  expect(html).toContain("Projects ›");
  expect(html).not.toContain('value="Projects/Spring Launch"');
});
