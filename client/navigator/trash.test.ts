// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada

import { beforeEach, expect, test, vi } from "vitest";

const files = new Map<string, string>();
const calls: string[] = [];
const toasts: {
  message: string;
  actions?: { name: string; run: () => void }[];
}[] = [];

const space = {
  getPageMeta: vi.fn(async (name: string) => {
    if (!files.has(name)) throw new Error(`Page not found: ${name}`);
    return { name };
  }),
  getDocumentMeta: vi.fn(async (name: string) => {
    if (!files.has(name)) throw new Error(`Document not found: ${name}`);
    return { name };
  }),
  readPage: vi.fn(async (name: string) => files.get(name) ?? ""),
  writePage: vi.fn(async (name: string, text: string) => {
    files.set(name, text);
    return {};
  }),
  listPages: vi.fn(async () => [...files.keys()].map((name) => ({ name }))),
  listDocuments: vi.fn(async () => []),
  deletePage: vi.fn(async (name: string) => void files.delete(name)),
  deleteDocument: vi.fn(async () => {}),
};
const editor = {
  confirm: vi.fn(async (_message: string, _options?: unknown) => true),
  flashNotification: vi.fn(async (_message: string, _type?: string) => {}),
  getCurrentPage: vi.fn(async () => "Elsewhere"),
  save: vi.fn(async () => {}),
  reloadPage: vi.fn(async () => {}),
  filterBox: vi.fn(),
  navigate: vi.fn(async (_ref: unknown) => {}),
};
const system = {
  invokeFunction: vi.fn(async (name: string, ...args: any[]) => {
    if (name === "index.renamePageCommand") {
      const { oldPage, page } = args[0];
      files.set(page, files.get(oldPage) ?? "");
      files.delete(oldPage);
      calls.push(`rename ${oldPage} -> ${page}`);
      return true;
    }
    if (name === "index.patchFrontmatter") {
      const [text, patches] = args as [string, any[]];
      let marks = text.startsWith("---\n") ? text : `---\n---\n${text}`;
      for (const patch of patches) {
        if (patch.op === "set-key") {
          marks = marks.replace(
            /^---\n/,
            `---\n${patch.path}: ${patch.value}\n`,
          );
        } else {
          marks = marks.replace(new RegExp(`^${patch.path}: .*\\n`, "m"), "");
        }
      }
      return marks.replace(/^---\n---\n/, "");
    }
    if (name === "index.extractFrontmatter") {
      const text = args[0] as string;
      const frontmatter: Record<string, string> = {};
      for (const line of text.split("\n")) {
        const m = /^(trashed\w+): (.*)$/.exec(line);
        if (m) frontmatter[m[1]] = m[2];
      }
      return { frontmatter };
    }
    return undefined;
  }),
};
vi.mock("@silverbulletmd/silverbullet/syscalls", () => ({
  space,
  editor,
  system,
}));
vi.stubGlobal(
  "syscall",
  (name: string, message: string, _type: string, options: any) => {
    if (name === "editor.flashNotification") {
      toasts.push({ message, actions: options?.actions });
    }
    return Promise.resolve();
  },
);

const {
  emptyCommand,
  moveToTrash,
  restoreCommand,
  restoreFromTrash,
  trashQuestion,
  trashTarget,
  untrashedName,
} = await import("./trash.ts");

beforeEach(() => {
  files.clear();
  calls.length = 0;
  toasts.length = 0;
  vi.clearAllMocks();
  editor.confirm.mockResolvedValue(true);
  editor.getCurrentPage.mockResolvedValue("Elsewhere");
});

test("a page goes to Trash/ under its own name, then ` 2` when that is taken", async () => {
  const taken = new Set(["Trash/Projects/A"]);
  expect(await trashTarget("Projects/B", async (n) => taken.has(n))).toBe(
    "Trash/Projects/B",
  );
  expect(await trashTarget("Projects/A", async (n) => taken.has(n))).toBe(
    "Trash/Projects/A 2",
  );
  // A document keeps its extension last.
  const docs = new Set(["Trash/scan.pdf"]);
  expect(await trashTarget("scan.pdf", async (n) => docs.has(n), true)).toBe(
    "Trash/scan 2.pdf",
  );
});

test("untrashedName is the name before it was trashed", () => {
  expect(untrashedName("Trash/Projects/A")).toBe("Projects/A");
  expect(untrashedName("Projects/A")).toBeUndefined();
  expect(untrashedName("Trash/")).toBeUndefined();
});

test("the question names the page and says it can come back", () => {
  expect(trashQuestion("Scratch Audit")).toBe(
    "Move Scratch Audit to trash? You can restore it from Trash.",
  );
});

test("declining changes nothing", async () => {
  files.set("Scratch", "text");
  editor.confirm.mockResolvedValue(false);
  expect(await moveToTrash({ name: "Scratch", tag: "page" })).toBe(false);
  expect(calls).toEqual([]);
  expect(files.has("Scratch")).toBe(true);
  expect(toasts).toEqual([]);
});

