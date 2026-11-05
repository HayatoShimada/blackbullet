// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada
import { expect, test } from "vitest";
import { cachesToDrop } from "./cache_names.ts";

test("keeps its own cache and the newest previous one", () => {
  expect(
    cachesToDrop(
      ["cache-100", "cache-300", "cache-200", "other"],
      "cache-300",
    ).sort(),
  ).toEqual(["cache-100", "other"]);
});

test("the first version has nothing to keep", () => {
  expect(cachesToDrop(["cache-5"], "cache-5")).toEqual([]);
  expect(cachesToDrop([], "cache-5")).toEqual([]);
});
