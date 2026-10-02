// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada

import { beforeEach, expect, test, vi } from "vitest";

const space = { pageExists: vi.fn(async (_name: string) => false) };
const editor = {
  prompt: vi.fn<(msg: string, def?: string) => Promise<string | undefined>>(),
  navigate: vi.fn(async (_ref: string) => {}),
};
const events = { dispatchEvent: vi.fn(async () => []) };
vi.mock("@silverbulletmd/silverbullet/syscalls", () => ({
  space,
  editor,
  events,
}));

const { createPageIn, openNewPage } = await import("./new_page.ts");

beforeEach(() => {
  vi.clearAllMocks();
  space.pageExists.mockResolvedValue(false);
});

test("asks for a name inside the folder and opens the page with the caret on line 1", async () => {
  editor.prompt.mockResolvedValue("  Projects/Gamma  ");
  await createPageIn("Projects");
  expect(editor.prompt).toHaveBeenCalledWith("New page name:", "Projects/");
  expect(editor.navigate).toHaveBeenCalledWith("Projects/Gamma@0");
  expect(events.dispatchEvent).toHaveBeenCalledWith("navigator:pending-pages", {
    name: "Projects/Gamma",
  });
});

test("the top level asks with an empty prefill", async () => {
  editor.prompt.mockResolvedValue("Loose");
  await createPageIn("");
  expect(editor.prompt).toHaveBeenCalledWith("New page name:", "");
  expect(editor.navigate).toHaveBeenCalledWith("Loose@0");
});

test("Escape, or an unedited prefill, makes nothing", async () => {
  editor.prompt.mockResolvedValueOnce(undefined);
  await createPageIn("Projects");
  editor.prompt.mockResolvedValueOnce("Projects/");
  await createPageIn("Projects");
  expect(editor.navigate).not.toHaveBeenCalled();
});

test("a name that exists is opened, not shown as new", async () => {
  space.pageExists.mockResolvedValue(true);
  editor.prompt.mockResolvedValue("Projects/Alpha");
  await createPageIn("Projects");
  expect(editor.navigate).toHaveBeenCalledWith("Projects/Alpha@0");
  expect(events.dispatchEvent).not.toHaveBeenCalled();
});

test("a meta name is shown in the tree under its page name", async () => {
  await openNewPage("^Library/Mine");
  expect(events.dispatchEvent).toHaveBeenCalledWith("navigator:pending-pages", {
    name: "Library/Mine",
  });
  expect(editor.navigate).toHaveBeenCalledWith("^Library/Mine@0");
});
