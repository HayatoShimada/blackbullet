// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada

import { expect, test } from "vitest";
import { inboxOrder } from "./inbox.ts";

const names = (rows: { name: string }[]) => rows.map((r) => r.name);

test("days and notes under the Inbox are newest first", () => {
  const rows = [
    { name: "Inbox/2026-10-01/17-45-03" },
    { name: "Inbox/2026-10-02/11-17-18" },
    { name: "Inbox/2026-10-01/14-02-11" },
    { name: "Inbox/2026-10-02/08-00-00" },
  ];
  expect(names([...rows].sort(inboxOrder))).toEqual([
    "Inbox/2026-10-02/11-17-18",
    "Inbox/2026-10-02/08-00-00",
    "Inbox/2026-10-01/17-45-03",
    "Inbox/2026-10-01/14-02-11",
  ]);
});

test("dated names come before others, which go by when they were changed", () => {
  const rows = [
    { name: "Inbox/Old", lastModified: "2026-09-01T10:00:00Z" },
    { name: "Inbox/2026-10-01", lastModified: "2026-10-01T10:00:00Z" },
    { name: "Inbox/New", lastModified: "2026-10-02T10:00:00Z" },
  ];
  expect(names([...rows].sort(inboxOrder))).toEqual([
    "Inbox/2026-10-01",
    "Inbox/New",
    "Inbox/Old",
  ]);
});

test("rows outside the Inbox are left to the caller's order", () => {
  expect(inboxOrder({ name: "Journal/a" }, { name: "Journal/b" })).toBe(0);
  expect(inboxOrder({ name: "Inbox/2026-10-01" }, { name: "Journal/b" })).toBe(
    0,
  );
  expect(inboxOrder({ name: "Inbox/a" }, { name: "Inbox/a" })).toBe(0);
});
