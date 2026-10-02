// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada

import { expect, test } from "vitest";
import { createTarget, folderOf } from "./create_target.ts";

test("a bare name is made in the folder", () => {
  expect(createTarget("Foo", "Projects")).toBe("Projects/Foo");
  expect(createTarget("  Foo  ", "Projects")).toBe("Projects/Foo");
});

test("no folder means the top level", () => {
  expect(createTarget("Foo", "")).toBe("Foo");
  expect(createTarget("Foo", undefined)).toBe("Foo");
});

test("a name that carries its own path or a meta mark says where it goes", () => {
  expect(createTarget("Areas/Foo", "Projects")).toBe("Areas/Foo");
  expect(createTarget("^Library/Foo", "Projects")).toBe("^Library/Foo");
});

test("folderOf is the part before the last slash", () => {
  expect(folderOf("Projects/Spring Launch")).toBe("Projects");
  expect(folderOf("Inbox/2026-10-02/11-17-18")).toBe("Inbox/2026-10-02");
  expect(folderOf("index")).toBe("");
});
