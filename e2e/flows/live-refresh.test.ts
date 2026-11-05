// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "../fixtures/core.ts";

// Edits made outside the browser (another tab, an agent, the disk) show up
// without a reload, through the service worker as in production.
test.use({
  disableServiceWorker: false,
  spaceFiles: {
    "index.md": "Original notebook.\n",
    "Projects/Alpha.md": "---\ntags: probe\n---\n# Alpha\n",
    "Board.md":
      "# Board\n\n```db\nsource: tag:probe\nview: table\ncolumns: [title]\n```\n",
  },
});

test("an external edit appears in the open page", async ({
  sbPage: page,
  sbServer,
}) => {
  const editor = page.locator(".cm-content");
  await expect(editor).toContainText("Original notebook.");
  await writeFile(
    join(sbServer.spaceDir, "index.md"),
    "Original notebook.\nExternal paragraph.\n",
  );
  await expect(editor).toContainText("External paragraph.", {
    timeout: 10_000,
  });
});

test("a db view shows a page added and drops a page removed elsewhere", async ({
  sbPage: page,
  sbServer,
}) => {
  await page.goto(`${sbServer.url}/Board`);
  const view = page.frameLocator("iframe").first();
  await expect(view.getByRole("link", { name: "Alpha" })).toBeVisible();
  await writeFile(
    join(sbServer.spaceDir, "Projects/Gamma.md"),
    "---\ntags: probe\n---\n# Gamma\n",
  );
  await expect(view.getByRole("link", { name: "Gamma" })).toBeVisible({
    timeout: 10_000,
  });
  await writeFile(join(sbServer.spaceDir, "Projects/Alpha.md"), "# Alpha\n");
  await expect(view.getByRole("link", { name: "Alpha" })).toBeHidden({
    timeout: 10_000,
  });
});