test("moving to trash marks where it came from, renames, and offers Undo", async () => {
  files.set("Scratch", "Body");
  expect(await moveToTrash({ name: "Scratch", tag: "page" })).toBe(true);

  expect(editor.confirm).toHaveBeenCalledWith(
    "Move Scratch to trash? You can restore it from Trash.",
    { destructive: true, okLabel: "Move to trash" },
  );
  expect(calls).toEqual(["rename Scratch -> Trash/Scratch"]);
  expect(files.has("Scratch")).toBe(false);
  expect(files.get("Trash/Scratch")).toContain("trashedFrom: Scratch");
  expect(toasts.at(-1)?.message).toBe("Moved to trash");
  expect(toasts.at(-1)?.actions?.map((a) => a.name)).toEqual(["Undo"]);

  // Undo is the same restore, with the marks removed again.
  toasts.at(-1)!.actions![0].run();
  await vi.waitFor(() => expect(files.has("Scratch")).toBe(true));
  expect(files.has("Trash/Scratch")).toBe(false);
  expect(files.get("Scratch")).not.toContain("trashedFrom");
});

test("the page on screen is saved first", async () => {
  files.set("Scratch", "Body");
  editor.getCurrentPage.mockResolvedValue("Scratch");
  await moveToTrash({ name: "Scratch", tag: "page" });
  expect(editor.save).toHaveBeenCalled();
});

test("renames are silent, and trashing the open page leaves it for home; Undo comes back", async () => {
  files.set("Scratch", "Body");
  editor.getCurrentPage.mockResolvedValue("Scratch");
  await moveToTrash({ name: "Scratch", tag: "page" });
  expect(system.invokeFunction).toHaveBeenCalledWith(
    "index.renamePageCommand",
    expect.objectContaining({ silent: true }),
  );
  expect(editor.navigate).toHaveBeenLastCalledWith("");
  toasts.at(-1)!.actions![0].run();
  await vi.waitFor(() =>
    expect(editor.navigate).toHaveBeenLastCalledWith("Scratch"),
  );
});

test("what is already in Trash is not trashed again", async () => {
  expect(await moveToTrash({ name: "Trash/Old", tag: "page" })).toBe(false);
  expect(editor.confirm).not.toHaveBeenCalled();
});

test("a restore refuses to overwrite a page that has its name", async () => {
  files.set("Trash/Scratch", "---\ntrashedFrom: Scratch\n---\nBody");
  files.set("Scratch", "Someone else");
  expect(
    await restoreFromTrash({
      name: "Trash/Scratch",
      from: "Scratch",
      tag: "page",
    }),
  ).toBe(false);
  expect(calls).toEqual([]);
  expect(editor.flashNotification).toHaveBeenCalledWith(
    "Scratch already exists. Rename one of them first.",
    "error",
  );
});

test("restoring the page on screen reloads it, so the removed marks are not saved back", async () => {
  files.set("Trash/Scratch", "---\ntrashedFrom: Scratch\n---\nBody");
  editor.getCurrentPage.mockResolvedValue("Scratch");
  expect(
    await restoreFromTrash({
      name: "Trash/Scratch",
      from: "Scratch",
      tag: "page",
    }),
  ).toBe(true);
  expect(editor.reloadPage).toHaveBeenCalled();
});

test("Trash: Restore lists what is in Trash with where it goes back to", async () => {
  files.set(
    "Trash/Scratch",
    "---\ntrashedFrom: Old/Scratch\ntrashedAt: 2026-10-02\n---\nBody",
  );
  files.set("Notes", "x");
  editor.filterBox.mockResolvedValue(undefined);
  await restoreCommand();
  expect(editor.filterBox.mock.calls[0][1]).toEqual([
    { name: "Trash/Scratch", description: "Old/Scratch · 2026-10-02" },
  ]);
});

test("Trash: Restore on an empty Trash says so", async () => {
  await restoreCommand();
  expect(editor.flashNotification).toHaveBeenCalledWith("Trash is empty.");
});

test("Trash: Empty asks with the count and deletes only what is in Trash", async () => {
  files.set("Trash/A", "a");
  files.set("Trash/B", "b");
  files.set("Notes", "keep");
  await emptyCommand();
  expect(editor.confirm).toHaveBeenCalledWith(
    "Delete 2 pages in Trash forever? This cannot be undone.",
    { destructive: true, okLabel: "Delete forever" },
  );
  expect([...files.keys()]).toEqual(["Notes"]);
});

test("Trash: Empty declined deletes nothing", async () => {
  files.set("Trash/A", "a");
  editor.confirm.mockResolvedValue(false);
  await emptyCommand();
  expect(space.deletePage).not.toHaveBeenCalled();
});
