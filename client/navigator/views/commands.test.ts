// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada

import { expect, test, vi } from "vitest";

// The palette's rows are pure; its `onSelect` reaches for the panel plug.
vi.mock("../navigator.ts", () => ({ hide: vi.fn() }));

const {
  arrangeCommands,
  commandPalette,
  groupOf,
  hintChips,
  isHiddenUntilTyped,
  RECENT_COUNT,
} = await import("./commands.ts");

const cmd = (name: string, extra: Record<string, unknown> = {}) => ({
  name,
  priority: 0,
  ...extra,
});

test("developer and irreversible commands are found by typing, never browsed", () => {
  for (const name of [
    "Client: Wipe",
    "Client: Logout",
    "Client: Reload UI",
    "Client: Version",
    "Baked Sections: Update",
    "Baked Sections: Unbake Section At Cursor",
    "Navigate: Meta Picker",
    "Navigate: Document Picker",
    "Page: Delete",
  ]) {
    expect(isHiddenUntilTyped(name)).toBe(true);
  }
  expect(isHiddenUntilTyped("Page: New")).toBe(false);
  expect(isHiddenUntilTyped("Client: Something Else")).toBe(false);
});

test("a command's group is its prefix", () => {
  expect(groupOf("Page: New")).toBe("Page");
  expect(groupOf("Quick Note")).toBe("Other");
});

test("the empty palette is Recent, Suggested, then everything by prefix", () => {
  const rows = arrangeCommands([
    cmd("Page: New"),
    cmd("New"),
    cmd("Quick Note"),
    cmd("Journal: Today", { lastRun: 5 }),
    cmd("Navigate: Tree"),
    cmd("Page: Rename"),
    cmd("Client: Wipe"),
  ]);
  const shown = rows.map((r) =>
    r.header ? `# ${r.header}` : r.shortcut ? `~ ${r.name}` : r.name,
  );
  expect(shown).toEqual([
    "# Recent",
    "~ Journal: Today",
    "# Suggested",
    // Suggested: Quick Note, New, Navigate: Tree, in that order.
    "~ Quick Note",
    "~ New",
    "~ Navigate: Tree",
    // A group of only typed-to-find commands has no title to show, and with
    // nothing typed its rows are not shown either.
    "Client: Wipe",
    // A group whose commands are all shown above has no title, and its copies
    // are for a typed phrase only.
    "Journal: Today",
    "Navigate: Tree",
    "# Page",
    "Page: New",
    "Page: Rename",
    "New",
    "Quick Note",
  ]);
  // The copies still rank when something is typed.
  const whens = ["Journal: Today", "New", "Page: Rename"].map((name) => {
    const row = rows.find((r) => r.name === name && !r.shortcut)!;
    return commandPalette.row?.when?.(row as never);
  });
  expect(whens).toEqual(["typed", "typed", undefined]);
});

test("Recent keeps the last few that ran, newest first, and never a hidden command", () => {
  const commands = Array.from({ length: RECENT_COUNT + 2 }, (_, i) =>
    cmd(`Run: ${i}`, { lastRun: i + 1 }),
  );
  commands.push(cmd("Client: Wipe", { lastRun: 100 }));
  const recent = arrangeCommands(commands)
    .filter((r) => r.shortcut)
    .map((r) => r.name);
  expect(recent).toEqual(["Run: 6", "Run: 5", "Run: 4", "Run: 3", "Run: 2"]);
});

test("a suggestion that is also recent is shown once", () => {
  const rows = arrangeCommands([
    cmd("Quick Note", { lastRun: 1 }),
    cmd("Journal: Today"),
  ]);
  expect(rows.filter((r) => r.shortcut).map((r) => r.name)).toEqual([
    "Quick Note",
    "Journal: Today",
  ]);
});

test("a key hint is one chip per binding, none twice", () => {
  expect(hintChips(undefined)).toEqual([]);
  expect(hintChips("Ctrl-k")).toEqual(["Ctrl-k"]);
  expect(hintChips("Ctrl-o | Ctrl-Shift-o")).toEqual([
    "Ctrl-o",
    "Ctrl-Shift-o",
  ]);
  // The held-Ctrl variant of a chord is the same shortcut.
  expect(hintChips("Ctrl-q q | Ctrl-q Ctrl-q")).toEqual(["Ctrl-q q"]);
  expect(hintChips("⌃q q | ⌃q ⌃Q")).toEqual(["⌃q q"]);
  expect(hintChips("Ctrl-p | Ctrl-p")).toEqual(["Ctrl-p"]);
});

test("the palette row carries each binding as its own chip", () => {
  const decorations = commandPalette.row?.decorations?.(
    cmd("Quick Note", {
      hint: "Ctrl-q q | Ctrl-q Ctrl-q | Ctrl-Alt-q",
    }) as never,
  );
  expect(decorations?.map((d) => d.text)).toEqual(["Ctrl-q q", "Ctrl-Alt-q"]);
});
