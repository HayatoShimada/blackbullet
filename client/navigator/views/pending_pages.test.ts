// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada

import { expect, test } from "vitest";
import { createPendingPages, PENDING_TTL_MS } from "./pending_pages.ts";

test("a new page is a row until the index has the real one", () => {
  const pending = createPendingPages(() => 0);
  pending.add("Projects/Foo");
  expect(pending.rows().map((r) => r.name)).toEqual(["Projects/Foo"]);

  // The tree's own source lists the pending row plus whatever the index has.
  pending.settle(["Projects/Foo"]);
  expect(pending.has("Projects/Foo")).toBe(true);
  pending.settle(["Projects/Foo", "Projects/Foo"]);
  expect(pending.has("Projects/Foo")).toBe(false);
});

test("a page that never gets a first edit gives up its row", () => {
  let now = 0;
  const pending = createPendingPages(() => now);
  pending.add("Draft");
  now = PENDING_TTL_MS - 1;
  pending.settle(["Draft"]);
  expect(pending.has("Draft")).toBe(true);
  now = PENDING_TTL_MS + 1;
  pending.settle(["Draft"]);
  expect(pending.has("Draft")).toBe(false);
});
