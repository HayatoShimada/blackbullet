// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada
//
// The one way a page is made on purpose: a name is asked for inside a folder,
// the page shows in the tree at once, and it opens with the caret on line 1.
// The tree Mediator is the only caller (`page.new`).

import {
  isMarkdownPath,
  parseToRef,
} from "@silverbulletmd/silverbullet/lib/ref";
import { editor, space } from "@silverbulletmd/silverbullet/syscalls";
import { showPendingPage } from "./pending_pages.ts";

/** Shows a new page in the tree and opens it, caret on line 1. */
export async function openNewPage(name: string): Promise<void> {
  const ref = parseToRef(name);
  if (ref && isMarkdownPath(ref.path)) {
    await showPendingPage(ref.path.replace(/\.md$/, ""));
  }
  // `@0` is a position: without it an existing page would reopen wherever it
  // was last left, and a new one would be left to the editor's default.
  await editor.navigate(`${name}@0`);
}

/** Asks for a name in `folder` (`""`: the root) and opens the page. */
export async function createPageIn(folder: string): Promise<void> {
  const prefill = folder ? `${folder}/` : "";
  const name = await editor.prompt("New page name:", prefill);
  if (name == null) return;
  const trimmed = name.trim();
  // Confirming the prefill unedited means "never mind": navigating to a bare
  // "Folder/" would try to open a page with an empty last segment.
  if (trimmed === "" || trimmed === prefill) return;
  if (await space.pageExists(trimmed)) {
    await editor.navigate(`${trimmed}@0`);
    return;
  }
  await openNewPage(trimmed);
}
