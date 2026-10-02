// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada

import { beforeEach, expect, test, vi } from "vitest";

const config = { get: vi.fn() };
const editor = {
  prompt: vi.fn<(msg: string) => Promise<string | undefined>>(),
  navigate: vi.fn(async (_ref: string) => {}),
  flashNotification: vi.fn(async () => {}),
  invokeCommand: vi.fn(async (_name: string) => {}),
};
const system = { invokeFunction: vi.fn() };
vi.mock("@silverbulletmd/silverbullet/syscalls", () => ({
  config,
  editor,
  system,
}));

const { newDatabaseRow, newMenuEntries, runNewEntry } = await import(
  "./new_menu.ts"
);

beforeEach(() => {
  vi.clearAllMocks();
  config.get.mockResolvedValue({
    projects: { tag: "project", title: "Projects" },
    areas: { tag: "area" },
  });
});

test("one New: Page here, a Row per database, Quick note, Journal: Today", async () => {
  const entries = await newMenuEntries("Projects");
  expect(entries.map((e) => `${e.id} | ${e.label}`)).toEqual([
    "page | Page here",
    "row:areas | Row in areas…",
    "row:projects | Row in Projects…",
    "quick | Quick note",
    "journal | Journal: Today",
  ]);
  expect(entries[0].description).toBe("Projects/");
});

test("with no database and no folder the list is still the same shape", async () => {
  config.get.mockResolvedValue({});
  const entries = await newMenuEntries("");
  expect(entries.map((e) => e.id)).toEqual(["page", "quick", "journal"]);
  expect(entries[0].description).toBeUndefined();
});

test("Page here is the caller's one creation path", async () => {
  const newPage = vi.fn();
  await runNewEntry("page", "Projects", newPage);
  expect(newPage).toHaveBeenCalledWith("Projects");
});

test("Quick note and Journal: Today run the commands that already do it", async () => {
  await runNewEntry("quick", "", vi.fn());
  await runNewEntry("journal", "", vi.fn());
  expect(editor.invokeCommand.mock.calls).toEqual([
    ["Quick Note"],
    ["Journal: Today"],
  ]);
});

test("a row asks for its title, makes the page from the database, and opens it", async () => {
  editor.prompt.mockResolvedValue("  Launch  ");
  system.invokeFunction.mockResolvedValue({
    ok: true,
    page: "Projects/Launch",
  });
  await newDatabaseRow("projects");
  expect(editor.prompt).toHaveBeenCalledWith("Title");
  expect(system.invokeFunction).toHaveBeenCalledWith(
    "db-view.createRow",
    expect.objectContaining({
      source: { kind: "tag", tag: "project" },
      database: { tag: "project", title: "Projects" },
    }),
    "Launch",
  );
  expect(editor.navigate).toHaveBeenCalledWith("Projects/Launch@0");
});

test("an empty title makes nothing, and a refusal is shown", async () => {
  editor.prompt.mockResolvedValueOnce("  ");
  await newDatabaseRow("projects");
  expect(system.invokeFunction).not.toHaveBeenCalled();

  editor.prompt.mockResolvedValueOnce("Launch");
  system.invokeFunction.mockResolvedValue({ ok: false, message: "It exists." });
  await newDatabaseRow("projects");
  expect(editor.flashNotification).toHaveBeenCalledWith("It exists.", "error");
  expect(editor.navigate).not.toHaveBeenCalled();
});
